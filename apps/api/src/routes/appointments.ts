import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { AppointmentStatus } from '@prisma/client';

const router = Router();

// ============================================================
// Zod Schemas
// ============================================================

const createAppointmentSchema = z.object({
  patientId: z.string().uuid('유효한 환자 ID가 필요합니다.'),
  doctorId: z.string().uuid('유효한 의사 ID가 필요합니다.'),
  clinicRoomId: z.string().uuid('유효한 진료실 ID가 필요합니다.').optional(),
  startAt: z.string().datetime('유효한 시작 시간이 필요합니다.'),
  endAt: z.string().datetime('유효한 종료 시간이 필요합니다.'),
  notes: z.string().max(2000).optional(),
});

const updateAppointmentSchema = z.object({
  status: z.nativeEnum(AppointmentStatus).optional(),
  startAt: z.string().datetime('유효한 시작 시간이 필요합니다.').optional(),
  endAt: z.string().datetime('유효한 종료 시간이 필요합니다.').optional(),
  doctorId: z.string().uuid('유효한 의사 ID가 필요합니다.').optional(),
  clinicRoomId: z.string().uuid('유효한 진료실 ID가 필요합니다.').nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  version: z.number().int('버전은 정수여야 합니다.'),
});

// ============================================================
// GET /api/appointments/doctors - 활성 의사 목록
// ============================================================

router.get(
  '/doctors',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const doctors = await prisma.doctor.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, specialty: true, userId: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: doctors });
  }),
);

// ============================================================
// GET /api/appointments/clinic-rooms - 진료실 목록
// ============================================================

router.get(
  '/clinic-rooms',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const rooms = await prisma.clinicRoom.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, doctorId: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: rooms });
  }),
);

// ============================================================
// GET /api/appointments/patients/search - 환자 검색
// ============================================================

router.get(
  '/patients/search',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const q = (req.query.q as string) || '';
    if (q.length < 1) {
      return res.json({ success: true, data: [] });
    }
    const patients = await prisma.patient.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { emrPatientId: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, emrPatientId: true, dob: true, sex: true },
      take: 20,
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: patients });
  }),
);

// ============================================================
// GET /api/appointments/conflicts - 충돌 예약 목록
// ============================================================

router.get(
  '/conflicts',
  requireAuth,
  requirePermission('APPOINTMENTS', 'READ'),
  asyncHandler(async (_req: Request, res: Response) => {
    const conflicts = await prisma.appointment.findMany({
      where: {
        deletedAt: null,
        conflictFlag: true,
        conflictResolvedAt: null,
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: conflicts });
  }),
);

// ============================================================
// GET /api/appointments/today - 오늘 예약 목록 (챗봇용)
// ============================================================

router.get(
  '/today',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        deletedAt: null,
        startAt: { gte: todayStart, lt: todayEnd },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
      },
      orderBy: { startAt: 'asc' },
    });

    const data = appointments.map((a) => ({
      id: a.id,
      patientName: a.patient.name,
      doctorName: a.doctor.name,
      status: a.status,
      startAt: a.startAt,
      endAt: a.endAt,
    }));

    res.json({
      success: true,
      data: {
        appointments: data,
        total: data.length,
      },
    });
  }),
);

// ============================================================
// GET /api/appointments/summary - 예약 요약 (상태별 건수)
// ============================================================

router.get(
  '/summary',
  requireAuth,
  requirePermission('APPOINTMENTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = req.query.date as string | undefined;

    let targetStart: Date;
    let targetEnd: Date;

    if (dateParam) {
      const parsed = new Date(dateParam);
      if (isNaN(parsed.getTime())) {
        throw new AppError(400, 'INVALID_DATE', '유효한 날짜 형식(YYYY-MM-DD)이 필요합니다.');
      }
      targetStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    } else {
      const now = new Date();
      targetStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    targetEnd = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);

    const counts = await prisma.appointment.groupBy({
      by: ['status'],
      where: {
        deletedAt: null,
        startAt: { gte: targetStart, lt: targetEnd },
      },
      _count: { id: true },
    });

    const summary: Record<string, number> = {};
    for (const s of Object.values(AppointmentStatus)) {
      summary[s] = 0;
    }
    for (const row of counts) {
      summary[row.status] = row._count.id;
    }

    const total = Object.values(summary).reduce((acc, v) => acc + v, 0);

    res.json({
      success: true,
      data: { date: targetStart.toISOString().slice(0, 10), summary, total },
    });
  }),
);

// ============================================================
// GET /api/appointments - 예약 목록 조회
// ============================================================

