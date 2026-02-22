import { Queue, Worker, Job } from 'bullmq';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { SyncLogger } from '../services/sheetSync/syncLogger';
import { RfScheduleSaver } from '../services/sheetSync/rfScheduleSaver';
import { ManualTherapySaver } from '../services/sheetSync/manualTherapySaver';
import { WardSyncer } from '../services/sheetSync/wardSyncer';
import { OutpatientSyncer } from '../services/sheetSync/outpatientSyncer';
import {
  computeRfContentHash,
  computeManualContentHash,
  computeWardContentHash,
  computeOutpatientContentHash,
} from '../services/sheetSync/contentHash';
import { parseRfScheduleRows } from '../parsers/rfScheduleParser';
import { parseManualTherapyRows } from '../parsers/manualTherapyParser';
import { parseOutpatientSheet } from '../services/outpatientParser';
import { readFullTab, isGoogleSheetsConfigured, getSpreadsheetId } from '../services/sheetSync/googleSheets';

// ─── Job 데이터 타입 ───
export interface SheetSyncJobData {
  syncLogId: string;
  sheetId: string;
  sheetTab: string; // 'rf' | 'manual'
  syncType: 'FULL' | 'INCREMENTAL';
  triggeredBy: string;
}

// ─── Redis 연결 설정 ───
function getRedisConnection() {
  if (!env.REDIS_URL || env.REDIS_URL === 'redis://localhost:6379') {
    return undefined;
  }
  try {
    const url = new URL(env.REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
    };
  } catch {
    return undefined;
  }
}

// ─── Queue 인스턴스 ───
let sheetSyncQueue: Queue<SheetSyncJobData> | null = null;
let sheetSyncWorker: Worker<SheetSyncJobData> | null = null;

// ─── 현재 월 탭 이름 생성 ───
// RF: "26.02", Manual/Ward: "26.2월", Outpatient: "26.2"
function getCurrentTabName(type: 'rf' | 'manual' | 'ward' | 'outpatient'): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = now.getMonth() + 1;
  if (type === 'rf') return `${yy}.${String(mm).padStart(2, '0')}`; // "26.02"
  if (type === 'outpatient') return `${yy}.${mm}`;                   // "26.2"
  return `${yy}.${mm}월`;                                             // "26.2월"
}

