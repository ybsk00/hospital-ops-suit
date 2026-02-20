import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// ─── 로컬 날짜 문자열 (KST 안전) ───
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

// ─── 월간 날짜 범위 ───
function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // 마지막 날
  return { start: toDateStr(start), end: toDateStr(end), daysInMonth: end.getDate() };
}

// =====================================================================
// GET /api/room-booking/daily?date= — 일간: 병실별 시간대 치료 스케줄
// =====================================================================
router.get(
  '/daily',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const targetDate = new Date(dateParam + 'T00:00:00');
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // 5개 독립 쿼리 병렬 실행
    const [rooms, manualSlots, rfSlots, procedures, appointments] = await Promise.all([
      // 병실/베드 + 현재 입원 환자
      prisma.room.findMany({
        where: { isActive: true, deletedAt: null },
        include: {
          ward: true,
          beds: {
            where: { isActive: true, deletedAt: null },
            include: {
              currentAdmission: {
                include: {
                  patient: { select: { id: true, name: true, dob: true, sex: true, emrPatientId: true } },
                  attendingDoctor: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      // 도수치료 스케줄
      prisma.manualTherapySlot.findMany({
        where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
        include: {
          patient: { select: { id: true, name: true } },
          therapist: { select: { name: true } },
        },
      }),
      // 고주파 스케줄
      prisma.rfScheduleSlot.findMany({
        where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
        include: {
          patient: { select: { id: true, name: true } },
          room: { select: { name: true } },
        },
      }),
      // 처치 스케줄
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
              admission: {
                include: { patient: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      // 외래예약
      prisma.appointment.findMany({
        where: {
          startAt: { gte: targetDate, lt: nextDate },
          status: { in: ['BOOKED', 'CHECKED_IN'] },
          deletedAt: null,
        },
        include: {
          patient: { select: { id: true, name: true } },
          doctor: { select: { name: true } },
        },
      }),
    ]);

    // 환자ID → 치료 스케줄 매핑
    const patientSchedules: Record<string, any[]> = {};
    const addSchedule = (patientId: string, item: any) => {
      if (!patientSchedules[patientId]) patientSchedules[patientId] = [];
      patientSchedules[patientId].push(item);
    };

    for (const s of manualSlots) {
      if (s.patientId) {
        addSchedule(s.patientId, {
          type: 'MANUAL',
          time: s.timeSlot,
          duration: s.duration,
          detail: `도수치료 (${s.therapist.name})`,
          codes: s.treatmentCodes,
        });
      }
    }
    for (const s of rfSlots) {
      if (s.patientId) {
        addSchedule(s.patientId, {
          type: 'RF',
          time: s.startTime,
          duration: s.duration,
          detail: `고주파 ${s.room.name}번`,
          doctor: s.doctorCode,
        });
      }
    }
    for (const p of procedures) {
      const patientId = p.plan?.admission?.patient?.id;
      if (patientId) {
        const time = new Date(p.scheduledAt);
        addSchedule(patientId, {
          type: 'PROCEDURE',
          time: `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`,
          detail: p.plan.procedureCatalog.name,
          code: p.plan.procedureCatalog.code,
        });
      }
    }
    for (const a of appointments) {
      if (a.patientId) {
        const time = new Date(a.startAt);
        addSchedule(a.patientId, {
          type: 'APPOINTMENT',
          time: `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`,
          detail: `외래 (${a.doctor.name})`,
        });
      }
    }

    // 병실별 데이터 구성
    const roomData = rooms.map((room) => {
      const beds = room.beds.map((bed) => {
        const admission = bed.currentAdmission;
        const patient = admission?.patient;
        const schedules = patient ? (patientSchedules[patient.id] || []) : [];

        let availability: { status: string; availableDate?: string } = { status: 'EMPTY' };
        if (bed.status === 'OCCUPIED' && admission) {
          availability = {
            status: 'OCCUPIED',
            availableDate: admission.plannedDischargeDate
              ? toDateStr(new Date(admission.plannedDischargeDate))
              : undefined,
          };
        } else if (bed.status === 'RESERVED') {
          availability = { status: 'RESERVED' };
        } else if (bed.status === 'CLEANING') {
          availability = { status: 'CLEANING' };
        } else if (bed.status === 'ISOLATION') {
          availability = { status: 'ISOLATION' };
        } else if (bed.status === 'OUT_OF_ORDER') {
          availability = { status: 'OUT_OF_ORDER' };
        }

        return {
          bedId: bed.id,
          label: bed.label,
          status: bed.status,
          availability,
          patient: patient ? {
            id: patient.id,
            name: patient.name,
            chartNumber: patient.emrPatientId,
            sex: patient.sex,
            dob: patient.dob,
            doctor: admission?.attendingDoctor?.name,
            admitDate: admission?.admitDate,
            plannedDischarge: admission?.plannedDischargeDate,
          } : null,
          schedules: schedules.sort((a: any, b: any) => (a.time || '').localeCompare(b.time || '')),
        };
      });

      return {
        roomId: room.id,
        roomName: room.name,
        ward: room.ward.name,
        capacity: room.capacity,
        beds,
      };
    });

    res.json({ success: true, data: { date: dateParam, rooms: roomData } });
  }),
);

// =====================================================================
// GET /api/room-booking/weekly?date= — 주간: 날짜별 환자 + 치료 건수
// =====================================================================
router.get(
  '/weekly',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const weekDates = getWeekDates(dateParam);
    const startDate = new Date(weekDates[0] + 'T00:00:00');
    const endDate = new Date(weekDates[weekDates.length - 1] + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);

    // 입원 환자 (해당 주에 재원 중)
    const admissions = await prisma.admission.findMany({
      where: {
        status: { in: ['ADMITTED', 'DISCHARGE_PLANNED', 'ON_LEAVE'] },
        admitDate: { lte: endDate },
        OR: [{ dischargeDate: null }, { dischargeDate: { gte: startDate } }],
        deletedAt: null,
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        currentBed: { include: { room: true } },
      },
    });

    // 주간 치료 건수 집계
    const [manualCounts, rfCounts, procCounts] = await Promise.all([
      prisma.manualTherapySlot.groupBy({
        by: ['patientId', 'date'],
        where: { date: { gte: startDate, lt: endDate }, status: { not: 'CANCELLED' }, deletedAt: null, patientId: { not: null } },
        _count: true,
      }),
      prisma.rfScheduleSlot.groupBy({
        by: ['patientId', 'date'],
        where: { date: { gte: startDate, lt: endDate }, status: { not: 'CANCELLED' }, deletedAt: null, patientId: { not: null } },
        _count: true,
      }),
      prisma.procedureExecution.findMany({
        where: {
          scheduledAt: { gte: startDate, lt: endDate },
          status: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] },
          deletedAt: null,
        },
        include: {
          plan: {
            include: {
              procedureCatalog: { select: { code: true } },
              admission: { select: { patientId: true } },
            },
          },
        },
      }),
    ]);

    // patientId+date → 치료 유형별 건수
    type DaySummary = { manual: number; rf: number; procedure: number; types: string[] };
    const patientDayMap: Record<string, Record<string, DaySummary>> = {};

    const ensureEntry = (pid: string, d: string) => {
      if (!patientDayMap[pid]) patientDayMap[pid] = {};
      if (!patientDayMap[pid][d]) patientDayMap[pid][d] = { manual: 0, rf: 0, procedure: 0, types: [] };
    };

    for (const m of manualCounts) {
      if (!m.patientId) continue;
      const d = toDateStr(new Date(m.date));
      ensureEntry(m.patientId, d);
      patientDayMap[m.patientId][d].manual += m._count;
      if (!patientDayMap[m.patientId][d].types.includes('도수')) patientDayMap[m.patientId][d].types.push('도수');
    }
    for (const r of rfCounts) {
      if (!r.patientId) continue;
      const d = toDateStr(new Date(r.date));
      ensureEntry(r.patientId, d);
      patientDayMap[r.patientId][d].rf += r._count;
      if (!patientDayMap[r.patientId][d].types.includes('고주파')) patientDayMap[r.patientId][d].types.push('고주파');
    }
    for (const p of procCounts) {
      const pid = p.plan?.admission?.patientId;
      if (!pid) continue;
      const d = toDateStr(new Date(p.scheduledAt));
      ensureEntry(pid, d);
      patientDayMap[pid][d].procedure += 1;
      const code = p.plan.procedureCatalog.code;
      if (code && !patientDayMap[pid][d].types.includes(code)) patientDayMap[pid][d].types.push(code);
    }

    // 병실별 주간 그리드
    const roomWeekly = admissions.map((adm) => ({
      patientId: adm.patient.id,
      patientName: adm.patient.name,
      chartNumber: adm.patient.emrPatientId,
      roomName: adm.currentBed?.room?.name || '-',
      bedLabel: adm.currentBed?.label || '-',
      days: weekDates.reduce((acc, d) => {
        acc[d] = patientDayMap[adm.patient.id]?.[d] || { manual: 0, rf: 0, procedure: 0, types: [] };
        return acc;
      }, {} as Record<string, DaySummary>),
    }));

    res.json({ success: true, data: { weekDates, rooms: roomWeekly } });
  }),
);

// =====================================================================
// GET /api/room-booking/monthly?year=&month= — 월간: 일자별 카운트
// =====================================================================
router.get(
  '/monthly',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const now = new Date();
    const year = parseInt(req.query.year as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) || (now.getMonth() + 1);
    const { start, end, daysInMonth } = getMonthRange(year, month);
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);

    // 모든 입원 에피소드 (해당 월 겹치는)
    const admissions = await prisma.admission.findMany({
      where: {
        admitDate: { lte: endDate },
        OR: [{ dischargeDate: null }, { dischargeDate: { gte: startDate } }],
        deletedAt: null,
      },
      select: { admitDate: true, dischargeDate: true, status: true },
    });

    // 일자별 카운트
    const dailyCounts: { date: string; admitted: number; discharged: number; inHospital: number }[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month - 1, day);
      const dStr = toDateStr(d);
      let inHospital = 0;
      let admitted = 0;
      let discharged = 0;

      for (const adm of admissions) {
        const admitDate = toDateStr(new Date(adm.admitDate));
        const dischargeDate = adm.dischargeDate ? toDateStr(new Date(adm.dischargeDate)) : null;

        // 해당 날짜에 입원 중인지
        if (admitDate <= dStr && (!dischargeDate || dischargeDate >= dStr)) {
          inHospital++;
        }
        // 해당 날짜에 입원한 경우
        if (admitDate === dStr) {
          admitted++;
        }
        // 해당 날짜에 퇴원한 경우
        if (dischargeDate === dStr) {
          discharged++;
        }
      }

      dailyCounts.push({ date: dStr, admitted, discharged, inHospital });
    }

    res.json({ success: true, data: { year, month, days: dailyCounts } });
  }),
);