router.get(
  '/',
  requireAuth,
  requirePermission('APPOINTMENTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      date,
      startDate,
      endDate,
      doctorId,
      status,
      search,
      conflictOnly,
      page: pageStr,
      limit: limitStr,
    } = req.query as Record<string, string | undefined>;

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(limitStr ?? '50', 10) || 50));
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = { deletedAt: null };

    // 날짜범위 지원 (주간뷰): startDate ~ endDate
    if (startDate && endDate) {
      const sDate = new Date(startDate);
      const eDate = new Date(endDate);
      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
        throw new AppError(400, 'INVALID_DATE', '유효한 날짜 형식(YYYY-MM-DD)이 필요합니다.');
      }
      const rangeStart = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate());
      const rangeEnd = new Date(eDate.getFullYear(), eDate.getMonth(), eDate.getDate() + 1);
      where.startAt = { gte: rangeStart, lt: rangeEnd };
    } else if (date) {
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) {
        throw new AppError(400, 'INVALID_DATE', '유효한 날짜 형식(YYYY-MM-DD)이 필요합니다.');
      }
      const dayStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      where.startAt = { gte: dayStart, lt: dayEnd };
    }

    if (conflictOnly === 'true') {
      where.conflictFlag = true;
      where.conflictResolvedAt = null;
    }

    if (doctorId) {
      where.doctorId = doctorId;
    }

    if (status) {
      if (!Object.values(AppointmentStatus).includes(status as AppointmentStatus)) {
        throw new AppError(400, 'INVALID_STATUS', '유효하지 않은 예약 상태입니다.');
      }
      where.status = status as AppointmentStatus;
    }

    if (search) {
      where.patient = {
        name: { contains: search, mode: 'insensitive' },
      };
    }

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: {
          patient: { select: { id: true, name: true, emrPatientId: true, dob: true, sex: true } },
          doctor: { select: { id: true, name: true, specialty: true } },
          clinicRoom: { select: { id: true, name: true } },
        },
        orderBy: { startAt: 'asc' },
        skip,
        take: limit,
      }),
      prisma.appointment.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        appointments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  }),
);

// ============================================================
// GET /api/appointments/:id - 예약 상세
// ============================================================

router.get(
  '/:id',
  requireAuth,
  requirePermission('APPOINTMENTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const appointment = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true, dob: true, sex: true, phone: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    if (!appointment) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    res.json({ success: true, data: appointment });
  }),
);

// ============================================================
// POST /api/appointments - 신규 예약
// ============================================================

router.post(
  '/',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('CREATE', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createAppointmentSchema.parse(req.body);

    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);

    if (endAt <= startAt) {
      throw new AppError(400, 'INVALID_TIME_RANGE', '종료 시간은 시작 시간 이후여야 합니다.');
    }

    // 환자 존재 확인
    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, deletedAt: null },
    });
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', '해당 환자를 찾을 수 없습니다.');
    }

    // 의사 존재 확인
    const doctor = await prisma.doctor.findFirst({
      where: { id: body.doctorId, deletedAt: null, isActive: true },
    });
    if (!doctor) {
      throw new AppError(404, 'DOCTOR_NOT_FOUND', '해당 의사를 찾을 수 없습니다.');
    }

    // 시간 충돌 검사 (같은 의사, 겹치는 시간)
    const conflict = await prisma.appointment.findFirst({
      where: {
        doctorId: body.doctorId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });

    if (conflict) {
      throw new AppError(
        409,
        'TIME_CONFLICT',
        '해당 시간에 이미 다른 예약이 있습니다. 다른 시간을 선택해 주세요.',
      );
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId: body.patientId,
        doctorId: body.doctorId,
        clinicRoomId: body.clinicRoomId ?? null,
        startAt,
        endAt,
        notes: body.notes ?? null,
        status: 'BOOKED',
        source: 'INTERNAL',
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    // Audit log data
    res.locals.auditAfter = appointment;

    res.status(201).json({ success: true, data: appointment });
  }),
);

// ============================================================
// PATCH /api/appointments/:id - 예약 수정 (낙관적 잠금)
// ============================================================

