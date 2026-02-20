import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// =====================================================================
// GET /api/handover/summary?date= — 요약 (재원/입원/퇴원/재입예정)
// =====================================================================
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const targetDate = new Date(dateParam + 'T00:00:00');
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // 4개 카운트 병렬 쿼리
    const [currentCount, admitCount, dischargeCount, readmitCount] = await Promise.all([
      // 재원 중 (해당 날짜 기준)
      prisma.admission.count({
        where: {
          status: { in: ['ADMITTED', 'DISCHARGE_PLANNED', 'ON_LEAVE'] },
          admitDate: { lte: nextDate },
          OR: [{ dischargeDate: null }, { dischargeDate: { gte: targetDate } }],
          deletedAt: null,
        },
      }),
      // 오늘 입원
      prisma.admission.count({
        where: {
          admitDate: { gte: targetDate, lt: nextDate },
          deletedAt: null,
        },
      }),
      // 오늘 퇴원
      prisma.admission.count({
        where: {
          dischargeDate: { gte: targetDate, lt: nextDate },
          deletedAt: null,
        },
      }),
      // 재입원 예정
      prisma.admission.count({
        where: {
          admitDate: { gt: targetDate },
          status: 'ADMITTED',
          patient: {
            admissions: { some: { dischargeDate: { not: null }, deletedAt: null } },
          },
          deletedAt: null,
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        date: dateParam,
        currentCount,
        admitCount,
        dischargeCount,
        readmitCount,
        total: currentCount,
      },
    });
  }),
);

// =====================================================================
// GET /api/handover/daily?date= — 병실별 인계장
// =====================================================================
router.get(
  '/daily',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const targetDate = new Date(dateParam + 'T00:00:00');
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // 현재 입원 환자 + 병실 + 환자 정보 + 임상 프로필
    const admissions = await prisma.admission.findMany({
      where: {
        status: { in: ['ADMITTED', 'DISCHARGE_PLANNED', 'ON_LEAVE'] },
        admitDate: { lte: nextDate },
        OR: [{ dischargeDate: null }, { dischargeDate: { gte: targetDate } }],
        deletedAt: null,
      },
      include: {
        patient: {
          select: {
            id: true, name: true, dob: true, sex: true, emrPatientId: true,
            clinicalInfo: true,
          },
        },
        attendingDoctor: { select: { name: true } },
        currentBed: { include: { room: true } },
      },
      orderBy: { currentBed: { room: { name: 'asc' } } },
    });

    // 해당 날짜 인계 기록
    const handoverEntries = await prisma.handoverEntry.findMany({
      where: { date: targetDate, deletedAt: null },
      include: { createdBy: { select: { name: true } } },
    });
    const entryMap = new Map(handoverEntries.map((e) => [e.patientId, e]));

    // 당일 치료 스케줄 (도수 + 고주파 + 처치)
    const [manualSlots, rfSlots, procedures] = await Promise.all([
      prisma.manualTherapySlot.findMany({
        where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
        include: { therapist: { select: { name: true } } },
      }),
      prisma.rfScheduleSlot.findMany({
        where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
        include: { room: { select: { name: true } } },
      }),
      prisma.procedureExecution.findMany({
        where: {
          scheduledAt: { gte: targetDate, lt: nextDate },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          deletedAt: null,
        },
        include: {
          plan: {
            include: {
              procedureCatalog: { select: { name: true, code: true } },
              admission: { select: { patientId: true } },
            },
          },
        },
      }),
    ]);

    // 환자별 스케줄 매핑
    const scheduleMap: Record<string, any[]> = {};
    for (const s of manualSlots) {
      if (!s.patientId) continue;
      if (!scheduleMap[s.patientId]) scheduleMap[s.patientId] = [];
      scheduleMap[s.patientId].push({ type: '도수', time: s.timeSlot, detail: s.therapist.name });
    }
    for (const s of rfSlots) {
      if (!s.patientId) continue;
      if (!scheduleMap[s.patientId]) scheduleMap[s.patientId] = [];
      scheduleMap[s.patientId].push({ type: '고주파', time: s.startTime, detail: `${s.room.name}번` });
    }
    for (const p of procedures) {
      const pid = p.plan?.admission?.patientId;
      if (!pid) continue;
      if (!scheduleMap[pid]) scheduleMap[pid] = [];
      const t = new Date(p.scheduledAt);
      scheduleMap[pid].push({
        type: p.plan.procedureCatalog.code || p.plan.procedureCatalog.name,
        time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
        detail: p.plan.procedureCatalog.name,
      });
    }

    // 병실별 그룹핑
    const roomGroups: Record<string, any[]> = {};
    for (const adm of admissions) {
      const roomName = adm.currentBed?.room?.name || '미배정';
      if (!roomGroups[roomName]) roomGroups[roomName] = [];
      const entry = entryMap.get(adm.patient.id);
      const dob = adm.patient.dob ? new Date(adm.patient.dob) : null;
      const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;

      roomGroups[roomName].push({
        admissionId: adm.id,
        patient: {
          id: adm.patient.id,
          name: adm.patient.name,
          chartNumber: adm.patient.emrPatientId,
          sex: adm.patient.sex,
          age,
        },
        roomName,
        bedLabel: adm.currentBed?.label || '-',
        doctor: adm.attendingDoctor?.name,
        admitDate: adm.admitDate,
        plannedDischargeDate: adm.plannedDischargeDate,
        clinical: adm.patient.clinicalInfo || null,
        todaySchedule: (scheduleMap[adm.patient.id] || []).sort((a: any, b: any) => (a.time || '').localeCompare(b.time || '')),
        handover: entry ? {
          id: entry.id,
          bloodDraw: entry.bloodDraw,
          bloodDrawNote: entry.bloodDrawNote,
          chemoNote: entry.chemoNote,
          externalVisit: entry.externalVisit,
          outing: entry.outing,
          returnTime: entry.returnTime,
          treatmentDate: entry.treatmentDate,
          content: entry.content,
          createdBy: entry.createdBy?.name,
        } : null,
      });
    }

    res.json({ success: true, data: { date: dateParam, rooms: roomGroups } });
  }),
);

