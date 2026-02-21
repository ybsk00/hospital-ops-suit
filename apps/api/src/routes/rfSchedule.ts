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

// ─── 공통 Prisma include (임상정보 + 입원베드 포함) ───
const RF_PATIENT_INCLUDE = {
  select: {
    id: true, name: true, emrPatientId: true, status: true,
    clinicalInfo: {
      select: {
        diagnosis: true, surgeryHistory: true, metastasis: true,
        ctxHistory: true, chemoPort: true, rtHistory: true, notes: true,
      },
    },
    admissions: {
      where: { deletedAt: null, status: 'ADMITTED' as const },
      select: {
        id: true,
        currentBed: { select: { label: true, room: { select: { name: true } } } },
      },
      take: 1,
    },
  },
} as const;

function serializeBedInfo(admissions: any[]): string | null {
  const adm = admissions?.[0];
  if (!adm?.currentBed) return null;
  return `${adm.currentBed.room?.name || ''}호 ${adm.currentBed.label}`;
}

// ─── 타임슬롯 정의 (09:00~18:30, 30분 간격) ───
const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30',
];

// ─── 시간 → 분 변환 ───
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ─── GET /api/rf-schedule/daily ── 일간 그리드 조회 ───
router.get(
  '/daily',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const targetDate = new Date(dateParam);

    // 기계(Room) 목록
    const rooms = await prisma.rfTreatmentRoom.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    // 해당 날짜 슬롯
    const slots = await prisma.rfScheduleSlot.findMany({
      where: {
        deletedAt: null,
        date: targetDate,
      },
      include: {
        patient: RF_PATIENT_INCLUDE,
        doctor: { select: { doctorCode: true, name: true } },
      },
      orderBy: [{ startTime: 'asc' }],
    });

    // 직원 메모
    const staffNotes = await prisma.staffDayNote.findMany({
      where: {
        noteType: 'RF_STAFF_NOTE',
        date: targetDate,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 그리드 구성 (기계별 → 시간별)
    const grid: Record<string, Record<string, any>> = {};
    for (const room of rooms) {
      grid[room.id] = {};
    }

    for (const slot of slots) {
      if (!grid[slot.roomId]) continue;

      const startMin = timeToMinutes(slot.startTime);
      const endMin = startMin + slot.duration;

      // 시작 시간 슬롯에 정보 넣기
      grid[slot.roomId][slot.startTime] = {
        id: slot.id,
        patientId: slot.patientId,
        patientName: slot.patient.name,
        emrPatientId: slot.patient.emrPatientId || '',
        doctorCode: slot.doctor.doctorCode || '',
        duration: slot.duration,
        patientType: slot.patientType,
        status: slot.status,
        notes: slot.notes,
        version: slot.version,
        startMin,
        endMin,
        clinicalInfo: (slot.patient as any).clinicalInfo || null,
        bedInfo: serializeBedInfo((slot.patient as any).admissions || []),
      };

      // duration에 따라 중간 슬롯을 OCCUPIED로 표시
      for (let m = startMin + 30; m < endMin; m += 30) {
        const ts = minutesToTime(m);
        if (TIME_SLOTS.includes(ts)) {
          grid[slot.roomId][ts] = 'OCCUPIED';
        }
      }

      // 30분 버퍼 표시
      const bufferEnd = endMin + 30;
      for (let m = endMin; m < bufferEnd; m += 30) {
        const ts = minutesToTime(m);
        if (TIME_SLOTS.includes(ts) && !grid[slot.roomId][ts]) {
          grid[slot.roomId][ts] = 'BUFFER';
        }
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
        date: dateParam,
        rooms: rooms.map(r => ({ id: r.id, name: r.name, displayOrder: r.displayOrder })),
        timeSlots: TIME_SLOTS,
        grid,
        staffNotes: staffNotes.map(n => ({
          id: n.id,
          content: n.content,
          targetId: n.targetId,
        })),
        stats,
      },
    });
  }),
);

