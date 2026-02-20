import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// ─── 로컬 날짜 문자열 (KST 안전) ───
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── 타임슬롯 정의 (09:00~17:30, 30분 간격) ───
const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30',
];

// ─── 주간 날짜 배열 (월~토 6일) ───
function getWeekDates(dateStr: string): string[] {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=일, 1=월 ...
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));

  const dates: string[] = [];
  for (let i = 0; i < 6; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    dates.push(toDateStr(dd));
  }
  return dates;
}

// ─── GET /api/manual-therapy/weekly ── 주간 그리드 조회 ───
router.get(
  '/weekly',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const weekDates = getWeekDates(dateParam);
    const startDate = weekDates[0];
    const endDate = weekDates[weekDates.length - 1];

    // 치료사 목록
    const therapists = await prisma.therapist.findMany({
      where: { deletedAt: null, isActive: true, specialty: '도수' },
      orderBy: { name: 'asc' },
    });

    // 해당 주 슬롯
    const slots = await prisma.manualTherapySlot.findMany({
      where: {
        deletedAt: null,
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      include: { patient: { select: { id: true, name: true, emrPatientId: true, status: true } } },
      orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
    });

    // 비고 메모
    const remarks = await prisma.staffDayNote.findMany({
      where: {
        noteType: 'MANUAL_THERAPY_REMARK',
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      orderBy: { date: 'asc' },
    });

    // 그리드 구성
    const grid: Record<string, Record<string, Record<string, any>>> = {};
    for (const t of therapists) {
      grid[t.id] = {};
      for (const dateStr of weekDates) {
        grid[t.id][dateStr] = {};
      }
    }

    for (const slot of slots) {
      const dateStr = toDateStr(slot.date);
      if (grid[slot.therapistId]?.[dateStr]) {
        grid[slot.therapistId][dateStr][slot.timeSlot] = {
          id: slot.id,
          patientId: slot.patientId,
          patientName: slot.patient?.name || slot.patientName || '',
          emrPatientId: slot.patient?.emrPatientId || '',
          treatmentCodes: slot.treatmentCodes,
          sessionMarker: slot.sessionMarker,
          patientType: slot.patientType,
          status: slot.status,
          notes: slot.notes,
          duration: slot.duration,
          version: slot.version,
        };
      }
    }

    // 통계
    const stats = {
      totalBooked: slots.filter(s => s.status === 'BOOKED').length,
      totalCompleted: slots.filter(s => s.status === 'COMPLETED').length,
      noShows: slots.filter(s => s.status === 'NO_SHOW').length,
      cancelled: slots.filter(s => s.status === 'CANCELLED').length,
    };

    res.json({
      success: true,
      data: {
        week: { start: startDate, end: endDate },
        therapists: therapists.map(t => ({ id: t.id, name: t.name, workSchedule: t.workSchedule })),
        timeSlots: TIME_SLOTS,
        grid,
        remarks: remarks.map(r => ({
          id: r.id,
          date: toDateStr(r.date),
          content: r.content,
        })),
        stats,
      },
    });
  }),
);

