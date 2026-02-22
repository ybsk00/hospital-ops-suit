/**
 * Outpatient Syncer (외래예약 Google Sheets → DB 동기화)
 *
 * 시트 탭명 규칙: "26.2", "26.3" (yy.m 형식, 월초~월말 6일 × 6열 구조)
 * 현재 월 + 다음 월 탭을 동기화합니다.
 */

import { PrismaClient } from '@prisma/client';
import { parseOutpatientSheet, type ParsedOutpatientAppointment } from '../outpatientParser';
import { PatientResolver } from '../../parsers/patientResolver';
import type { SyncStats } from './syncLogger';

// ─── 탭명 생성 ───
// 외래예약 탭: "26.2", "26.3" 형식
function getOutpatientTabName(year: number, month: number): string {
  const yy = String(year).slice(-2);
  return `${yy}.${month}`;
}

// ─── OutpatientSyncer ───
export class OutpatientSyncer {
  private prisma: PrismaClient;
  private resolver: PatientResolver;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.resolver = new PatientResolver(prisma);
  }

  /**
   * 외래예약 시트 2D 배열 → OutpatientAppointment 레코드 upsert
   */
  async upsertFromSheet(
    values: string[][],
    sheetTab: string,
    syncTimestamp: Date,
  ): Promise<SyncStats> {
    const stats: SyncStats = {
      rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0,
      rowsSkipped: 0, rowsFailed: 0,
    };

    const year = this.extractYear(sheetTab);
    const appointments = parseOutpatientSheet(values, year, sheetTab);

    console.log(`[OutpatientSyncer] 파싱 완료: ${appointments.length}건 (탭: ${sheetTab})`);

    for (const appt of appointments) {
      stats.rowsProcessed++;
      try {
        await this.upsertAppointment(appt, syncTimestamp, stats);
      } catch (err: any) {
        console.error(`[OutpatientSyncer] upsert 실패 ${appt.sheetA1Name}:`, err.message);
        stats.rowsFailed++;
      }
    }

    // 시트에 없는 기존 예약 soft-delete (해당 탭의 예약만)
    // SHEET 소스이고, 이번 sync에서 갱신되지 않은 레코드는 취소처리
    await this.cancelStaleAppointments(sheetTab, syncTimestamp, stats);

    const resolverStats = this.resolver.getStats();
    console.log(`[OutpatientSyncer] 환자매칭: 총=${resolverStats.total} 성공=${resolverStats.resolved} 미매칭=${resolverStats.unresolved}`);

    return stats;
  }

  private async upsertAppointment(
    appt: ParsedOutpatientAppointment,
    syncTimestamp: Date,
    stats: SyncStats,
  ): Promise<void> {
    // 환자 매칭 (이름 기반)
    const { patientId } = await this.resolver.resolve(undefined, appt.patientNameRaw || undefined);

    // 기존 레코드 조회 (uniqueKey: sheetTab+sheetA1Name)
    const existing = await this.prisma.outpatientAppointment.findFirst({
      where: {
        sheetTab: appt.sheetTab,
        sheetA1Name: appt.sheetA1Name,
        deletedAt: null,
      },
      select: {
        id: true, isManualOverride: true, sheetSyncedAt: true,
        patientNameRaw: true, doctorCode: true, phoneNumber: true,
        treatmentContent: true, status: true,
      },
    });

    const data = {
      appointmentDate: appt.appointmentDate,
      timeSlot: appt.timeSlot,
      doctorCode: appt.doctorCode,
      slotIndex: appt.slotIndex,
      patientId: patientId || null,
      patientNameRaw: appt.patientNameRaw || null,
      isNewPatient: appt.isNewPatient,
      phoneNumber: appt.phoneNumber || null,
      treatmentContent: appt.treatmentContent || null,
      sheetA1Doctor: appt.sheetA1Doctor || null,
      sheetA1Phone: appt.sheetA1Phone || null,
      sheetA1Content: appt.sheetA1Content || null,
      sheetSyncedAt: syncTimestamp,
      lastUpdatedSource: 'SHEET' as const,
    };

    if (!existing) {
      await this.prisma.outpatientAppointment.create({
        data: {
          sheetTab: appt.sheetTab,
          sheetA1Name: appt.sheetA1Name,
          status: 'BOOKED',
          ...data,
        },
      });
      stats.rowsCreated++;
      return;
    }

    if (existing.isManualOverride) {
      stats.rowsSkipped++;
      return;
    }

    // 변경 없으면 syncTimestamp만 업데이트
    if (
      existing.patientNameRaw === (appt.patientNameRaw || null) &&
      existing.doctorCode === appt.doctorCode &&
      existing.phoneNumber === (appt.phoneNumber || null) &&
      existing.treatmentContent === (appt.treatmentContent || null)
    ) {
      await this.prisma.outpatientAppointment.update({
        where: { id: existing.id },
        data: { sheetSyncedAt: syncTimestamp },
      });
      stats.rowsSkipped++;
      return;
    }

    await this.prisma.outpatientAppointment.updateMany({
      where: { id: existing.id, isManualOverride: false },
      data,
    });
    stats.rowsUpdated++;
  }

  /**
   * 이번 sync에서 갱신되지 않은 SHEET 소스 예약 → CANCELLED soft-delete
   * (시트에서 삭제된 예약 처리)
   */
  private async cancelStaleAppointments(
    sheetTab: string,
    syncTimestamp: Date,
    stats: SyncStats,
  ): Promise<void> {
    // syncTimestamp보다 이전에 sync된 레코드 중 웹에서 수정되지 않은 것
    const stale = await this.prisma.outpatientAppointment.findMany({
      where: {
        sheetTab,
        deletedAt: null,
        isManualOverride: false,
        lastUpdatedSource: 'SHEET',
        status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
        // 이번 sync에서 업데이트되지 않은 것 (sheetSyncedAt < syncTimestamp)
        OR: [
          { sheetSyncedAt: null },
          { sheetSyncedAt: { lt: syncTimestamp } },
        ],
      },
      select: { id: true },
    });

    if (stale.length > 0) {
      await this.prisma.outpatientAppointment.updateMany({
        where: { id: { in: stale.map(s => s.id) } },
        data: {
          deletedAt: syncTimestamp,
          status: 'CANCELLED',
          lastUpdatedSource: 'SHEET',
        },
      });
      console.log(`[OutpatientSyncer] 시트 삭제 반영: ${stale.length}건 CANCELLED`);
    }
  }

  /**
   * 현재 월 + 다음 월 탭명 목록
   */
  static getTabsForSync(): { tab: string; year: number }[] {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12

    const tabs = [
      { tab: getOutpatientTabName(year, month), year },
    ];

    // 다음 달
    if (month === 12) {
      tabs.push({ tab: getOutpatientTabName(year + 1, 1), year: year + 1 });
    } else {
      tabs.push({ tab: getOutpatientTabName(year, month + 1), year });
    }

    return tabs;
  }

  /** 탭명에서 연도 추출 ("26.2" → 2026, "25.12" → 2025) */
  private extractYear(sheetTab: string): number {
    const m = /^(\d{2})\./.exec(sheetTab);
    if (!m) return new Date().getFullYear();
    const yy = parseInt(m[1]);
    return yy >= 50 ? 1900 + yy : 2000 + yy;
  }

  getResolverStats() {
    return this.resolver.getStats();
  }
}
