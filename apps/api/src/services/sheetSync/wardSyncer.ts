/**
 * Ward Syncer (입원현황 Google Sheets → DB 동기화)
 *
 * 시트 구조 가정 (실제 시트에 맞게 WARD_SECTIONS 업데이트 필요):
 * - 헤더행(4행): 호실 이름
 * - 데이터행: 각 셀 = 한 베드의 입원정보 (멀티라인)
 * - 메모영역(J열~): 우측 대기 메모
 *
 * WARD_SECTIONS의 colToBedKey를 실제 스프레드시트 컬럼 배치에 맞게 수정하세요.
 */

import { PrismaClient } from '@prisma/client';
import type { WardSheetRegion, WardType } from '@prisma/client';
import {
  parseWardCell,
  classifyCellRegion,
  DEFAULT_WARD_CONFIG,
  type ParsedAdmission,
  type ParsedWaitingMemo,
} from '../wardAdmissionParser';
import { PatientResolver } from '../../parsers/patientResolver';
import type { SyncStats } from './syncLogger';

// ─── 0-indexed 컬럼 인덱스 → A1 표기법 ───
function colIdxToLetter(colIdx: number): string {
  let col = colIdx + 1;
  let s = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

// ─── 시트 섹션 정의 ───
// IMPORTANT: colToBedKey의 key = 0-indexed column (A=0, B=1, C=2 ...)
// 실제 스프레드시트 컬럼 배치에 맞게 업데이트하세요.
interface WardSection {
  name: string;
  wardType: WardType;
  // 1-indexed 행 범위 (데이터가 있는 행들)
  startRow: number;
  endRow: number;
  // 0-indexed 컬럼 → bedKey 매핑
  colToBedKey: Record<number, string>;
  region: WardSheetRegion;
  // 메모 컬럼 범위 (0-indexed)
  memoColStart?: number;
  memoColEnd?: number;
}

// ─── 기본 섹션 설정 ───
// 실제 스프레드시트에 맞게 수정하세요.
// 현재 설정은 추정값입니다.
const WARD_SECTIONS: WardSection[] = [
  {
    name: '1인실',
    wardType: 'SINGLE',
    startRow: 4,   // 1-indexed: 4행 시작 (헤더포함)
    endRow: 14,
    colToBedKey: {
      1: '101', // Column B
      2: '102', // Column C
      3: '103', // Column D
      4: '104', // Column E
      5: '105', // Column F
      6: '106', // Column G
      7: '107', // Column H
    },
    region: 'CURRENT',
    memoColStart: 9,  // Column J
    memoColEnd: 11,   // Column L
  },
  {
    name: '2인실',
    wardType: 'DOUBLE',
    startRow: 16,
    endRow: 26,
    colToBedKey: {
      1: '201_DOOR',  // Column B
      2: '201_INNER', // Column C
      3: '202_DOOR',  // Column D
      4: '202_INNER', // Column E
      5: '203_DOOR',  // Column F
      6: '203_INNER', // Column G
    },
    region: 'CURRENT',
    memoColStart: 9,  // Column J
    memoColEnd: 11,   // Column L
  },
  {
    name: '4인실',
    wardType: 'QUAD',
    startRow: 28,
    endRow: 42,
    colToBedKey: {
      1: '301_DOOR',        // Column B
      2: '301_MIDDLE',      // Column C
      3: '301_INNER_LEFT',  // Column D
      4: '301_INNER_RIGHT', // Column E
      5: '302_DOOR',        // Column F
      6: '302_MIDDLE',      // Column G
      7: '302_INNER_LEFT',  // Column H
      8: '302_INNER_RIGHT', // Column I
      // 303, 304 사용 시 아래 주석 해제:
      // 9:  '303_DOOR',
      // 10: '303_MIDDLE',
      // 11: '303_INNER_LEFT',
      // 12: '303_INNER_RIGHT',
      // 13: '304_DOOR',
      // 14: '304_MIDDLE',
      // 15: '304_INNER_LEFT',
      // 16: '304_INNER_RIGHT',
    },
    region: 'CURRENT',
    memoColStart: 9,  // Column J
    memoColEnd: 11,   // Column L
  },
];

// ─── WardSyncer ───
export class WardSyncer {
  private prisma: PrismaClient;
  private resolver: PatientResolver;
  private bedKeyToId: Map<string, string> = new Map();

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.resolver = new PatientResolver(prisma);
  }

  /** WardBed 목록 로드 */
  async init(): Promise<void> {
    const beds = await this.prisma.wardBed.findMany({
      where: { isActive: true },
      select: { id: true, bedKey: true },
    });
    for (const bed of beds) {
      this.bedKeyToId.set(bed.bedKey, bed.id);
    }
    console.log(`[WardSyncer] WardBed 로드: ${this.bedKeyToId.size}개`);
  }

  /**
   * 입원현황 시트 2D 배열 → WardAdmission 레코드 upsert
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

    const year = new Date().getFullYear();

    for (const section of WARD_SECTIONS) {
      await this.processSection(section, values, sheetTab, year, syncTimestamp, stats);
    }

    const resolverStats = this.resolver.getStats();
    console.log(`[WardSyncer] 환자매칭: 총=${resolverStats.total} 성공=${resolverStats.resolved} 미매칭=${resolverStats.unresolved}`);

    return stats;
  }

  private async processSection(
    section: WardSection,
    values: string[][],
    sheetTab: string,
    year: number,
    syncTimestamp: Date,
    stats: SyncStats,
  ): Promise<void> {
    const { startRow, endRow, colToBedKey, region, memoColStart, memoColEnd } = section;

    for (let rowIdx = startRow - 1; rowIdx < endRow; rowIdx++) {
      const row = values[rowIdx];
      if (!row) continue;

      // 베드 데이터 셀 처리
      for (const [colIdxStr, bedKey] of Object.entries(colToBedKey)) {
        const colIdx = parseInt(colIdxStr);
        const cellValue = colIdx < row.length ? String(row[colIdx] ?? '').trim() : '';
        if (!cellValue) continue;

        const a1 = `${colIdxToLetter(colIdx)}${rowIdx + 1}`;
        const bedId = this.bedKeyToId.get(bedKey);
        if (!bedId) {
          console.warn(`[WardSyncer] bedKey 미등록: ${bedKey} (${a1})`);
          continue;
        }

        const parsed = parseWardCell(cellValue, a1, region as any, year);
        for (const admission of parsed) {
          stats.rowsProcessed++;
          try {
            await this.upsertAdmission(admission, bedId, sheetTab, a1, region as any, syncTimestamp, stats);
          } catch (err: any) {
            console.error(`[WardSyncer] upsert 실패 ${a1}:`, err.message);
            stats.rowsFailed++;
          }
        }
      }

      // 메모 영역 처리
      if (memoColStart !== undefined && memoColEnd !== undefined) {
        for (let ci = memoColStart; ci <= memoColEnd; ci++) {
          const cellValue = ci < row.length ? String(row[ci] ?? '').trim() : '';
          if (!cellValue) continue;

          const a1 = `${colIdxToLetter(ci)}${rowIdx + 1}`;
          try {
            await this.upsertWaitingMemo(cellValue, a1, section.wardType, sheetTab, syncTimestamp);
          } catch (err: any) {
            console.error(`[WardSyncer] 메모 upsert 실패 ${a1}:`, err.message);
          }
        }
      }
    }
  }

  private async upsertAdmission(
    parsed: ParsedAdmission,
    bedId: string,
    sheetTab: string,
    sheetA1: string,
    region: WardSheetRegion,
    syncTimestamp: Date,
    stats: SyncStats,
  ): Promise<void> {
    // 환자 매칭
    const { patientId } = await this.resolver.resolve(undefined, parsed.patientNameRaw || undefined);

    // 기존 레코드 조회 (uniqueKey: bedId+sheetTab+sheetA1+region+sheetLineIndex)
    const existing = await this.prisma.wardAdmission.findFirst({
      where: {
        bedId,
        sheetTab,
        sheetA1,
        sheetRegion: region,
        sheetLineIndex: parsed.sheetLineIndex,
        deletedAt: null,
      },
      select: {
        id: true, isManualOverride: true, sheetSyncedAt: true,
        patientNameRaw: true, status: true, admitDate: true, dischargeDate: true,
      },
    });

    const data = {
      patientId: patientId || null,
      patientNameRaw: parsed.patientNameRaw || null,
      diagnosis: parsed.diagnosis,
      admitDate: parsed.admitDate,
      dischargeDate: parsed.dischargeDate,
      dischargeTime: parsed.dischargeTime,
      status: parsed.status,
      isPlanned: parsed.isPlanned,
      memoRaw: parsed.memoRaw || null,
      sheetSyncedAt: syncTimestamp,
      lastUpdatedSource: 'SHEET' as const,
    };

    if (!existing) {
      await this.prisma.wardAdmission.create({
        data: {
          bedId,
          sheetTab,
          sheetA1,
          sheetRegion: region,
          sheetLineIndex: parsed.sheetLineIndex,
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
      existing.patientNameRaw === (parsed.patientNameRaw || null) &&
      existing.status === parsed.status &&
      existing.admitDate?.getTime() === parsed.admitDate?.getTime() &&
      existing.dischargeDate?.getTime() === parsed.dischargeDate?.getTime()
    ) {
      await this.prisma.wardAdmission.update({
        where: { id: existing.id },
        data: { sheetSyncedAt: syncTimestamp },
      });
      stats.rowsSkipped++;
      return;
    }

    await this.prisma.wardAdmission.updateMany({
      where: { id: existing.id, isManualOverride: false },
      data,
    });
    stats.rowsUpdated++;
  }

  private async upsertWaitingMemo(
    content: string,
    sheetA1: string,
    wardType: WardType,
    sheetTab: string,
    syncTimestamp: Date,
  ): Promise<void> {
    // WardWaitingMemo는 항상 덮어씀 (마지막 시트 상태 반영)
    const existing = await this.prisma.wardWaitingMemo.findFirst({
      where: { sheetTab, sheetA1 },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.wardWaitingMemo.update({
        where: { id: existing.id },
        data: { content, sheetSyncedAt: syncTimestamp },
      });
    } else {
      await this.prisma.wardWaitingMemo.create({
        data: { wardType, content, sheetTab, sheetA1, sheetSyncedAt: syncTimestamp },
      });
    }
  }

  getResolverStats() {
    return this.resolver.getStats();
  }
}
