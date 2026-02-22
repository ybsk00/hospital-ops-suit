import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { enqueueSheetSync } from '../queues';

const router = Router();

// ─── POST /api/sheet-sync/trigger ── 수동 동기화 트리거 ───
const triggerSchema = z.object({
  sheetTab: z.enum(['rf', 'manual']),
  syncType: z.enum(['FULL', 'INCREMENTAL']).optional().default('FULL'),
});

router.post(
  '/trigger',
  requireAuth,
  requirePermission('SCHEDULING', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = triggerSchema.parse(req.body);

    // Create sync log entry
    const log = await prisma.sheetSyncLog.create({
      data: {
        sheetId: body.sheetTab === 'rf' ? 'rf_schedule' : 'manual_therapy',
        sheetTab: body.sheetTab,
        syncType: body.syncType,
        direction: 'SHEET_TO_DB',
        triggeredBy: `manual:${(req as any).user?.loginId || 'unknown'}`,
        startedAt: new Date(),
      },
    });

    // BullMQ 큐에 등록 (Redis 없으면 인라인 실행)
    const result = await enqueueSheetSync({
      syncLogId: log.id,
      sheetId: log.sheetId,
      sheetTab: body.sheetTab,
      syncType: body.syncType,
      triggeredBy: log.triggeredBy || 'manual',
    });

    res.status(202).json({
      success: true,
      data: {
        syncId: log.id,
        message: '동기화가 시작되었습니다.',
        status: result.mode === 'queued' ? 'QUEUED' : 'COMPLETED',
        mode: result.mode,
      },
    });
  }),
);

// ─── POST /api/sheet-sync/webhook ── Apps Script → 서버 웹훅 ───
const webhookSchema = z.object({
  sheetId: z.string(),
  sheetTab: z.string(),
  syncType: z.enum(['FULL', 'INCREMENTAL']).optional().default('FULL'),
  lastEditedAt: z.string().optional(),
});

router.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    // API key authentication
    const syncKey = req.headers['x-sync-key'] as string;
    if (!env.SHEET_SYNC_API_KEY || syncKey !== env.SHEET_SYNC_API_KEY) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Invalid sync API key');
    }

    const body = webhookSchema.parse(req.body);

    const log = await prisma.sheetSyncLog.create({
      data: {
        sheetId: body.sheetId,
        sheetTab: body.sheetTab,
        syncType: body.syncType,
        direction: 'SHEET_TO_DB',
        triggeredBy: 'apps_script_webhook',
        startedAt: new Date(),
        sourceLastEditedAt: body.lastEditedAt ? new Date(body.lastEditedAt) : undefined,
      },
    });

    // BullMQ 큐에 등록
    const result = await enqueueSheetSync({
      syncLogId: log.id,
      sheetId: body.sheetId,
      sheetTab: body.sheetTab,
      syncType: body.syncType,
      triggeredBy: 'apps_script_webhook',
    });

    res.status(202).json({
      success: true,
      data: { syncId: log.id, status: result.mode === 'queued' ? 'QUEUED' : 'COMPLETED', mode: result.mode },
    });
  }),
);

// ─── GET /api/sheet-sync/logs ── 동기화 이력 조회 ───
router.get(
  '/logs',
  requireAuth,
  requirePermission('SCHEDULING', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { sheetTab, limit = '20', page = '1' } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);

    const where: any = {};
    if (sheetTab) where.sheetTab = sheetTab;

    const [total, logs] = await Promise.all([
      prisma.sheetSyncLog.count({ where }),
      prisma.sheetSyncLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        select: {
          id: true,
          sheetId: true,
          sheetTab: true,
          syncType: true,
          direction: true,
          startedAt: true,
          completedAt: true,
          rowsProcessed: true,
          rowsCreated: true,
          rowsUpdated: true,
          rowsFailed: true,
          contentHash: true,
          triggeredBy: true,
          errorDetails: true,
        },
      }),
    ]);

    res.json({
      success: true,
      data: logs,
      meta: { total, page: pageNum, limit: limitNum },
    });
  }),
);

// ─── GET /api/sheet-sync/pending-count ── 미매칭(patientId=null) 건수 ───
router.get(
  '/pending-count',
  requireAuth,
  requirePermission('SCHEDULING', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const [rfUnmatched, manualUnmatched] = await Promise.all([
      prisma.rfScheduleSlot.count({
        where: {
          deletedAt: null,
          patientId: null,
          status: { not: 'CANCELLED' },
          patientNameRaw: { not: null },
        },
      }),
      prisma.manualTherapySlot.count({
        where: {
          deletedAt: null,
          patientId: null,
          status: { not: 'CANCELLED' },
          patientNameRaw: { not: null },
          isAdminWork: false,
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        rfUnmatched,
        manualUnmatched,
        total: rfUnmatched + manualUnmatched,
      },
    });
  }),
);

// ─── POST /api/sheet-sync/resolve-pending ── 미매칭 일괄 재매칭 ───
router.post(
  '/resolve-pending',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    let resolved = 0;
    let failed = 0;

    // RF unmatched slots with patient name
    const rfSlots = await prisma.rfScheduleSlot.findMany({
      where: {
        deletedAt: null,
        patientId: null,
        status: { not: 'CANCELLED' },
        patientNameRaw: { not: null },
      },
      select: { id: true, patientNameRaw: true, patientEmrId: true },
    });

    for (const slot of rfSlots) {
      try {
        // Try EMR ID first
        let patient = slot.patientEmrId
          ? await prisma.patient.findFirst({
              where: { emrPatientId: slot.patientEmrId, deletedAt: null },
              select: { id: true },
            })
          : null;

        // Then try name
        if (!patient && slot.patientNameRaw) {
          const cleanName = slot.patientNameRaw.replace(/^[☆★]/, '').replace(/\d+$/, '').trim();
          const patients = await prisma.patient.findMany({
            where: { name: cleanName, status: 'ACTIVE', deletedAt: null },
            select: { id: true },
          });
          if (patients.length === 1) patient = patients[0];
        }

        if (patient) {
          await prisma.rfScheduleSlot.update({
            where: { id: slot.id },
            data: { patientId: patient.id },
          });
          resolved++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Manual unmatched slots
    const manualSlots = await prisma.manualTherapySlot.findMany({
      where: {
        deletedAt: null,
        patientId: null,
        status: { not: 'CANCELLED' },
        patientNameRaw: { not: null },
        isAdminWork: false,
      },
      select: { id: true, patientNameRaw: true },
    });

    for (const slot of manualSlots) {
      try {
        if (!slot.patientNameRaw) continue;
        const cleanName = slot.patientNameRaw.replace(/^[☆★]/, '').replace(/\d+$/, '').trim();
        const patients = await prisma.patient.findMany({
          where: { name: cleanName, status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });

        if (patients.length === 1) {
          await prisma.manualTherapySlot.update({
            where: { id: slot.id },
            data: { patientId: patients[0].id },
          });
          resolved++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    res.json({
      success: true,
      data: {
        totalProcessed: rfSlots.length + manualSlots.length,
        resolved,
        failed,
      },
    });
  }),
);

export default router;
