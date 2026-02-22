/**
 * Outpatient API (외래 예약 - Google Sheets 미러)
 * GET    /api/outpatient/daily           — 일간 예약 목록
 * GET    /api/outpatient/weekly-summary  — 주간 의사별 요약
 * GET    /api/outpatient/unmatched       — Patient 미매칭 목록
 * POST   /api/outpatient/appointments   — 생성 (즉시 write-back)
 * PATCH  /api/outpatient/appointments/:id — 수정
 * PATCH  /api/outpatient/appointments/:id/match-patient
 * DELETE /api/outpatient/appointments/:id
 * POST   /api/outpatient/sync           — 수동 동기화 트리거
 */

import { Router } from 'express';
import { z } from 'zod';
import { format } from 'date-fns';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { enqueueSheetSync } from '../queues/sheetSyncQueue';
import { isGoogleSheetsConfigured, getSpreadsheetId } from '../services/sheetSync/googleSheets';

const router = Router();

// ── GET /api/outpatient/daily ───────────────────────────────────
// ?date=2026-02-07  ?doctorCode=C
router.get(
  '/daily',
  requireAuth,
  requirePermission('APPOINTMENTS', 'READ'),
  asyncHandler(async (req, res) => {
    const { date, doctorCode } = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      doctorCode: z.string().optional(),
    }).parse(req.query);

    const targetDate = new Date(date);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const where: any = {
      appointmentDate: { gte: targetDate, lt: nextDate },
      deletedAt: null,
    };
    if (doctorCode) where.doctorCode = doctorCode;

    const appointments = await prisma.outpatientAppointment.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true, phone: true } },
      },
      orderBy: [{ timeSlot: 'asc' }, { doctorCode: 'asc' }, { slotIndex: 'asc' }],
    });

    // 시간대별 그룹핑
    const grouped = new Map<string, typeof appointments>();
    for (const appt of appointments) {
      const key = appt.timeSlot;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(appt);
    }

    const timeSlots = Array.from(grouped.entries()).map(([time, items]) => ({
      timeSlot: time,
      appointments: items,
    }));

    const totalCount = appointments.length;
    const doctorCounts = appointments.reduce<Record<string, number>>((acc, a) => {
      const code = a.doctorCode ?? 'UNKNOWN';
      acc[code] = (acc[code] ?? 0) + 1;
      return acc;
    }, {});
    const newPatientCount = appointments.filter(a => a.isNewPatient).length;

    res.json({
      success: true,
      data: {
        date,
        timeSlots,
        summary: { totalCount, doctorCounts, newPatientCount },
      },
    });
  }),
);

// ── GET /api/outpatient/weekly-summary ──────────────────────────
// ?start=2026-02-03  (월요일 기준)
router.get(
  '/weekly-summary',
  requireAuth,
  requirePermission('APPOINTMENTS', 'READ'),
  asyncHandler(async (req, res) => {
    const { start } = z.object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.query);

    const startDate = new Date(start);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59);

    const appointments = await prisma.outpatientAppointment.findMany({
      where: {
        appointmentDate: { gte: startDate, lte: endDate },
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
      select: {
        appointmentDate: true,
        doctorCode: true,
        isNewPatient: true,
        status: true,
      },
    });

    // 날짜 × 의사 집계
    const summary: Record<string, Record<string, { total: number; newPatients: number }>> = {};
    for (const appt of appointments) {
      const dateKey = format(appt.appointmentDate, 'yyyy-MM-dd');
      const doctor = appt.doctorCode ?? 'UNKNOWN';
      if (!summary[dateKey]) summary[dateKey] = {};
      if (!summary[dateKey][doctor]) summary[dateKey][doctor] = { total: 0, newPatients: 0 };
      summary[dateKey][doctor].total++;
      if (appt.isNewPatient) summary[dateKey][doctor].newPatients++;
    }

    res.json({ success: true, data: { start, end: format(endDate, 'yyyy-MM-dd'), summary } });
  }),
);

