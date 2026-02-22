import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// =====================================================================
// GET /api/rf-evaluation — 평가 목록 (필터: 날짜, 환자, 담당의)
// =====================================================================
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { date, from, to, patient, doctor, page: pageStr, limit: limitStr } = req.query;
    const page = Math.max(1, parseInt(pageStr as string) || 1);
    const limit = Math.min(100, parseInt(limitStr as string) || 30);

    const where: any = { deletedAt: null };

    if (date) {
      const d = new Date((date as string) + 'T00:00:00');
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.evaluatedAt = { gte: d, lt: next };
    } else if (from || to) {
      where.evaluatedAt = {};
      if (from) where.evaluatedAt.gte = new Date((from as string) + 'T00:00:00');
      if (to) {
        const t = new Date((to as string) + 'T00:00:00');
        t.setDate(t.getDate() + 1);
        where.evaluatedAt.lt = t;
      }
    }
    if (patient) {
      where.patient = { name: { contains: patient as string } };
    }
    if (doctor) {
      where.doctorCode = { contains: doctor as string };
    }

    const [total, evaluations] = await Promise.all([
      prisma.rfTreatmentEvaluation.count({ where }),
      prisma.rfTreatmentEvaluation.findMany({
        where,
        include: {
          patient: { select: { id: true, name: true, emrPatientId: true, sex: true, dob: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { evaluatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({ success: true, data: { evaluations, total, page, limit } });
  }),
);

// =====================================================================
// POST /api/rf-evaluation — 평가 기록 생성
// =====================================================================
const createEvalSchema = z.object({
  patientId: z.string().uuid().optional(),
  patientName: z.string().optional(),
  patientType: z.enum(['INPATIENT', 'OUTPATIENT']).optional(),
  diagnosis: z.string().optional(),
  probeType: z.string().optional(),
  outputPercent: z.number().int().min(0).max(100).optional(),
  temperature: z.number().min(0).max(100).optional(),
  treatmentTime: z.number().int().min(0).optional(),
  ivTreatment: z.string().optional(),
  patientIssue: z.string().optional(),
  doctorCode: z.string().optional(),
  roomNumber: z.string().optional(),
  rfSlotId: z.string().uuid().optional(),
  evaluatedAt: z.string().optional(),
});

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = createEvalSchema.parse(req.body);

    // 환자 검색
    let patientId = body.patientId;
    if (!patientId && body.patientName) {
      const patient = await prisma.patient.findFirst({
        where: { name: { contains: body.patientName }, deletedAt: null },
      });
      if (patient) patientId = patient.id;
    }
    if (!patientId) {
      throw new AppError(400, 'INVALID_REQUEST', '환자를 찾을 수 없습니다.');
    }

    const evaluation = await prisma.rfTreatmentEvaluation.create({
      data: {
        patientId,
        patientType: body.patientType || 'INPATIENT',
        diagnosis: body.diagnosis,
        probeType: body.probeType,
        outputPercent: body.outputPercent,
        temperature: body.temperature,
        treatmentTime: body.treatmentTime,
        ivTreatment: body.ivTreatment,
        patientIssue: body.patientIssue,
        doctorCode: body.doctorCode,
        roomNumber: body.roomNumber,
        rfSlotId: body.rfSlotId,
        evaluatedAt: body.evaluatedAt ? new Date(body.evaluatedAt) : new Date(),
        createdById: req.user!.id,
      },
      include: {
        patient: { select: { name: true, emrPatientId: true } },
      },
    });

    res.status(201).json({ success: true, data: evaluation });
  }),
);

// =====================================================================
// PUT /api/rf-evaluation/:id — 평가 수정
// =====================================================================
router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;

    const existing = await prisma.rfTreatmentEvaluation.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '평가 기록을 찾을 수 없습니다.');
    }

    const updated = await prisma.rfTreatmentEvaluation.update({
      where: { id },
      data: {
        probeType: body.probeType,
        outputPercent: body.outputPercent,
        temperature: body.temperature,
        treatmentTime: body.treatmentTime,
        ivTreatment: body.ivTreatment,
        patientIssue: body.patientIssue,
        doctorCode: body.doctorCode,
        roomNumber: body.roomNumber,
        diagnosis: body.diagnosis,
      },
    });

    res.json({ success: true, data: updated });
  }),
);

// =====================================================================
// DELETE /api/rf-evaluation/:id — 평가 삭제 (soft delete)
// =====================================================================
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.rfTreatmentEvaluation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    res.json({ success: true, data: { message: '삭제되었습니다.' } });
  }),
);

// =====================================================================
// GET /api/rf-evaluation/patient/:chartNumber — 환자별 조회
// =====================================================================
router.get(
  '/patient/:chartNumber',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { chartNumber } = req.params;
    const limit = Math.min(50, parseInt(req.query.limit as string) || 10);

    const patient = await prisma.patient.findFirst({
      where: { OR: [{ emrPatientId: chartNumber }, { name: chartNumber }], deletedAt: null },
      select: { id: true, name: true, emrPatientId: true, sex: true, dob: true },
    });

    if (!patient) {
      throw new AppError(404, 'NOT_FOUND', '환자를 찾을 수 없습니다.');
    }

    const evaluations = await prisma.rfTreatmentEvaluation.findMany({
      where: { patientId: patient.id, deletedAt: null },
      orderBy: { evaluatedAt: 'desc' },
      take: limit,
    });

    res.json({ success: true, data: { patient, evaluations } });
  }),
);