router.patch(
  '/:id',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('UPDATE', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateAppointmentSchema.parse(req.body);

    const existing = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    // 낙관적 잠금: 버전 확인
    if (existing.version !== body.version) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        '다른 사용자가 이미 이 예약을 수정했습니다. 새로고침 후 다시 시도해 주세요.',
      );
    }

    // 시간 변경 시 충돌 검사
    const newStartAt = body.startAt ? new Date(body.startAt) : existing.startAt;
    const newEndAt = body.endAt ? new Date(body.endAt) : existing.endAt;
    const newDoctorId = body.doctorId ?? existing.doctorId;

    if (newEndAt <= newStartAt) {
      throw new AppError(400, 'INVALID_TIME_RANGE', '종료 시간은 시작 시간 이후여야 합니다.');
    }

    if (body.startAt || body.endAt || body.doctorId) {
      const conflict = await prisma.appointment.findFirst({
        where: {
          id: { not: id },
          doctorId: newDoctorId,
          deletedAt: null,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: { lt: newEndAt },
          endAt: { gt: newStartAt },
        },
      });

      if (conflict) {
        throw new AppError(
          409,
          'TIME_CONFLICT',
          '해당 시간에 이미 다른 예약이 있습니다. 다른 시간을 선택해 주세요.',
        );
      }
    }

    res.locals.auditBefore = existing;

    const updateData: any = { version: { increment: 1 } };
    if (body.status !== undefined) updateData.status = body.status;
    if (body.startAt !== undefined) updateData.startAt = newStartAt;
    if (body.endAt !== undefined) updateData.endAt = newEndAt;
    if (body.doctorId !== undefined) updateData.doctorId = body.doctorId;
    if (body.clinicRoomId !== undefined) updateData.clinicRoomId = body.clinicRoomId;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const updated = await prisma.appointment.update({
      where: { id },
      data: updateData,
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// PATCH /api/appointments/:id/check-in - 접수 처리
// ============================================================

router.patch(
  '/:id/check-in',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('CHECK_IN', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    if (existing.status !== 'BOOKED') {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        `현재 상태(${existing.status})에서는 접수 처리를 할 수 없습니다. 예약(BOOKED) 상태에서만 가능합니다.`,
      );
    }

    res.locals.auditBefore = existing;

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'CHECKED_IN',
        version: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// PATCH /api/appointments/:id/complete - 진료 완료
// ============================================================

router.patch(
  '/:id/complete',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('COMPLETE', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    if (existing.status !== 'CHECKED_IN') {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        `현재 상태(${existing.status})에서는 진료 완료 처리를 할 수 없습니다. 접수(CHECKED_IN) 상태에서만 가능합니다.`,
      );
    }

    res.locals.auditBefore = existing;

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        version: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// PATCH /api/appointments/:id/cancel - 예약 취소
// ============================================================

router.patch(
  '/:id/cancel',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('CANCEL', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    if (['COMPLETED', 'CANCELLED'].includes(existing.status)) {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        `현재 상태(${existing.status})에서는 취소할 수 없습니다.`,
      );
    }

    res.locals.auditBefore = existing;

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// PATCH /api/appointments/:id/no-show - 미방문 처리
// ============================================================

router.patch(
  '/:id/no-show',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('NO_SHOW', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    if (existing.status !== 'BOOKED') {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        `현재 상태(${existing.status})에서는 미방문 처리를 할 수 없습니다. 예약(BOOKED) 상태에서만 가능합니다.`,
      );
    }

    res.locals.auditBefore = existing;

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'NO_SHOW',
        version: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// PATCH /api/appointments/:id/resolve-conflict - 충돌 해결
// ============================================================

router.patch(
  '/:id/resolve-conflict',
  requireAuth,
  requirePermission('APPOINTMENTS', 'APPROVE'),
  auditLog('RESOLVE_CONFLICT', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { resolution, version } = req.body as { resolution: 'KEEP_EMR' | 'KEEP_INTERNAL' | 'MERGE'; version: number };

    const existing = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    if (!existing.conflictFlag) {
      throw new AppError(400, 'NO_CONFLICT', '이 예약은 충돌 상태가 아닙니다.');
    }

    if (existing.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 이 예약을 수정했습니다.');
    }

    res.locals.auditBefore = existing;

    const user = (req as any).user;

    const updateData: any = {
      conflictFlag: false,
      conflictResolvedBy: user.id,
      conflictResolvedAt: new Date(),
      version: { increment: 1 },
    };

    if (resolution === 'KEEP_EMR') {
      updateData.source = 'EMR';
    } else if (resolution === 'KEEP_INTERNAL') {
      updateData.source = 'INTERNAL';
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: updateData,
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        doctor: { select: { id: true, name: true, specialty: true } },
        clinicRoom: { select: { id: true, name: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// DELETE /api/appointments/:id - 예약 소프트 삭제
// ============================================================

router.delete(
  '/:id',
  requireAuth,
  requirePermission('APPOINTMENTS', 'WRITE'),
  auditLog('DELETE', 'Appointment'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.appointment.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '해당 예약을 찾을 수 없습니다.');
    }

    res.locals.auditBefore = existing;

    await prisma.appointment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true, data: { message: '예약이 삭제되었습니다.' } });
  }),
);

export default router;