// =====================================================================
// GET /api/handover/by-doctor?date=&doctor= — 의사별 인계장
// =====================================================================
router.get(
  '/by-doctor',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const doctorName = req.query.doctor as string;
    const targetDate = new Date(dateParam + 'T00:00:00');
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const where: any = {
      status: { in: ['ADMITTED', 'DISCHARGE_PLANNED', 'ON_LEAVE'] },
      admitDate: { lte: nextDate },
      OR: [{ dischargeDate: null }, { dischargeDate: { gte: targetDate } }],
      deletedAt: null,
    };
    if (doctorName) {
      where.attendingDoctor = { name: { contains: doctorName } };
    }

    const admissions = await prisma.admission.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true, name: true, dob: true, sex: true, emrPatientId: true,
            clinicalInfo: true,
          },
        },
        attendingDoctor: { select: { name: true } },
        currentBed: { include: { room: true } },
      },
    });

    const handoverEntries = await prisma.handoverEntry.findMany({
      where: { date: targetDate, deletedAt: null },
    });
    const entryMap = new Map(handoverEntries.map((e) => [e.patientId, e]));

    // 의사별 그룹핑
    const doctorGroups: Record<string, any[]> = {};
    for (const adm of admissions) {
      const drName = adm.attendingDoctor?.name || '미지정';
      if (!doctorGroups[drName]) doctorGroups[drName] = [];
      const entry = entryMap.get(adm.patient.id);
      const dob = adm.patient.dob ? new Date(adm.patient.dob) : null;
      const age = dob ? Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;

      doctorGroups[drName].push({
        admissionId: adm.id,
        patient: {
          id: adm.patient.id,
          name: adm.patient.name,
          chartNumber: adm.patient.emrPatientId,
          sex: adm.patient.sex,
          age,
        },
        roomName: adm.currentBed?.room?.name || '미배정',
        bedLabel: adm.currentBed?.label || '-',
        clinical: adm.patient.clinicalInfo || null,
        handover: entry ? {
          id: entry.id,
          bloodDraw: entry.bloodDraw,
          content: entry.content,
          chemoNote: entry.chemoNote,
          externalVisit: entry.externalVisit,
          outing: entry.outing,
          returnTime: entry.returnTime,
        } : null,
      });
    }

    // 의사 목록도 반환
    const doctors = await prisma.user.findMany({
      where: {
        departments: { some: { role: { in: ['DOCTOR'] } } },
        isActive: true, deletedAt: null,
      },
      select: { id: true, name: true },
    });

    res.json({ success: true, data: { date: dateParam, doctors, groups: doctorGroups } });
  }),
);

// =====================================================================
// GET /api/handover/discharged — 퇴원자 목록 (가나다순)
// =====================================================================
router.get(
  '/discharged',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const search = req.query.search as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    const where: any = {
      status: 'DISCHARGED',
      deletedAt: null,
    };
    if (search) {
      where.patient = { name: { contains: search } };
    }

    const [total, admissions] = await Promise.all([
      prisma.admission.count({ where }),
      prisma.admission.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true, name: true, dob: true, sex: true, emrPatientId: true,
              clinicalInfo: { select: { diagnosis: true, referralHospital: true } },
            },
          },
          attendingDoctor: { select: { name: true } },
        },
        orderBy: { patient: { name: 'asc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const patients = admissions.map((adm) => ({
      admissionId: adm.id,
      patientId: adm.patient.id,
      name: adm.patient.name,
      chartNumber: adm.patient.emrPatientId,
      sex: adm.patient.sex,
      dob: adm.patient.dob,
      doctor: adm.attendingDoctor?.name,
      admitDate: adm.admitDate,
      dischargeDate: adm.dischargeDate,
      diagnosis: adm.patient.clinicalInfo?.diagnosis,
      hospital: adm.patient.clinicalInfo?.referralHospital,
    }));

    res.json({ success: true, data: { patients, total, page, limit } });
  }),
);