// ─── 동기화 실행 로직 (큐/인라인 공통) ───
async function executeSyncJob(data: SheetSyncJobData): Promise<void> {
  const logger = new SyncLogger(prisma);
  const startedAt = new Date();

  console.log(`[SheetSync] 동기화 시작: ${data.sheetTab} (${data.syncType}) by ${data.triggeredBy}`);

  try {
    // 1) Google Sheets 설정 확인 (async)
    if (!(await isGoogleSheetsConfigured())) {
      console.log(`[SheetSync] Google Sheets 미설정 — ${data.sheetTab} 동기화 건너뜀`);
      await logger.complete(data.syncLogId, {
        rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0,
        rowsSkipped: 0, rowsFailed: 0,
      });
      return;
    }

    // 2) 스프레드시트 ID 조회
    const spreadsheetId = await getSpreadsheetId(data.sheetTab as 'rf' | 'manual' | 'ward' | 'outpatient');
    if (!spreadsheetId) {
      console.log(`[SheetSync] ${data.sheetTab} 스프레드시트 ID 미설정 — 건너뜀`);
      await logger.complete(data.syncLogId, {
        rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0,
        rowsSkipped: 0, rowsFailed: 0,
      });
      return;
    }

    // outpatient는 멀티탭 처리 — 아래 케이스에서 자체적으로 읽음
    let rows: string[][] = [];
    let tabName = '';
    if (data.sheetTab !== 'outpatient') {
      tabName = getCurrentTabName(data.sheetTab as 'rf' | 'manual' | 'ward');
      console.log(`[SheetSync] Google Sheets 읽기: ${spreadsheetId} / ${tabName}`);
      rows = await readFullTab(spreadsheetId, tabName);
      console.log(`[SheetSync] ${rows.length}행 수신`);

      if (rows.length === 0) {
        console.log(`[SheetSync] 빈 데이터 — 건너뜀`);
        await logger.complete(data.syncLogId, {
          rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0,
          rowsSkipped: 0, rowsFailed: 0,
        });
        return;
      }
    }

    // 3) 파싱
    const sheetSource = `sheets_${data.sheetTab}`;
    if (data.sheetTab === 'rf') {
      const parseResult = await parseRfScheduleRows(rows, { sheetSource });

      // 4) contentHash 비교 — 변경 없으면 스킵
      const contentHash = computeRfContentHash(parseResult.slots);
      const lastSync = await logger.getLastSync(data.sheetId, data.sheetTab);
      if (lastSync?.contentHash === contentHash) {
        console.log(`[SheetSync] RF contentHash 동일 — 건너뜀`);
        await logger.complete(data.syncLogId, {
          rowsProcessed: parseResult.stats.parsedSlots,
          rowsCreated: 0, rowsUpdated: 0, rowsSkipped: parseResult.stats.parsedSlots, rowsFailed: 0,
        }, contentHash);
        return;
      }

      // 5) DB Upsert
      const saver = new RfScheduleSaver(prisma);
      await saver.init();
      const stats = await saver.upsertSlots(parseResult.slots, startedAt);
      const resolverStats = saver.getResolverStats();

      console.log(`[SheetSync] RF 파싱: ${parseResult.stats.parsedSlots}건, DB: 생성=${stats.rowsCreated} 수정=${stats.rowsUpdated} 건너뜀=${stats.rowsSkipped} 실패=${stats.rowsFailed}`);
      console.log(`[SheetSync] RF 환자매칭: 총=${resolverStats.total} 성공=${resolverStats.resolved} 실패=${resolverStats.unresolved}`);

      await logger.complete(data.syncLogId, stats, contentHash);

      if (parseResult.errors.length > 0) {
        console.warn(`[SheetSync] RF 파싱 오류 ${parseResult.errors.length}건:`, parseResult.errors.slice(0, 5));
      }
    } else if (data.sheetTab === 'manual') {
      const parseResult = await parseManualTherapyRows(rows, { sheetSource });

      const contentHash = computeManualContentHash(parseResult.slots);
      const lastSync = await logger.getLastSync(data.sheetId, data.sheetTab);
      if (lastSync?.contentHash === contentHash) {
        console.log(`[SheetSync] Manual contentHash 동일 — 건너뜀`);
        await logger.complete(data.syncLogId, {
          rowsProcessed: parseResult.stats.parsedSlots,
          rowsCreated: 0, rowsUpdated: 0, rowsSkipped: parseResult.stats.parsedSlots, rowsFailed: 0,
        }, contentHash);
        return;
      }

      const saver = new ManualTherapySaver(prisma);
      await saver.init();
      const stats = await saver.upsertSlots(parseResult.slots, startedAt);
      const resolverStats = saver.getResolverStats();

      console.log(`[SheetSync] Manual 파싱: ${parseResult.stats.parsedSlots}건, DB: 생성=${stats.rowsCreated} 수정=${stats.rowsUpdated} 건너뜀=${stats.rowsSkipped} 실패=${stats.rowsFailed}`);
      console.log(`[SheetSync] Manual 환자매칭: 총=${resolverStats.total} 성공=${resolverStats.resolved} 실패=${resolverStats.unresolved}`);

      await logger.complete(data.syncLogId, stats, contentHash);

      if (parseResult.errors.length > 0) {
        console.warn(`[SheetSync] Manual 파싱 오류 ${parseResult.errors.length}건:`, parseResult.errors.slice(0, 5));
      }
    } else if (data.sheetTab === 'ward') {
      // ── 입원현황 시트 동기화 ──
      const contentHash = computeWardContentHash(rows);
      const lastSync = await logger.getLastSync(data.sheetId, data.sheetTab);
      if (lastSync?.contentHash === contentHash) {
        console.log('[SheetSync] Ward contentHash 동일 — 건너뜀');
        await logger.complete(data.syncLogId, {
          rowsProcessed: rows.length, rowsCreated: 0, rowsUpdated: 0,
          rowsSkipped: rows.length, rowsFailed: 0,
        }, contentHash);
        return;
      }

      const wardSyncer = new WardSyncer(prisma);
      await wardSyncer.init();
      const stats = await wardSyncer.upsertFromSheet(rows, tabName, startedAt);
      const resolverStats = wardSyncer.getResolverStats();
      console.log(`[SheetSync] Ward: 생성=${stats.rowsCreated} 수정=${stats.rowsUpdated} 건너뜀=${stats.rowsSkipped} 실패=${stats.rowsFailed}`);
      console.log(`[SheetSync] Ward 환자매칭: 총=${resolverStats.total} 성공=${resolverStats.resolved} 미매칭=${resolverStats.unresolved}`);
      await logger.complete(data.syncLogId, stats, contentHash);

    } else if (data.sheetTab === 'outpatient') {
      // ── 외래예약 시트 동기화 (여러 탭) ──
      const outpatientSyncer = new OutpatientSyncer(prisma);
      const tabs = OutpatientSyncer.getTabsForSync();

      let totalStats = { rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0, rowsSkipped: 0, rowsFailed: 0 };

      for (const { tab, year } of tabs) {
        try {
          console.log(`[SheetSync] 외래예약 탭 읽기: ${spreadsheetId} / ${tab}`);
          const tabRows = await readFullTab(spreadsheetId, tab);
          if (tabRows.length === 0) {
            console.log(`[SheetSync] 외래예약 탭 비어있음: ${tab}`);
            continue;
          }

          const contentHash = computeOutpatientContentHash(
            parseOutpatientSheet(tabRows, year, tab)
          );
          const lastSync = await logger.getLastSync(data.sheetId, tab);
          if (lastSync?.contentHash === contentHash) {
            console.log(`[SheetSync] 외래예약 탭 contentHash 동일 — 건너뜀: ${tab}`);
            continue;
          }

          const tabStats = await outpatientSyncer.upsertFromSheet(tabRows, tab, startedAt);
          totalStats.rowsProcessed += tabStats.rowsProcessed;
          totalStats.rowsCreated += tabStats.rowsCreated;
          totalStats.rowsUpdated += tabStats.rowsUpdated;
          totalStats.rowsSkipped += tabStats.rowsSkipped;
          totalStats.rowsFailed += tabStats.rowsFailed;

          // 탭별 log 기록
          const tabLogId = await logger.start({
            sheetId: data.sheetId, sheetTab: tab, syncType: 'FULL',
            direction: 'SHEET_TO_DB', triggeredBy: data.triggeredBy,
          });
          await logger.complete(tabLogId, tabStats, contentHash);
        } catch (err: any) {
          console.error(`[SheetSync] 외래예약 탭 실패 ${tab}:`, err.message);
          totalStats.rowsFailed++;
        }
      }

      const resolverStats = outpatientSyncer.getResolverStats();
      console.log(`[SheetSync] 외래예약 전체: 생성=${totalStats.rowsCreated} 수정=${totalStats.rowsUpdated} 건너뜀=${totalStats.rowsSkipped} 실패=${totalStats.rowsFailed}`);
      console.log(`[SheetSync] 외래예약 환자매칭: 총=${resolverStats.total} 성공=${resolverStats.resolved} 미매칭=${resolverStats.unresolved}`);
      await logger.complete(data.syncLogId, totalStats);

    } else {
      console.warn(`[SheetSync] 알 수 없는 sheetTab: ${data.sheetTab}`);
      await logger.complete(data.syncLogId, {
        rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0,
        rowsSkipped: 0, rowsFailed: 0,
      });
    }

    const elapsed = Date.now() - startedAt.getTime();
    console.log(`[SheetSync] 동기화 완료: ${data.sheetTab} (${elapsed}ms)`);
  } catch (err: any) {
    console.error(`[SheetSync] 동기화 실패: ${data.sheetTab}`, err.message);

    await prisma.sheetSyncLog.update({
      where: { id: data.syncLogId },
      data: {
        completedAt: new Date(),
        errorDetails: { error: err.message, stack: err.stack?.substring(0, 500) },
      },
    }).catch(() => {});

    throw err;
  }
}

