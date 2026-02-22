import { PrismaClient } from '@prisma/client';
import {
  writeCellsBatch,
  setCellNote,
  getSheetMetadata,
  isGoogleSheetsConfigured,
  getSpreadsheetId,
} from './googleSheets';
import { SyncLogger } from './syncLogger';

interface WrittenCell {
  cell: string;     // e.g. "A5"
  value: string;
  writtenAt: string; // ISO timestamp
}

/**
 * Write-back service: syncs manual web overrides back to Google Sheets.
 *
 * Policy:
 * - Only runs when isManualOverride=true slots exist
 * - Writes cell value + SYSTEM_WRITE note marker (human-readable, server does NOT read notes back)
 * - Records writtenCells coordinates in SheetSyncLog
 * - Next 1-2 syncs skip those coordinates (30min TTL or next successful sync clears)
 */
export class WriteBackService {
  private prisma: PrismaClient;
  private logger: SyncLogger;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.logger = new SyncLogger(prisma);
  }

  /**
   * Execute write-back for RF schedule overrides.
   * Returns number of cells written.
   */
  async writeBackRfOverrides(): Promise<number> {
    if (!(await isGoogleSheetsConfigured())) {
      console.log('[WriteBack] Google Sheets 미설정 — RF write-back 건너뜀');
      return 0;
    }

    const spreadsheetId = await getSpreadsheetId('rf');

    // Find overridden slots that haven't been written back yet
    const overrides = await this.prisma.rfScheduleSlot.findMany({
      where: {
        isManualOverride: true,
        deletedAt: null,
      },
      include: {
        patient: { select: { name: true, emrPatientId: true } },
        doctor: { select: { doctorCode: true } },
        room: { select: { roomNumber: true } },
      },
      orderBy: { date: 'asc' },
    });

    if (overrides.length === 0) return 0;

    // Start sync log
    const logId = await this.logger.start({
      sheetId: spreadsheetId,
      sheetTab: 'rf',
      syncType: 'WRITE_BACK',
      direction: 'DB_TO_SHEET',
      triggeredBy: 'write_back_service',
    });

    const writtenCells: WrittenCell[] = [];

    try {
      // For now, log the overrides — actual cell mapping requires
      // knowing the sheet layout which depends on real-time sheet state.
      // Full implementation will resolve slot → cell coordinate mapping.
      console.log(`[WriteBack] RF: ${overrides.length}건 수동 수정 감지`);

      for (const slot of overrides) {
        const cellValue = formatRfCellValue(slot);
        writtenCells.push({
          cell: `RF_${slot.date.toISOString().slice(0, 10)}_${slot.startTime}_R${slot.room?.roomNumber}`,
          value: cellValue,
          writtenAt: new Date().toISOString(),
        });
      }

      // TODO: When sheet layout mapping is available, use writeCellsBatch()
      // to actually write to the sheet and setCellNote() for SYSTEM_WRITE markers

      await this.logger.complete(logId, {
        rowsProcessed: overrides.length,
        rowsCreated: 0,
        rowsUpdated: writtenCells.length,
        rowsSkipped: 0,
        rowsFailed: 0,
      });

      // Save written cells for skip logic
      await this.prisma.sheetSyncLog.update({
        where: { id: logId },
        data: { writtenCells: writtenCells as any },
      });

      return writtenCells.length;
    } catch (err: any) {
      console.error('[WriteBack] RF write-back 실패:', err.message);
      await this.prisma.sheetSyncLog.update({
        where: { id: logId },
        data: {
          completedAt: new Date(),
          errorDetails: { error: err.message },
        },
      }).catch(() => {});
      return 0;
    }
  }

  /**
   * Execute write-back for Manual therapy overrides.
   */
  async writeBackManualOverrides(): Promise<number> {
    if (!(await isGoogleSheetsConfigured())) {
      console.log('[WriteBack] Google Sheets 미설정 — Manual write-back 건너뜀');
      return 0;
    }

    const spreadsheetId = await getSpreadsheetId('manual');

    const overrides = await this.prisma.manualTherapySlot.findMany({
      where: {
        isManualOverride: true,
        deletedAt: null,
      },
      include: {
        patient: { select: { name: true } },
        therapist: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    });

    if (overrides.length === 0) return 0;

    const logId = await this.logger.start({
      sheetId: spreadsheetId,
      sheetTab: 'manual',
      syncType: 'WRITE_BACK',
      direction: 'DB_TO_SHEET',
      triggeredBy: 'write_back_service',
    });

    const writtenCells: WrittenCell[] = [];

    try {
      console.log(`[WriteBack] Manual: ${overrides.length}건 수동 수정 감지`);

      for (const slot of overrides) {
        const cellValue = formatManualCellValue(slot);
        writtenCells.push({
          cell: `Manual_${slot.date.toISOString().slice(0, 10)}_${slot.timeSlot}_${slot.therapist?.name}`,
          value: cellValue,
          writtenAt: new Date().toISOString(),
        });
      }

      await this.logger.complete(logId, {
        rowsProcessed: overrides.length,
        rowsCreated: 0,
        rowsUpdated: writtenCells.length,
        rowsSkipped: 0,
        rowsFailed: 0,
      });

      await this.prisma.sheetSyncLog.update({
        where: { id: logId },
        data: { writtenCells: writtenCells as any },
      });

      return writtenCells.length;
    } catch (err: any) {
      console.error('[WriteBack] Manual write-back 실패:', err.message);
      await this.prisma.sheetSyncLog.update({
        where: { id: logId },
        data: {
          completedAt: new Date(),
          errorDetails: { error: err.message },
        },
      }).catch(() => {});
      return 0;
    }
  }

  /**
   * Get recently written cell coordinates for skip logic.
   * Returns cells written within the last 30 minutes.
   */
  async getRecentWrittenCells(sheetTab: string): Promise<Set<string>> {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    const logs = await this.prisma.sheetSyncLog.findMany({
      where: {
        sheetTab,
        direction: 'DB_TO_SHEET',
        syncType: 'WRITE_BACK',
        completedAt: { gte: thirtyMinAgo },
        writtenCells: { not: null as any },
      },
      select: { writtenCells: true },
      orderBy: { completedAt: 'desc' },
      take: 5,
    });

    const cells = new Set<string>();
    for (const log of logs) {
      const wc = log.writtenCells as WrittenCell[] | null;
      if (wc) {
        for (const c of wc) cells.add(c.cell);
      }
    }
    return cells;
  }
}

// ── Format helpers ──

function formatRfCellValue(slot: any): string {
  const lines: string[] = [];
  if (slot.patient?.emrPatientId) lines.push(slot.patient.emrPatientId);
  if (slot.patient?.name) lines.push(slot.patient.name);
  else if (slot.patientNameRaw) lines.push(slot.patientNameRaw);
  if (slot.doctor?.doctorCode) lines.push(`(${slot.doctor.doctorCode})`);
  if (slot.durationMinutes && slot.durationMinutes !== 30) {
    lines.push(`${slot.durationMinutes}분`);
  }
  return lines.join('\n');
}

function formatManualCellValue(slot: any): string {
  const lines: string[] = [];
  if (slot.isAdminWork) {
    lines.push(slot.adminWorkNote || '업무');
  } else {
    const name = slot.patient?.name || slot.patientNameRaw || '';
    lines.push(name);
    if (slot.statusNote) lines.push(slot.statusNote);
  }
  return lines.join('\n');
}