// =====================================================================
// POST /api/handover/entry — 인계 기록 생성/수정 (upsert)
// =====================================================================
const handoverEntrySchema = z.object({
  patientId: z.string().uuid(),
  date: z.string(),
  roomNumber: z.string().optional(),
  doctorCode: z.string().optional(),
  bloodDraw: z.boolean().optional(),
  bloodDrawNote: z.string().optional(),
  chemoNote: z.string().optional(),
  externalVisit: z.string().optional(),
  outing: z.string().optional(),
  returnTime: z.string().optional(),
  treatmentDate: z.string().optional(),
  content: z.string().optional(),
});

router.post(
  '/entry',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = handoverEntrySchema.parse(req.body);
    const targetDate = new Date(body.date + 'T00:00:00');

    const entry = await prisma.handoverEntry.upsert({
      where: {
        patientId_date: { patientId: body.patientId, date: targetDate },
      },
      create: {
        patientId: body.patientId,
        date: targetDate,
        roomNumber: body.roomNumber,
        doctorCode: body.doctorCode,
        bloodDraw: body.bloodDraw ?? false,
        bloodDrawNote: body.bloodDrawNote,
        chemoNote: body.chemoNote,
        externalVisit: body.externalVisit,
        outing: body.outing,
        returnTime: body.returnTime,
        treatmentDate: body.treatmentDate,
        content: body.content,
        createdById: req.user!.id,
      },
      update: {
        roomNumber: body.roomNumber,
        doctorCode: body.doctorCode,
        bloodDraw: body.bloodDraw,
        bloodDrawNote: body.bloodDrawNote,
        chemoNote: body.chemoNote,
        externalVisit: body.externalVisit,
        outing: body.outing,
        returnTime: body.returnTime,
        treatmentDate: body.treatmentDate,
        content: body.content,
      },
    });

    res.json({ success: true, data: entry });
  }),
);

// =====================================================================
// PUT /api/handover/entry/:id — 인계 기록 수정
// =====================================================================
router.put(
  '/entry/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;

    const entry = await prisma.handoverEntry.update({
      where: { id },
      data: {
        bloodDraw: body.bloodDraw,
        bloodDrawNote: body.bloodDrawNote,
        chemoNote: body.chemoNote,
        externalVisit: body.externalVisit,
        outing: body.outing,
        returnTime: body.returnTime,
        treatmentDate: body.treatmentDate,
        content: body.content,
      },
    });

    res.json({ success: true, data: entry });
  }),
);

// =====================================================================
// POST /api/handover/clinical-info — 환자 임상 프로필 upsert
// =====================================================================
const clinicalInfoSchema = z.object({
  patientId: z.string().uuid(),
  diagnosis: z.string().optional(),
  referralHospital: z.string().optional(),
  chemoPort: z.string().optional(),
  surgeryHistory: z.string().optional(),
  metastasis: z.string().optional(),
  ctxHistory: z.string().optional(),
  rtHistory: z.string().optional(),
  bloodDrawSchedule: z.string().optional(),
  guardianInfo: z.string().optional(),
  notes: z.string().optional(),
});

router.post(
  '/clinical-info',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = clinicalInfoSchema.parse(req.body);

    const info = await prisma.patientClinicalInfo.upsert({
      where: { patientId: body.patientId },
      create: body,
      update: {
        diagnosis: body.diagnosis,
        referralHospital: body.referralHospital,
        chemoPort: body.chemoPort,
        surgeryHistory: body.surgeryHistory,
        metastasis: body.metastasis,
        ctxHistory: body.ctxHistory,
        rtHistory: body.rtHistory,
        bloodDrawSchedule: body.bloodDrawSchedule,
        guardianInfo: body.guardianInfo,
        notes: body.notes,
      },
    });

    res.json({ success: true, data: info });
  }),
);

// =====================================================================
// PUT /api/handover/clinical-info/:patientId — 임상 프로필 수정
// =====================================================================
router.put(
  '/clinical-info/:patientId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { patientId } = req.params;
    const body = req.body;

    const info = await prisma.patientClinicalInfo.upsert({
      where: { patientId },
      create: { patientId, ...body },
      update: body,
    });

    res.json({ success: true, data: info });
  }),
);

export default router;