// ─── 주간 날짜 배열 (월~토 6일) ───
function getWeekDates(dateStr: string): string[] {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
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

// ─── GET /api/rf-schedule/weekly ── 주간 집계 조회 ───
router.get(
  '/weekly',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const weekDates = getWeekDates(dateParam);
    const startDate = weekDates[0];
    const endDate = weekDates[weekDates.length - 1];

    const rooms = await prisma.rfTreatmentRoom.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    const slots = await prisma.rfScheduleSlot.findMany({
      where: {
        deletedAt: null,
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      include: {
        patient: RF_PATIENT_INCLUDE,
        doctor: { select: { doctorCode: true, name: true } },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    const staffNotes = await prisma.staffDayNote.findMany({
      where: {
        noteType: 'RF_STAFF_NOTE',
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      orderBy: { date: 'asc' },
    });

    // 날짜별 집계
    const days: Record<string, any> = {};
    for (const slot of slots) {
      const dateStr = toDateStr(slot.date);
      if (!days[dateStr]) {
        days[dateStr] = {
          total: 0,
          byStatus: { BOOKED: 0, COMPLETED: 0, NO_SHOW: 0, CANCELLED: 0 },
          byRoom: {} as Record<string, { count: number; slots: any[] }>,
        };
      }
      const day = days[dateStr];
      day.total++;
      if (day.byStatus[slot.status] !== undefined) day.byStatus[slot.status]++;
      if (!day.byRoom[slot.roomId]) {
        day.byRoom[slot.roomId] = { count: 0, slots: [] };
      }
      day.byRoom[slot.roomId].count++;
      day.byRoom[slot.roomId].slots.push({
        startTime: slot.startTime,
        duration: slot.duration,
        patientName: slot.patient.name,
        doctorCode: slot.doctor.doctorCode || '',
        patientType: slot.patientType,
        status: slot.status,
      });
    }

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
        rooms: rooms.map(r => ({ id: r.id, name: r.name, displayOrder: r.displayOrder })),
        days,
        staffNotes: staffNotes.map(n => ({
          id: n.id,
          date: toDateStr(n.date),
          content: n.content,
          targetId: n.targetId,
        })),
        stats,
      },
    });
  }),
);

// ─── GET /api/rf-schedule/monthly ── 월간 전체 조회 (주간 그리드 포함) ───
router.get(
  '/monthly',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);

    const startDate = new Date(`${year}-${String(month).padStart(2, '0')}-01`);
    const endDate = new Date(year, month, 0);

    const rooms = await prisma.rfTreatmentRoom.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });

    // 전체 슬롯 데이터 (환자 이름 포함)
    const slots = await prisma.rfScheduleSlot.findMany({
      where: {
        deletedAt: null,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        patient: RF_PATIENT_INCLUDE,
        doctor: { select: { doctorCode: true, name: true } },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });

    // 직원 메모
    const staffNotes = await prisma.staffDayNote.findMany({
      where: {
        noteType: 'RF_STAFF_NOTE',
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });

    // 그리드 구성: roomId → date → timeSlot → slotData/OCCUPIED/BUFFER
    const grid: Record<string, Record<string, Record<string, any>>> = {};
    for (const room of rooms) {
      grid[room.id] = {};
    }

    for (const slot of slots) {
      const dateStr = toDateStr(slot.date);
      if (!grid[slot.roomId]) continue;
      if (!grid[slot.roomId][dateStr]) {
        grid[slot.roomId][dateStr] = {};
      }

      const startMin = timeToMinutes(slot.startTime);
      const endMin = startMin + slot.duration;

      grid[slot.roomId][dateStr][slot.startTime] = {
        id: slot.id,
        patientId: slot.patientId,
        patientName: slot.patient.name,
        emrPatientId: slot.patient.emrPatientId || '',
        doctorCode: slot.doctor.doctorCode || '',
        duration: slot.duration,
        patientType: slot.patientType,
        status: slot.status,
        notes: slot.notes,
        clinicalInfo: (slot.patient as any).clinicalInfo || null,
        bedInfo: serializeBedInfo((slot.patient as any).admissions || []),
      };

      // OCCUPIED 표시
      for (let m = startMin + 30; m < endMin; m += 30) {
        const ts = minutesToTime(m);
        if (TIME_SLOTS.includes(ts)) {
          if (!grid[slot.roomId][dateStr]) grid[slot.roomId][dateStr] = {};
          grid[slot.roomId][dateStr][ts] = 'OCCUPIED';
        }
      }

      // BUFFER 표시
      const bufferEnd = endMin + 30;
      for (let m = endMin; m < bufferEnd; m += 30) {
        const ts = minutesToTime(m);
        if (TIME_SLOTS.includes(ts) && !grid[slot.roomId][dateStr]?.[ts]) {
          if (!grid[slot.roomId][dateStr]) grid[slot.roomId][dateStr] = {};
          grid[slot.roomId][dateStr][ts] = 'BUFFER';
        }
      }
    }

    // 주차 그룹 (월~토)
    const weeks: { start: string; end: string; dates: string[] }[] = [];
    const lastOfMonth = new Date(year, month, 0);
    const cursor = new Date(year, month - 1, 1);
    const dow = cursor.getDay();
    cursor.setDate(cursor.getDate() - (dow === 0 ? 6 : dow - 1));

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
        rooms: rooms.map(r => ({ id: r.id, name: r.name, displayOrder: r.displayOrder })),
        timeSlots: TIME_SLOTS,
        weeks,
        grid,
        staffNotes: staffNotes.map(n => ({
          id: n.id,
          date: toDateStr(n.date),
          content: n.content,
        })),
        stats,
      },
    });
  }),
);

