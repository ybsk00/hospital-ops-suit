/**
 * 의사 근무 스케줄 API
 * - 월간 근무/휴무 캘린더
 * - 특정일 근무 여부
 * - 휴무일 추가/삭제
 * - 정규 근무패턴 변경
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';

const router = Router();

// ── GET /monthly — 월간 근무/휴무 캘린더 ──
router.get(
  '/monthly',
  requireAuth,
  asyncHandler(async (req, res) => {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;

    const doctors = await prisma.doctor.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, doctorCode: true, workDays: true, workStartTime: true, workEndTime: true },
      orderBy: { name: 'asc' },
    });

    // 해당 월의 모든 휴무일 조회
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // 마지막 날

    const dayOffs = await prisma.doctorDayOff.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        doctor: { isActive: true },
      },
      select: { doctorId: true, date: true, reason: true, id: true },
    });

    // 의사별 일별 근무 상태 생성
    const daysInMonth = endDate.getDate();
    const calendar = doctors.map((doc) => {
      const days: { date: string; status: 'WORKING' | 'DAY_OFF' | 'REGULAR_OFF'; reason?: string; dayOffId?: string }[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dateStr = date.toISOString().split('T')[0];
        const dow = date.getDay();

        const dayOff = dayOffs.find(
          (off) => off.doctorId === doc.id && new Date(off.date).getDate() === d,
        );

        if (dayOff) {
          days.push({ date: dateStr, status: 'DAY_OFF', reason: dayOff.reason || undefined, dayOffId: dayOff.id });
        } else if (!doc.workDays.includes(dow)) {
          days.push({ date: dateStr, status: 'REGULAR_OFF' });
        } else {
          days.push({ date: dateStr, status: 'WORKING' });
        }
      }
      return { doctor: doc, days };
    });

    res.json({ success: true, data: { year, month, calendar } });
  }),
);

// ── GET /availability — 특정일 근무 여부 ──
router.get(
  '/availability',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { doctorId, date } = req.query;
    if (!doctorId || !date) throw new AppError(400, 'INVALID_REQUEST', 'doctorId와 date가 필요합니다');

    const d = new Date(date as string);
    const doctor = await prisma.doctor.findFirst({
      where: { id: doctorId as string, isActive: true, deletedAt: null },
    });
    if (!doctor) throw new AppError(404, 'NOT_FOUND', '의사를 찾을 수 없습니다');

    const dow = d.getDay();
    const isRegularWorkDay = doctor.workDays.includes(dow);

    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayOff = await prisma.doctorDayOff.findUnique({
      where: { doctorId_date: { doctorId: doctor.id, date: dateOnly } },
    });

    const isWorking = isRegularWorkDay && !dayOff;
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    let reason: string | undefined;
    if (!isRegularWorkDay) reason = `${dayNames[dow]}요일 정규 휴무`;
    else if (dayOff) reason = dayOff.reason || '특별 휴무';

    res.json({
      success: true,
      data: {
        doctorId: doctor.id,
        doctorName: doctor.name,
        date: (date as string),
        isWorking,
        reason,
        workStartTime: doctor.workStartTime,
        workEndTime: doctor.workEndTime,
      },
    });
  }),
);

// ── POST /day-off — 휴무일 추가 ──
router.post(
  '/day-off',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  auditLog('CREATE', 'DOCTOR_DAY_OFF'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      doctorId: z.string(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().optional(),
    });
    const body = schema.parse(req.body);

    const doctor = await prisma.doctor.findFirst({
      where: { id: body.doctorId, isActive: true, deletedAt: null },
    });
    if (!doctor) throw new AppError(404, 'NOT_FOUND', '의사를 찾을 수 없습니다');

    const dateOnly = new Date(body.date);

    // 중복 체크
    const existing = await prisma.doctorDayOff.findUnique({
      where: { doctorId_date: { doctorId: body.doctorId, date: dateOnly } },
    });
    if (existing) throw new AppError(409, 'DUPLICATE', '이미 등록된 휴무일입니다');

    const dayOff = await prisma.doctorDayOff.create({
      data: {
        doctorId: body.doctorId,
        date: dateOnly,
        reason: body.reason,
        createdById: req.user!.id,
      },
    });

    res.status(201).json({ success: true, data: dayOff });
  }),
);

// ── DELETE /day-off/:id — 휴무일 삭제 ──
router.delete(
  '/day-off/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  auditLog('DELETE', 'DOCTOR_DAY_OFF'),
  asyncHandler(async (req, res) => {
    const dayOff = await prisma.doctorDayOff.findUnique({
      where: { id: req.params.id },
    });
    if (!dayOff) throw new AppError(404, 'NOT_FOUND', '휴무일을 찾을 수 없습니다');

    await prisma.doctorDayOff.delete({ where: { id: req.params.id } });

    res.json({ success: true, data: { deleted: true } });
  }),
);

// ── PATCH /work-pattern/:doctorId — 정규 근무패턴 변경 ──
router.patch(
  '/work-pattern/:doctorId',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  auditLog('UPDATE', 'DOCTOR'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      workDays: z.array(z.number().min(0).max(6)),
      workStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      workEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    });
    const body = schema.parse(req.body);

    const doctor = await prisma.doctor.findFirst({
      where: { id: req.params.doctorId, isActive: true, deletedAt: null },
    });
    if (!doctor) throw new AppError(404, 'NOT_FOUND', '의사를 찾을 수 없습니다');

    const updated = await prisma.doctor.update({
      where: { id: req.params.doctorId },
      data: {
        workDays: body.workDays,
        ...(body.workStartTime && { workStartTime: body.workStartTime }),
        ...(body.workEndTime && { workEndTime: body.workEndTime }),
      },
    });

    res.json({ success: true, data: updated });
  }),
);

export default router;