// =====================================================================
// GET /api/rf-evaluation/round-prep?date=&doctor= — 회진 준비 데이터
// =====================================================================
router.get(
  '/round-prep',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = req.query.date as string;
    if (!dateParam) throw new AppError(400, 'INVALID_REQUEST', 'date 파라미터가 필요합니다.');
    const doctor = req.query.doctor as string;
    const targetDate = new Date(dateParam + 'T00:00:00');

    // 해당 의사, 해당 날짜 RF 스케줄
    const whereSlot: any = { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null };
    if (doctor) whereSlot.doctor = { doctorCode: { contains: doctor } };

    const rfSlots = await prisma.rfScheduleSlot.findMany({
      where: whereSlot,
      include: {
        patient: {
          select: {
            id: true, name: true, emrPatientId: true, sex: true, dob: true,
            clinicalInfo: { select: { diagnosis: true } },
          },
        },
        room: { select: { name: true } },
        doctor: { select: { doctorCode: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    // 각 환자별 최근 3회 치료 평가 — IN 쿼리로 N+1 제거
    const patientIds = [...new Set(rfSlots.map((s) => s.patientId).filter(Boolean))] as string[];
    const recentEvals: Record<string, any[]> = {};

    if (patientIds.length > 0) {
      const allEvals = await prisma.rfTreatmentEvaluation.findMany({
        where: { patientId: { in: patientIds }, deletedAt: null },
        orderBy: { evaluatedAt: 'desc' },
        select: {
          id: true, patientId: true, evaluatedAt: true, probeType: true,
          outputPercent: true, temperature: true, treatmentTime: true,
          patientIssue: true, roomNumber: true,
        },
      });
      // 환자별로 최대 3건씩 수집 (이미 desc 정렬됨)
      for (const e of allEvals) {
        if (!recentEvals[e.patientId]) recentEvals[e.patientId] = [];
        if (recentEvals[e.patientId].length < 3) {
          recentEvals[e.patientId].push(e);
        }
      }
    }

    // 추천 회진 시간 계산 (환자 치료 시작-종료 범위)
    let earliestTime = '23:59';
    let latestTime = '00:00';
    for (const s of rfSlots) {
      if (s.startTime < earliestTime) earliestTime = s.startTime;
      const endMinutes = parseInt(s.startTime.split(':')[0]) * 60
        + parseInt(s.startTime.split(':')[1]) + s.durationMinutes;
      const endH = String(Math.floor(endMinutes / 60)).padStart(2, '0');
      const endM = String(endMinutes % 60).padStart(2, '0');
      const endTime = `${endH}:${endM}`;
      if (endTime > latestTime) latestTime = endTime;
    }

    const patients = rfSlots.map((s) => {
      const dob = s.patient?.dob ? new Date(s.patient.dob) : null;
      const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
      return {
        slotId: s.id,
        roomNumber: s.room.name,
        chartNumber: s.patient?.emrPatientId,
        name: s.patient?.name,
        age,
        sex: s.patient?.sex,
        diagnosis: s.patient?.clinicalInfo?.diagnosis,
        startTime: s.startTime,
        duration: s.durationMinutes,
        doctorCode: s.doctor?.doctorCode || '',
        recentEvals: s.patientId ? (recentEvals[s.patientId] || []) : [],
      };
    });

    res.json({
      success: true,
      data: {
        date: dateParam,
        doctor: doctor || '전체',
        suggestedRoundTime: rfSlots.length > 0 ? `${earliestTime}~${latestTime}` : null,
        patients,
      },
    });
  }),
);

// =====================================================================
// GET /api/rf-evaluation/round-print?date=&doctor= — 회진 프린트
// =====================================================================
router.get(
  '/round-print',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = req.query.date as string;
    if (!dateParam) throw new AppError(400, 'INVALID_REQUEST', 'date 파라미터가 필요합니다.');
    const doctor = req.query.doctor as string;
    const targetDate = new Date(dateParam + 'T00:00:00');

    const whereSlot: any = { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null };
    if (doctor) whereSlot.doctor = { doctorCode: { contains: doctor } };

    const rfSlots = await prisma.rfScheduleSlot.findMany({
      where: whereSlot,
      include: {
        patient: {
          select: {
            id: true, name: true, emrPatientId: true, sex: true, dob: true,
            clinicalInfo: { select: { diagnosis: true } },
          },
        },
        room: { select: { name: true } },
        doctor: { select: { doctorCode: true, name: true } },
      },
      orderBy: [{ startTime: 'asc' }, { room: { displayOrder: 'asc' } }],
    });

    // 요일
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = dayNames[targetDate.getDay()];

    // 추천 회진 시간
    let earliest = '23:59';
    let latest = '00:00';
    for (const s of rfSlots) {
      if (s.startTime < earliest) earliest = s.startTime;
      const endMin = parseInt(s.startTime.split(':')[0]) * 60 + parseInt(s.startTime.split(':')[1]) + s.durationMinutes;
      const endStr = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      if (endStr > latest) latest = endStr;
    }

    const patients = rfSlots.map((s) => {
      const dob = s.patient?.dob ? new Date(s.patient.dob) : null;
      const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
      return {
        roomNumber: s.room.name,
        chartNumber: s.patient?.emrPatientId || '',
        name: s.patient?.name || '',
        ageSex: age !== null ? `${age}/${s.patient?.sex || ''}` : '',
        diagnosis: s.patient?.clinicalInfo?.diagnosis || '',
        startTime: s.startTime,
        endTime: (() => {
          const m = parseInt(s.startTime.split(':')[0]) * 60 + parseInt(s.startTime.split(':')[1]) + s.durationMinutes;
          return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        })(),
        notes: s.notes || '',
      };
    });

    res.json({
      success: true,
      data: {
        title: `${dateParam}(${dayOfWeek})`,
        doctor: doctor || '전체',
        suggestedRoundTime: rfSlots.length > 0 ? `${earliest}~${latest}` : null,
        patientCount: patients.length,
        patients,
      },
    });
  }),
);

export default router;
