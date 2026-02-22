/**
 * Ward API (입원현황 - Google Sheets 미러)
 * GET  /api/ward/beds          — WardBed 마스터 목록
 * GET  /api/ward/status        — 병상별 현재 입원/예정 현황
 * GET  /api/ward/unmatched     — Patient 미매칭 WardAdmission 목록
 * POST /api/ward/admissions    — WardAdmission 생성 (웹 직접 입력)
 * PATCH /api/ward/admissions/:id — 수정
 * PATCH /api/ward/admissions/:id/match-patient — 환자 매칭
 * DELETE /api/ward/admissions/:id — soft delete
 * GET  /api/ward/waiting-memos — WardWaitingMemo 목록
 * POST /api/ward/sync          — Google Sheets 수동 동기화 트리거
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { enqueueSheetSync } from '../queues/sheetSyncQueue';
import { isGoogleSheetsConfigured, getSpreadsheetId } from '../services/sheetSync/googleSheets';

const router = Router();

// ── GET /api/ward/beds ──────────────────────────────────────────
router.get(
  '/beds',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (_req, res) => {
    const beds = await prisma.wardBed.findMany({
      where: { isActive: true },
      orderBy: [{ wardType: 'asc' }, { roomNumber: 'asc' }, { bedPosition: 'asc' }],
    });
    res.json({ success: true, data: beds });
  }),
);

// ── GET /api/ward/status ────────────────────────────────────────
// ?month=2026-02 (기본: 현재 월)
router.get(
  '/status',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (req, res) => {
    const monthStr = req.query.month as string | undefined;
    let startDate: Date;
    let endDate: Date;

    if (monthStr) {
      const [y, m] = monthStr.split('-').map(Number);
      startDate = new Date(y, m - 1, 1);
      endDate = new Date(y, m, 0, 23, 59, 59);
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    const beds = await prisma.wardBed.findMany({
      where: { isActive: true },
      include: {
        admissions: {
          where: {
            deletedAt: null,
            OR: [
              {
                admitDate: { lte: endDate },
                dischargeDate: { gte: startDate },
              },
              {
                admitDate: { gte: startDate, lte: endDate },
              },
              {
                admitDate: null,
              },
            ],
          },
          include: {
            patient: {
              select: { id: true, name: true, emrPatientId: true, phone: true },
            },
          },
          orderBy: [{ sheetLineIndex: 'asc' }],
        },
      },
      orderBy: [{ wardType: 'asc' }, { roomNumber: 'asc' }, { bedPosition: 'asc' }],
    });

    // 요약 통계
    const totalBeds = beds.length;
    let occupiedCount = 0;
    let plannedCount = 0;
    let emptyCount = 0;

    for (const bed of beds) {
      const active = bed.admissions.filter(
        (a: { status: string }) => a.status === 'ADMITTED' || a.status === 'PLANNED'
      );
      if (active.some((a: { status: string }) => a.status === 'ADMITTED')) occupiedCount++;
      else if (active.some((a: { status: string }) => a.status === 'PLANNED')) plannedCount++;
      else emptyCount++;
    }

    res.json({
      success: true,
      data: {
        beds,
        summary: { totalBeds, occupiedCount, plannedCount, emptyCount },
      },
    });
  }),
);

// ── GET /api/ward/unmatched ─────────────────────────────────────
router.get(
  '/unmatched',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (_req, res) => {
    const unmatched = await prisma.wardAdmission.findMany({
      where: {
        patientId: null,
        deletedAt: null,
        patientNameRaw: { not: '' },
      },
      include: {
        bed: { select: { bedKey: true, roomNumber: true, wardType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: unmatched });
  }),
);

// ── GET /api/ward/waiting-memos ─────────────────────────────────
// ?sheetTab=2026-02
router.get(
  '/waiting-memos',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (req, res) => {
    const sheetTab = req.query.sheetTab as string | undefined;
    const memos = await prisma.wardWaitingMemo.findMany({
      where: sheetTab ? { sheetTab } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: memos });
  }),
);

// ── POST /api/ward/admissions ───────────────────────────────────
const createAdmissionSchema = z.object({
  bedId: z.string(),
  patientId: z.string().optional(),
  patientNameRaw: z.string().optional(),
  diagnosis: z.string().optional(),
  admitDate: z.string().optional(),
  dischargeDate: z.string().optional(),
  dischargeTime: z.string().optional(),
  status: z.enum(['ADMITTED', 'PLANNED', 'WAITING', 'DISCHARGED', 'CANCELLED']).default('ADMITTED'),
  isPlanned: z.boolean().default(false),
  note: z.string().optional(),
  sheetTab: z.string(),
  sheetA1: z.string(),
  sheetRegion: z.enum(['CURRENT', 'PLANNED', 'SIDE_MEMO']).default('CURRENT'),
  sheetLineIndex: z.number().int().default(0),
});

router.post(
  '/admissions',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  asyncHandler(async (req, res) => {
    const body = createAdmissionSchema.parse(req.body);

    const admission = await prisma.wardAdmission.create({
      data: {
        ...body,
        admitDate: body.admitDate ? new Date(body.admitDate) : null,
        dischargeDate: body.dischargeDate ? new Date(body.dischargeDate) : null,
        lastUpdatedSource: 'WEB',
        needsSheetWriteback: true,
      },
    });

    res.status(201).json({ success: true, data: admission });
  }),
);

// ── PATCH /api/ward/admissions/:id ─────────────────────────────
const updateAdmissionSchema = z.object({
  patientId: z.string().optional(),
  patientNameRaw: z.string().optional(),
  diagnosis: z.string().optional(),
  admitDate: z.string().optional().nullable(),
  dischargeDate: z.string().optional().nullable(),
  dischargeTime: z.string().optional().nullable(),
  status: z.enum(['ADMITTED', 'PLANNED', 'WAITING', 'DISCHARGED', 'CANCELLED']).optional(),
  isPlanned: z.boolean().optional(),
  note: z.string().optional(),
}).partial();

router.patch(
  '/admissions/:id',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = updateAdmissionSchema.parse(req.body);

    const existing = await prisma.wardAdmission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '입원 레코드를 찾을 수 없습니다.');

    const admission = await prisma.wardAdmission.update({
      where: { id },
      data: {
        ...body,
        admitDate: body.admitDate !== undefined
          ? (body.admitDate ? new Date(body.admitDate) : null)
          : undefined,
        dischargeDate: body.dischargeDate !== undefined
          ? (body.dischargeDate ? new Date(body.dischargeDate) : null)
          : undefined,
        isManualOverride: true,
        lastUpdatedSource: 'WEB',
        needsSheetWriteback: true,
      },
    });

    res.json({ success: true, data: admission });
  }),
);

// ── PATCH /api/ward/admissions/:id/match-patient ────────────────
router.patch(
  '/admissions/:id/match-patient',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { patientId } = z.object({ patientId: z.string() }).parse(req.body);

    const admission = await prisma.wardAdmission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!admission) throw new AppError(404, 'NOT_FOUND', '입원 레코드를 찾을 수 없습니다.');

    const patient = await prisma.patient.findFirst({ where: { id: patientId } });
    if (!patient) throw new AppError(404, 'NOT_FOUND', '환자를 찾을 수 없습니다.');

    const updated = await prisma.wardAdmission.update({
      where: { id },
      data: {
        patientId,
        lastUpdatedSource: 'WEB',
      },
      include: { patient: { select: { id: true, name: true, emrPatientId: true } } },
    });

    res.json({ success: true, data: updated });
  }),
);

// ── DELETE /api/ward/admissions/:id ────────────────────────────
router.delete(
  '/admissions/:id',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  auditLog('DELETE', 'WardAdmission'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const admission = await prisma.wardAdmission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!admission) throw new AppError(404, 'NOT_FOUND', '입원 레코드를 찾을 수 없습니다.');

    await prisma.wardAdmission.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true, data: { id } });
  }),
);

// ── POST /api/ward/sync ─────────────────────────────────────────
router.post(
  '/sync',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  asyncHandler(async (_req, res) => {
    if (!(await isGoogleSheetsConfigured())) {
      throw new AppError(503, 'SHEETS_NOT_CONFIGURED', 'Google Sheets 미설정');
    }

    const spreadsheetId = await getSpreadsheetId('ward');
    if (!spreadsheetId) {
      throw new AppError(503, 'SHEETS_NOT_CONFIGURED', 'WARD_SPREADSHEET_ID 환경변수 미설정');
    }

    const log = await prisma.sheetSyncLog.create({
      data: {
        sheetId: spreadsheetId,
        sheetTab: 'ward',
        syncType: 'FULL',
        direction: 'SHEET_TO_DB',
        triggeredBy: 'manual',
        startedAt: new Date(),
      },
    });

    const { mode } = await enqueueSheetSync({
      syncLogId: log.id,
      sheetId: spreadsheetId,
      sheetTab: 'ward',
      syncType: 'FULL',
      triggeredBy: 'manual',
    });

    res.json({
      success: true,
      data: { message: 'Ward sync job queued', mode, syncLogId: log.id },
    });
  }),
);

export default router;