// ─── GET /api/manual-therapy/monthly ── 월간 전체 조회 (주간 그리드 포함) ───
router.get(
  '/monthly',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);

    const startDate = new Date(`${year}-${String(month).padStart(2, '0')}-01`);
    const endDate = new Date(year, month, 0); // 해당 월 마지막 날

    const therapists = await prisma.therapist.findMany({
      where: { deletedAt: null, isActive: true, specialty: '도수' },
      orderBy: { name: 'asc' },
    });

    // 전체 슬롯 데이터 (환자 이름 포함)
    const slots = await prisma.manualTherapySlot.findMany({
      where: {
        deletedAt: null,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true, status: true } },
      },
      orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
    });

    // 비고 메모
    const remarks = await prisma.staffDayNote.findMany({
      where: {
        noteType: 'MANUAL_THERAPY_REMARK',
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });

    // 그리드 구성: therapistId → date → timeSlot → slotData
    const grid: Record<string, Record<string, Record<string, any>>> = {};
    for (const t of therapists) {
      grid[t.id] = {};
    }

    for (const slot of slots) {
      const dateStr = toDateStr(slot.date);
      if (!grid[slot.therapistId]) continue;
      if (!grid[slot.therapistId][dateStr]) {
        grid[slot.therapistId][dateStr] = {};
      }
      grid[slot.therapistId][dateStr][slot.timeSlot] = {
        id: slot.id,
        patientId: slot.patientId,
        patientName: slot.patient?.name || slot.patientName || '',
        emrPatientId: slot.patient?.emrPatientId || '',
        treatmentCodes: slot.treatmentCodes,
        sessionMarker: slot.sessionMarker,
        patientType: slot.patientType,
        status: slot.status,
        notes: slot.notes,
        duration: slot.duration,
        version: slot.version,
      };
    }

    // 주차 그룹 (월~토)
    const weeks: { start: string; end: string; dates: string[] }[] = [];
    const firstOfMonth = new Date(year, month - 1, 1);
    const lastOfMonth = new Date(year, month, 0);
    const cursor = new Date(firstOfMonth);
    const dow = cursor.getDay();
    cursor.setDate(cursor.getDate() - (dow === 0 ? 6 : dow - 1)); // 월요일로 이동

    while (cursor <= lastOfMonth) {
      const weekDates: string[] = [];
      for (let i = 0; i < 6; i++) {
        const d = new Date(cursor);
        d.setDate(cursor.getDate() + i);
        weekDates.push(toDateStr(d));
      }
      weeks.push({
        start: weekDates[0],
        end: weekDates[weekDates.length - 1],
        dates: weekDates,
      });
      cursor.setDate(cursor.getDate() + 7);
    }

    // 통계
    const stats = {
      totalBooked: slots.filter(s => s.status === 'BOOKED').length,
      totalCompleted: slots.filter(s => s.status === 'COMPLETED').length,
      noShows: slots.filter(s => s.status === 'NO_SHOW').length,
      cancelled: slots.filter(s => s.status === 'CANCELLED').length,
    };

    res.json({
      success: true,
      data: {
        year,
        month,
        therapists: therapists.map(t => ({ id: t.id, name: t.name, workSchedule: t.workSchedule })),
        timeSlots: TIME_SLOTS,
        weeks,
        grid,
        remarks: remarks.map(r => ({
          id: r.id,
          date: toDateStr(r.date),
          content: r.content,
        })),
        stats,
      },
    });
  }),
);