// ─── 큐에 작업 추가 (Redis 없으면 인라인 실행) ───
export async function enqueueSheetSync(data: SheetSyncJobData): Promise<{ mode: 'queued' | 'inline' }> {
  if (sheetSyncQueue) {
    const jobId = `${data.sheetId}:${data.sheetTab}`;
    await sheetSyncQueue.add('sync', data, {
      jobId,
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return { mode: 'queued' };
  }

  console.log('[SheetSync] Redis 미사용 — 인라인 동기화 실행');
  await executeSyncJob(data);
  return { mode: 'inline' };
}

// ─── Worker 시작 (서버 기동 시 호출) ───
export function startSheetSyncWorker(): void {
  const connection = getRedisConnection();

  if (!connection) {
    console.log('[SheetSync] Redis 미설정 — BullMQ Worker 비활성, 인라인 모드 사용');
    return;
  }

  try {
    sheetSyncQueue = new Queue<SheetSyncJobData>('sheet-sync', {
      connection,
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
    });

    sheetSyncWorker = new Worker<SheetSyncJobData>(
      'sheet-sync',
      async (job: Job<SheetSyncJobData>) => {
        await executeSyncJob(job.data);
      },
      {
        connection,
        concurrency: 1,
        lockDuration: 600_000,
        lockRenewTime: 300_000,
      },
    );

    sheetSyncWorker.on('completed', (job) => {
      console.log(`[SheetSync Worker] Job ${job.id} 완료`);
    });
    sheetSyncWorker.on('failed', (job, err) => {
      console.error(`[SheetSync Worker] Job ${job?.id} 실패:`, err.message);
    });
    sheetSyncWorker.on('error', (err) => {
      console.error('[SheetSync Worker] 오류:', err.message);
    });

    console.log('[SheetSync] BullMQ Worker 시작 (concurrency: 1, lockTTL: 10분)');
  } catch (err: any) {
    console.error('[SheetSync] BullMQ 초기화 실패 — 인라인 모드로 동작:', err.message);
    sheetSyncQueue = null;
    sheetSyncWorker = null;
  }
}

// ─── 정리 (서버 종료 시) ───
export async function stopSheetSyncWorker(): Promise<void> {
  if (sheetSyncWorker) {
    await sheetSyncWorker.close();
    sheetSyncWorker = null;
  }
  if (sheetSyncQueue) {
    await sheetSyncQueue.close();
    sheetSyncQueue = null;
  }
}

// ═══════════════════════════════════════════════════════════
// 5분 자동 동기화 (서버 사이드 타이머)
// ═══════════════════════════════════════════════════════════

let autoSyncInterval: ReturnType<typeof setInterval> | null = null;
let autoSyncRunning = false;

async function runAutoSync(): Promise<void> {
  if (autoSyncRunning) {
    console.log('[AutoSync] 이전 동기화 진행 중 — 스킵');
    return;
  }

  autoSyncRunning = true;
  try {
    // 1) 설정 확인
    const configured = await isGoogleSheetsConfigured();
    if (!configured) return;

    const config = await prisma.googleSheetsConfig.findUnique({
      where: { id: 'singleton' },
      select: {
        autoSyncEnabled: true,
        rfSpreadsheetId: true,
        manualSpreadsheetId: true,
        wardSpreadsheetId: true,
        outpatientSpreadsheetId: true,
      },
    });

    if (!config?.autoSyncEnabled) return;

    console.log('[AutoSync] 5분 자동 동기화 실행');

    // 2) RF + Manual + Ward + Outpatient 순차 동기화
    const syncTargets = [
      { tab: 'rf', spreadsheetId: config.rfSpreadsheetId || env.RF_SPREADSHEET_ID },
      { tab: 'manual', spreadsheetId: config.manualSpreadsheetId || env.MANUAL_SPREADSHEET_ID },
      { tab: 'ward', spreadsheetId: config.wardSpreadsheetId || env.WARD_SPREADSHEET_ID },
      { tab: 'outpatient', spreadsheetId: config.outpatientSpreadsheetId || env.OUTPATIENT_SPREADSHEET_ID },
    ] as const;

    for (const { tab, spreadsheetId } of syncTargets) {
      if (!spreadsheetId) continue;

      try {
        const log = await prisma.sheetSyncLog.create({
          data: {
            sheetId: spreadsheetId,
            sheetTab: tab,
            syncType: 'FULL',
            direction: 'SHEET_TO_DB',
            triggeredBy: 'auto_sync_timer',
            startedAt: new Date(),
          },
        });

        await enqueueSheetSync({
          syncLogId: log.id,
          sheetId: spreadsheetId,
          sheetTab: tab,
          syncType: 'FULL',
          triggeredBy: 'auto_sync_timer',
        });
      } catch (err: any) {
        console.error(`[AutoSync] ${tab} 동기화 오류:`, err.message);
      }
    }

    // 3) 마지막 동기화 시각 기록
    await prisma.googleSheetsConfig.update({
      where: { id: 'singleton' },
      data: { lastAutoSyncAt: new Date() },
    }).catch(() => {});

  } catch (err: any) {
    console.error('[AutoSync] 자동 동기화 오류:', err.message);
  } finally {
    autoSyncRunning = false;
  }
}

export function startAutoSheetSync(): void {
  // 서버 기동 후 30초 뒤 첫 동기화
  setTimeout(() => {
    runAutoSync().catch(err => console.error('[AutoSync] 초기 동기화 오류:', err.message));
  }, 30_000);

  // 5분 간격 반복
  autoSyncInterval = setInterval(() => {
    runAutoSync().catch(err => console.error('[AutoSync] 반복 동기화 오류:', err.message));
  }, 5 * 60 * 1000);

  console.log('[AutoSync] 5분 자동 동기화 타이머 시작 (30초 후 첫 실행)');
}

export function stopAutoSheetSync(): void {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
  console.log('[AutoSync] 자동 동기화 타이머 중지');
}