// =====================================================================
// GET /api/room-booking/availability — 병실 가용성
// =====================================================================
router.get(
  '/availability',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const rooms = await prisma.room.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        ward: true,
        beds: {
          where: { isActive: true, deletedAt: null },
          include: {
            currentAdmission: {
              select: {
                plannedDischargeDate: true,
                status: true,
                patient: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const roomAvailability = rooms.map((room) => {
      const beds = room.beds.map((bed) => {
        let available = false;
        let availableDate: string | null = null;
        let occupant: string | null = null;

        if (bed.status === 'EMPTY') {
          available = true;
        } else if (bed.status === 'OCCUPIED' && bed.currentAdmission) {
          occupant = bed.currentAdmission.patient?.name || null;
          if (bed.currentAdmission.plannedDischargeDate) {
            availableDate = toDateStr(new Date(bed.currentAdmission.plannedDischargeDate));
          }
          if (bed.currentAdmission.status === 'DISCHARGE_PLANNED' && bed.currentAdmission.plannedDischargeDate) {
            availableDate = toDateStr(new Date(bed.currentAdmission.plannedDischargeDate));
          }
        }

        return {
          bedId: bed.id,
          label: bed.label,
          status: bed.status,
          available,
          availableDate,
          occupant,
        };
      });

      const emptyCount = beds.filter((b) => b.available).length;
      const totalCount = beds.length;

      return {
        roomId: room.id,
        roomName: room.name,
        ward: room.ward.name,
        capacity: room.capacity,
        emptyCount,
        totalCount,
        beds,
      };
    });

    res.json({ success: true, data: { rooms: roomAvailability } });
  }),
);

// =====================================================================
// GET /api/room-booking/table — 엑셀표: 전체 병실/베드 flat 테이블
// =====================================================================
router.get(
  '/table',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    // 1) 전체 병실/베드 + 현재 입원정보 조회
    const rooms = await prisma.room.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        beds: {
          where: { isActive: true, deletedAt: null },
          orderBy: { label: 'asc' },
          include: {
            currentAdmission: {
              include: {
                patient: { select: { id: true, name: true } },
                attendingDoctor: { select: { name: true } },
                procedurePlans: {
                  where: { deletedAt: null },
                  include: {
                    procedureCatalog: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // 2) 입원 환자 ID 수집
    const patientIds: string[] = [];
    for (const room of rooms) {
      for (const bed of room.beds) {
        const adm = (bed as any).currentAdmission;
        if (adm?.patient?.id) patientIds.push(adm.patient.id);
      }
    }

    // 3) 치료 존재 여부 배치 쿼리
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [manualPatients, rfPatients] = patientIds.length > 0
      ? await Promise.all([
          prisma.manualTherapySlot.findMany({
            where: { patientId: { in: patientIds }, date: { gte: today }, status: { not: 'CANCELLED' }, deletedAt: null },
            distinct: ['patientId'],
            select: { patientId: true },
          }),
          prisma.rfScheduleSlot.findMany({
            where: { patientId: { in: patientIds }, date: { gte: today }, status: { not: 'CANCELLED' }, deletedAt: null },
            distinct: ['patientId'],
            select: { patientId: true },
          }),
        ])
      : [[], []];

    const hasManual = new Set(manualPatients.map((m) => m.patientId));
    const hasRf = new Set(rfPatients.map((r) => r.patientId));

    // 4) flat 테이블 구성
    const rows: any[] = [];
    const now = new Date();

    for (const room of rooms) {
      for (const bed of room.beds) {
        const adm = (bed as any).currentAdmission;
        const patient = adm?.patient;
        const pId = patient?.id;

        // 치료 내용 집계
        const treatments: string[] = [];
        if (adm?.procedurePlans) {
          const planNames = adm.procedurePlans
            .map((pp: any) => pp.procedureCatalog?.name)
            .filter(Boolean);
          for (const n of planNames) {
            if (!treatments.includes(n)) treatments.push(n);
          }
        }
        if (pId && hasManual.has(pId) && !treatments.includes('도수치료')) {
          treatments.push('도수치료');
        }
        if (pId && hasRf.has(pId) && !treatments.includes('온열치료')) {
          treatments.push('온열치료');
        }

        rows.push({
          roomName: room.name,
          bedLabel: bed.label,
          bedId: bed.id,
          bedStatus: bed.status,
          patientName: patient?.name || null,
          patientId: pId || null,
          admitDate: adm?.admitDate ? toDateStr(new Date(adm.admitDate)) : null,
          plannedDischargeDate: adm?.plannedDischargeDate ? toDateStr(new Date(adm.plannedDischargeDate)) : null,
          isFutureDischarge: adm?.plannedDischargeDate ? new Date(adm.plannedDischargeDate) > now : false,
          doctorName: adm?.attendingDoctor?.name || null,
          treatments,
          admissionStatus: adm?.status || null,
        });
      }
    }

    res.json({ success: true, data: { rows } });
  }),
);

export default router;