// ─── GET /api/manual-therapy/slots ── 슬롯 목록 (필터) ───
router.get(
  '/slots',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { therapistId, patientId, date, status, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));

    const where: any = { deletedAt: null };
    if (therapistId) where.therapistId = therapistId;
    if (patientId) where.patientId = patientId;
    if (date) where.date = new Date(date as string);
    if (status) where.status = status;

    const [total, items] = await Promise.all([
      prisma.manualTherapySlot.count({ where }),
      prisma.manualTherapySlot.findMany({
        where,
        include: {
          therapist: { select: { id: true, name: true } },
          patient: { select: { id: true, name: true, emrPatientId: true } },
        },
        orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    res.json({ success: true, data: items, meta: { total, page: pageNum, limit: limitNum } });
  }),
);

// ─── POST /api/manual-therapy/slots ── 슬롯 생성 ───
const createSlotSchema = z.object({
  therapistId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  patientName: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeSlot: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.number().int().min(10).max(120).optional(),
  treatmentCodes: z.array(z.string()).optional(),
  sessionMarker: z.string().optional(),
  patientType: z.enum(['INPATIENT', 'OUTPATIENT']).optional(),
  notes: z.string().optional(),
  source: z.enum(['INTERNAL', 'CHATBOT', 'MIGRATION']).optional(),
});

router.post(
  '/slots',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createSlotSchema.parse(req.body);

    // 치료사 존재 확인
    const therapist = await prisma.therapist.findFirst({
      where: { id: body.therapistId, deletedAt: null, isActive: true },
    });
    if (!therapist) throw new AppError(404, 'NOT_FOUND', '치료사를 찾을 수 없습니다.');

    // 시간 유효성
    if (!TIME_SLOTS.includes(body.timeSlot)) {
      throw new AppError(400, 'INVALID_REQUEST', `유효하지 않은 시간입니다. (${TIME_SLOTS[0]}~${TIME_SLOTS[TIME_SLOTS.length - 1]})`);
    }

    // 중복 검사
    const existing = await prisma.manualTherapySlot.findFirst({
      where: {
        therapistId: body.therapistId,
        date: new Date(body.date),
        timeSlot: body.timeSlot,
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
    });
    if (existing) throw new AppError(409, 'DUPLICATE', '해당 시간에 이미 예약이 있습니다.');

    // 같은 환자 동시간 다른 치료사 검사
    if (body.patientId) {
      const patientConflict = await prisma.manualTherapySlot.findFirst({
        where: {
          patientId: body.patientId,
          date: new Date(body.date),
          timeSlot: body.timeSlot,
          deletedAt: null,
          status: { not: 'CANCELLED' },
        },
      });
      if (patientConflict) {
        throw new AppError(409, 'TIME_CONFLICT', '해당 환자가 같은 시간에 이미 다른 예약이 있습니다.');
      }
    }

    const slot = await prisma.manualTherapySlot.create({
      data: {
        therapistId: body.therapistId,
        patientId: body.patientId || null,
        patientName: body.patientName || null,
        date: new Date(body.date),
        timeSlot: body.timeSlot,
        duration: body.duration || 30,
        treatmentCodes: body.treatmentCodes || [],
        sessionMarker: body.sessionMarker || null,
        patientType: body.patientType || 'INPATIENT',
        notes: body.notes || null,
        source: body.source || 'INTERNAL',
      },
      include: {
        therapist: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    res.status(201).json({ success: true, data: slot });
  }),
);

// ─── PATCH /api/manual-therapy/slots/:id ── 슬롯 수정 ───
const updateSlotSchema = z.object({
  patientId: z.string().uuid().nullable().optional(),
  patientName: z.string().nullable().optional(),
  treatmentCodes: z.array(z.string()).optional(),
  sessionMarker: z.string().nullable().optional(),
  patientType: z.enum(['INPATIENT', 'OUTPATIENT']).optional(),
  status: z.enum(['BOOKED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']).optional(),
  notes: z.string().nullable().optional(),
  version: z.number().int(),
});

router.patch(
  '/slots/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateSlotSchema.parse(req.body);
    const { version, ...data } = body;

    const existing = await prisma.manualTherapySlot.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');
    if (existing.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 수정했습니다. 새로고침 후 다시 시도하세요.');
    }

    const updated = await prisma.manualTherapySlot.update({
      where: { id: req.params.id },
      data: { ...data, version: { increment: 1 } },
      include: {
        therapist: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    res.json({ success: true, data: updated });
  }),
);

// ─── DELETE /api/manual-therapy/slots/:id ── 슬롯 취소 ───
router.delete(
  '/slots/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.manualTherapySlot.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');

    await prisma.manualTherapySlot.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', deletedAt: new Date() },
    });

    res.json({ success: true, data: { message: '예약이 취소되었습니다.' } });
  }),
);

// ─── GET /api/manual-therapy/patient-search ── 환자 검색 ───
router.get(
  '/patient-search',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { q } = req.query;
    if (!q || (q as string).length < 1) {
      return res.json({ success: true, data: [] });
    }

    const patients = await prisma.patient.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        name: { contains: q as string, mode: 'insensitive' },
      },
      select: {
        id: true,
        name: true,
        emrPatientId: true,
        dob: true,
        sex: true,
        admissions: {
          where: { deletedAt: null, status: 'ADMITTED' },
          select: { id: true, status: true },
          take: 1,
        },
      },
      take: 20,
      orderBy: { name: 'asc' },
    });

    const result = patients.map(p => ({
      id: p.id,
      name: p.name,
      emrPatientId: p.emrPatientId,
      dob: p.dob,
      sex: p.sex,
      isAdmitted: p.admissions.length > 0,
    }));

    res.json({ success: true, data: result });
  }),
);

export default router;