// ─── GET /api/rf-schedule/slots ── 슬롯 필터 조회 ───
router.get(
  '/slots',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { roomId, patientId, date, status, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));

    const where: any = { deletedAt: null };
    if (roomId) where.roomId = roomId;
    if (patientId) where.patientId = patientId;
    if (date) where.date = new Date(date as string);
    if (status) where.status = status;

    const [total, items] = await Promise.all([
      prisma.rfScheduleSlot.count({ where }),
      prisma.rfScheduleSlot.findMany({
        where,
        include: {
          room: { select: { id: true, name: true } },
          patient: { select: { id: true, name: true, emrPatientId: true } },
        },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    res.json({ success: true, data: items, meta: { total, page: pageNum, limit: limitNum } });
  }),
);

// ─── POST /api/rf-schedule/slots ── 슬롯 생성 (30분 버퍼 충돌 검사) ───
const createSlotSchema = z.object({
  roomId: z.string().uuid(),
  patientId: z.string().uuid(),
  doctorId: z.string().optional(),
  doctorCode: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.number().int().min(30).max(240),
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

    // doctorCode → doctorId 자동 해석 (하위호환)
    let resolvedDoctorId = body.doctorId;
    if (!resolvedDoctorId && body.doctorCode) {
      const doc = await prisma.doctor.findFirst({ where: { doctorCode: body.doctorCode } });
      if (!doc) throw new AppError(400, 'INVALID_REQUEST', `의사 코드 '${body.doctorCode}'를 찾을 수 없습니다.`);
      resolvedDoctorId = doc.id;
    }
    if (!resolvedDoctorId) throw new AppError(400, 'INVALID_REQUEST', 'doctorId 또는 doctorCode가 필요합니다.');

    // 기계 존재 확인
    const room = await prisma.rfTreatmentRoom.findFirst({
      where: { id: body.roomId, isActive: true },
    });
    if (!room) throw new AppError(404, 'NOT_FOUND', '치료실/기계를 찾을 수 없습니다.');

    // 시간 유효성
    if (!TIME_SLOTS.includes(body.startTime)) {
      throw new AppError(400, 'INVALID_REQUEST', `유효하지 않은 시작 시간입니다. (${TIME_SLOTS[0]}~${TIME_SLOTS[TIME_SLOTS.length - 1]})`);
    }

    const newStartMin = timeToMinutes(body.startTime);
    const newEndMin = newStartMin + body.duration;
    const newBufferEnd = newEndMin + 30;

    // 같은 기계+날짜의 기존 예약과 충돌 검사 (30분 버퍼 포함)
    const existingSlots = await prisma.rfScheduleSlot.findMany({
      where: {
        roomId: body.roomId,
        date: new Date(body.date),
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
    });

    for (const existing of existingSlots) {
      const exStartMin = timeToMinutes(existing.startTime);
      const exEndMin = exStartMin + existing.duration;
      const exBufferEnd = exEndMin + 30;

      // 충돌: 새 예약(+버퍼)와 기존 예약(+버퍼)이 겹치는지 확인
      const overlap = newStartMin < exBufferEnd && exStartMin < newBufferEnd;
      if (overlap) {
        throw new AppError(409, 'TIME_CONFLICT',
          `기계 ${room.name}번: ${existing.startTime}~${minutesToTime(exEndMin)} 예약(+30분 버퍼)과 충돌합니다.`);
      }
    }

    // 같은 환자 동시간 다른 기계 검사
    {
      const patientConflict = await prisma.rfScheduleSlot.findFirst({
        where: {
          patientId: body.patientId,
          date: new Date(body.date),
          deletedAt: null,
          status: { not: 'CANCELLED' },
        },
      });
      if (patientConflict) {
        const endTime = minutesToTime(timeToMinutes(patientConflict.startTime) + patientConflict.duration);
        throw new AppError(409, 'TIME_CONFLICT',
          `해당 환자가 같은 날 ${patientConflict.startTime}~${endTime}에 이미 고주파 예약이 있습니다.`);
      }
    }

    const slot = await prisma.rfScheduleSlot.create({
      data: {
        roomId: body.roomId,
        patientId: body.patientId,
        doctorId: resolvedDoctorId,
        date: new Date(body.date),
        startTime: body.startTime,
        duration: body.duration,
        patientType: body.patientType || 'INPATIENT',
        notes: body.notes || null,
        source: body.source || 'INTERNAL',
      },
      include: {
        room: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    res.status(201).json({ success: true, data: slot });
  }),
);

// ─── PATCH /api/rf-schedule/slots/:id ── 슬롯 수정 ───
const updateSlotSchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().optional(),
  doctorCode: z.string().optional(),
  duration: z.number().int().min(30).max(240).optional(),
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
    const { version, patientId, doctorCode: bodyDoctorCode, ...rest } = body;

    // doctorCode → doctorId 자동 해석 (하위호환)
    if (!rest.doctorId && bodyDoctorCode) {
      const doc = await prisma.doctor.findFirst({ where: { doctorCode: bodyDoctorCode } });
      if (doc) rest.doctorId = doc.id;
    }

    const existing = await prisma.rfScheduleSlot.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');
    if (existing.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 수정했습니다. 새로고침 후 다시 시도하세요.');
    }

    const updateData: any = { ...rest, version: { increment: 1 } };
    if (patientId !== undefined) {
      updateData.patientId = patientId;
    }

    const updated = await prisma.rfScheduleSlot.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        room: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    res.json({ success: true, data: updated });
  }),
);

// ─── DELETE /api/rf-schedule/slots/:id ── 슬롯 취소 ───
router.delete(
  '/slots/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.rfScheduleSlot.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');

    await prisma.rfScheduleSlot.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', deletedAt: new Date() },
    });

    res.json({ success: true, data: { message: '예약이 취소되었습니다.' } });
  }),
);

// ─── GET /api/rf-schedule/rooms ── 기계 목록 ───
router.get(
  '/rooms',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const rooms = await prisma.rfTreatmentRoom.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
    res.json({ success: true, data: rooms });
  }),
);

// ─── GET /api/rf-schedule/patient-search ── 환자 검색 ───
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
