import { PrismaClient } from '@prisma/client';

export interface SyncLogEntry {
  sheetId: string;
  sheetTab: string;
  syncType: 'FULL' | 'INCREMENTAL' | 'WRITE_BACK';
  direction: 'SHEET_TO_DB' | 'DB_TO_SHEET';
  triggeredBy?: string;
}

export interface SyncStats {
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsFailed: number;
}

export class SyncLogger {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Create a sync log entry at the start of a sync run */
  async start(entry: SyncLogEntry): Promise<string> {
    const log = await this.prisma.sheetSyncLog.create({
      data: {
        sheetId: entry.sheetId,
        sheetTab: entry.sheetTab,
        syncType: entry.syncType,
        direction: entry.direction,
        triggeredBy: entry.triggeredBy || 'manual',
        startedAt: new Date(),
      },
    });
    return log.id;
  }

  /** Update a sync log with completion stats */
  async complete(
    logId: string,
    stats: SyncStats,
    contentHash?: string,
    errorDetails?: any
  ): Promise<void> {
    const now = new Date();
    await this.prisma.sheetSyncLog.update({
      where: { id: logId },
      data: {
        completedAt: now,
        lastSyncedAt: now,
        rowsProcessed: stats.rowsProcessed,
        rowsCreated: stats.rowsCreated,
        rowsUpdated: stats.rowsUpdated,
        rowsFailed: stats.rowsFailed,
        contentHash,
        errorDetails: errorDetails ? JSON.parse(JSON.stringify(errorDetails)) : undefined,
      },
    });
  }

  /** Get the most recent successful sync log for a given sheet/tab */
  async getLastSync(sheetId: string, sheetTab: string): Promise<{
    contentHash: string | null;
    lastSyncedAt: Date | null;
  } | null> {
    const log = await this.prisma.sheetSyncLog.findFirst({
      where: {
        sheetId, sheetTab,
        completedAt: { not: null },
        direction: 'SHEET_TO_DB',
      },
      orderBy: { startedAt: 'desc' },
      select: { contentHash: true, lastSyncedAt: true },
    });
    return log;
  }
}