// ── GET /api/outpatient/unmatched ───────────────────────────────
router.get(
  '/unmatched',
  requireAuth,
  requirePermission('APPOINTMENTS', 'READ'),
  asyncHandler(async (_req, res) => {
    const unmatched = await prisma.outpatientAppointment.findMany({
      where: {
        patientId: null,
        deletedAt: null,
        patientNameRaw: { not: '' },
        status: { not: 'CANCELLED' },
      },
      orderBy: { appointmentDate: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: unmatched });
  }),
);

// ── POST /api/outpatient/appointments ───────────────────────────
const createApptSchema = z.object({
  appointmentDate: z.string(),
  timeSlot: z.string(),
  doctorCode: z.string().optional().nullable(),
  slotIndex: z.number().int().default(1),
  patientId: z.string().optional(),
  patientNameRaw: z.string().optional(),
  isNewPatient: z.boolean().default(false),
  phoneNumber: z.string().optional(),
  treatmentContent: z.string().optional(),
  sheetTab: z.string(),
  sheetA1Name: z.string(),
  sheetA1Doctor: z.string().optional(),
  sheetA1Phone: z.string().optional(),
  sheetA1Content: z.string().optional(),
});

router.post(
  '/appointments',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  asyncHandler(async (req, res) => {
    const body = createApptSchema.parse(req.body);

    // 중복 체크 (sheetTab + sheetA1Name)
    const existing = await prisma.outpatientAppointment.findFirst({
      where: {
        sheetTab: body.sheetTab,
        sheetA1Name: body.sheetA1Name,
        deletedAt: null,
      },
    });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', '동일 좌표의 예약이 이미 존재합니다.');
    }

    const appointment = await prisma.outpatientAppointment.create({
      data: {
        ...body,
        appointmentDate: new Date(body.appointmentDate),
        lastUpdatedSource: 'WEB',
        needsSheetWriteback: true,
      },
    });

    res.status(201).json({ success: true, data: appointment });
  }),
);

// ── PATCH /api/outpatient/appointments/:id ──────────────────────
const updateApptSchema = z.object({
  patientId: z.string().optional(),
  patientNameRaw: z.string().optional(),
  isNewPatient: z.boolean().optional(),
  phoneNumber: z.string().optional().nullable(),
  treatmentContent: z.string().optional().nullable(),
  doctorCode: z.string().optional().nullable(),
  status: z.enum(['BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'CHANGED']).optional(),
  timeSlot: z.string().optional(),
}).partial();

router.patch(
  '/appointments/:id',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = updateApptSchema.parse(req.body);

    const existing = await prisma.outpatientAppointment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');

    const appointment = await prisma.outpatientAppointment.update({
      where: { id },
      data: {
        ...body,
        isManualOverride: true,
        lastUpdatedSource: 'WEB',
        needsSheetWriteback: true,
      },
    });

    res.json({ success: true, data: appointment });
  }),
);

// ── PATCH /api/outpatient/appointments/:id/match-patient ────────
router.patch(
  '/appointments/:id/match-patient',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { patientId } = z.object({ patientId: z.string() }).parse(req.body);

    const existing = await prisma.outpatientAppointment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');

    const patient = await prisma.patient.findFirst({ where: { id: patientId } });
    if (!patient) throw new AppError(404, 'NOT_FOUND', '환자를 찾을 수 없습니다.');

    const updated = await prisma.outpatientAppointment.update({
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

// ── DELETE /api/outpatient/appointments/:id ─────────────────────
router.delete(
  '/appointments/:id',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('DELETE', 'OutpatientAppointment'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await prisma.outpatientAppointment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');

    await prisma.outpatientAppointment.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'CANCELLED',
        lastUpdatedSource: 'WEB',
        needsSheetWriteback: true,
      },
    });

    res.json({ success: true, data: { id } });
  }),
);

// ── POST /api/outpatient/sync ───────────────────────────────────
router.post(
  '/sync',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  asyncHandler(async (_req, res) => {
    if (!(await isGoogleSheetsConfigured())) {
      throw new AppError(503, 'SHEETS_NOT_CONFIGURED', 'Google Sheets 미설정');
    }

    const spreadsheetId = await getSpreadsheetId('outpatient');
    if (!spreadsheetId) {
      throw new AppError(503, 'SHEETS_NOT_CONFIGURED', 'OUTPATIENT_SPREADSHEET_ID 환경변수 미설정');
    }

    const log = await prisma.sheetSyncLog.create({
      data: {
        sheetId: spreadsheetId,
        sheetTab: 'outpatient',
        syncType: 'FULL',
        direction: 'SHEET_TO_DB',
        triggeredBy: 'manual',
        startedAt: new Date(),
      },
    });

    const { mode } = await enqueueSheetSync({
      syncLogId: log.id,
      sheetId: spreadsheetId,
      sheetTab: 'outpatient',
      syncType: 'FULL',
      triggeredBy: 'manual',
    });

    res.json({
      success: true,
      data: { message: 'Outpatient sync job queued', mode, syncLogId: log.id },
    });
  }),
);

export default router;
