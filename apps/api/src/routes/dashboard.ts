import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { subDays, subWeeks, subMonths, format } from 'date-fns';

const router = Router();

// ─── GET /api/dashboard/stats ── 대시보드 통계 ───
router.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const [
      emptyBedCount,
      admittedCount,
      todayProcedureCount,
      todayAppointmentCount,
      unreadInboxCount,
    ] = await Promise.all([
      // 빈 베드
      prisma.bed.count({
        where: { deletedAt: null, isActive: true, status: 'EMPTY' },
      }),
      // 입원 환자
      prisma.admission.count({
        where: { deletedAt: null, status: { not: 'DISCHARGED' } },
      }),
      // 오늘 처치
      prisma.procedureExecution.count({
        where: {
          deletedAt: null,
          scheduledAt: { gte: todayStart, lt: todayEnd },
        },
      }),
      // 오늘 예약
      prisma.appointment.count({
        where: {
          deletedAt: null,
          startAt: { gte: todayStart, lt: todayEnd },
        },
      }),
      // 미처리 알림
      prisma.inboxItem.count({
        where: { ownerId: userId, status: 'UNREAD' },
      }),
    ]);

    res.json({
      success: true,
      data: {
        emptyBeds: emptyBedCount,
        admissions: admittedCount,
        todayProcedures: todayProcedureCount,
        todayAppointments: todayAppointmentCount,
        unreadInbox: unreadInboxCount,
      },
    });
  }),
);

// ─── GET /api/dashboard/recent-alerts ── 최근 알림 ───
router.get(
  '/recent-alerts',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const items = await prisma.inboxItem.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    res.json({ success: true, data: items });
  }),
);

// ─── GET /api/dashboard/today-schedule ── 오늘 일정 ───
router.get(
  '/today-schedule',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        deletedAt: null,
        startAt: { gte: todayStart, lt: todayEnd },
        status: { in: ['BOOKED', 'CHECKED_IN'] },
      },
      include: {
        patient: { select: { name: true } },
        doctor: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 8,
    });

    res.json({
      success: true,
      data: appointments.map((a) => ({
        id: a.id,
        time: new Date(a.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        patient: a.patient.name,
        doctor: a.doctor.name,
        status: a.status,
      })),
    });
  }),
);

// ─── GET /api/dashboard/trends ── 현황 추이 (일별/주별/월별) ───
router.get(
  '/trends',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const period = (req.query.period as string) || 'daily';
    const truncUnit = period === 'monthly' ? 'month' : period === 'weekly' ? 'week' : 'day';

    // 기간 설정
    const toDate = new Date();
    let fromDate: Date;
    if (period === 'monthly') {
      fromDate = subMonths(toDate, 12);
    } else if (period === 'weekly') {
      fromDate = subWeeks(toDate, 12);
    } else {
      fromDate = subDays(toDate, 30);
    }

    if (req.query.from) fromDate = new Date(req.query.from as string);
    if (req.query.to) toDate.setTime(new Date(req.query.to as string).getTime());

    // 6개 도메인 병렬 쿼리 (bedOccupancy 포함)
    const [admissions, procedures, appointments, homecare, totalBeds, bedOccupancy] = await Promise.all([
      // 신규 입원
      prisma.$queryRawUnsafe<{ bucket: Date; count: bigint }[]>(
        `SELECT date_trunc($1, "admitDate") as bucket, COUNT(*)::bigint as count
         FROM "Admission" WHERE "deletedAt" IS NULL AND "admitDate" >= $2 AND "admitDate" < $3
         GROUP BY bucket ORDER BY bucket`,
        truncUnit, fromDate, toDate,
      ),
      // 처치 완료
      prisma.$queryRawUnsafe<{ bucket: Date; count: bigint }[]>(
        `SELECT date_trunc($1, "executedAt") as bucket, COUNT(*)::bigint as count
         FROM "ProcedureExecution" WHERE "deletedAt" IS NULL AND status = 'COMPLETED'
         AND "executedAt" IS NOT NULL AND "executedAt" >= $2 AND "executedAt" < $3
         GROUP BY bucket ORDER BY bucket`,
        truncUnit, fromDate, toDate,
      ),
      // 외래 예약
      prisma.$queryRawUnsafe<{ bucket: Date; count: bigint }[]>(
        `SELECT date_trunc($1, "startAt") as bucket, COUNT(*)::bigint as count
         FROM "Appointment" WHERE "deletedAt" IS NULL AND "startAt" >= $2 AND "startAt" < $3
         GROUP BY bucket ORDER BY bucket`,
        truncUnit, fromDate, toDate,
      ),
      // 가정방문 완료
      prisma.$queryRawUnsafe<{ bucket: Date; count: bigint }[]>(
        `SELECT date_trunc($1, "completedAt") as bucket, COUNT(*)::bigint as count
         FROM "HomecareVisit" WHERE "deletedAt" IS NULL AND status = 'COMPLETED'
         AND "completedAt" IS NOT NULL AND "completedAt" >= $2 AND "completedAt" < $3
         GROUP BY bucket ORDER BY bucket`,
        truncUnit, fromDate, toDate,
      ),
      // 전체 베드 수
      prisma.bed.count({ where: { deletedAt: null, isActive: true } }),
      // 병상 가동 (해당 날짜에 활성 입원 수)
      prisma.$queryRawUnsafe<{ bucket: Date; count: bigint }[]>(
        `SELECT gs.bucket, COUNT(a.id)::bigint as count FROM
         (SELECT generate_series(
           date_trunc($1, $2::timestamp),
           date_trunc($1, $3::timestamp),
           ('1 ' || $1)::interval
         ) as bucket) gs
         LEFT JOIN "Admission" a ON a."deletedAt" IS NULL
           AND a."admitDate" <= gs.bucket + ('1 ' || $1)::interval
           AND (a."dischargeDate" IS NULL OR a."dischargeDate" > gs.bucket)
         GROUP BY gs.bucket ORDER BY gs.bucket`,
        truncUnit, fromDate, toDate,
      ),
    ]);

    // 결과 병합
    const bucketMap = new Map<string, any>();

    const formatKey = (d: Date) => format(new Date(d), 'yyyy-MM-dd');

    for (const row of bedOccupancy) {
      const key = formatKey(row.bucket);
      bucketMap.set(key, {
        date: key,
        bedOccupancy: Number(row.count),
        totalBeds,
        newAdmissions: 0,
        proceduresCompleted: 0,
        appointments: 0,
        homecareVisits: 0,
      });
    }

    const mergeInto = (rows: { bucket: Date; count: bigint }[], field: string) => {
      for (const row of rows) {
        const key = formatKey(row.bucket);
        if (!bucketMap.has(key)) {
          bucketMap.set(key, {
            date: key, bedOccupancy: 0, totalBeds, newAdmissions: 0,
            proceduresCompleted: 0, appointments: 0, homecareVisits: 0,
          });
        }
        bucketMap.get(key)![field] = Number(row.count);
      }
    };

    mergeInto(admissions, 'newAdmissions');
    mergeInto(procedures, 'proceduresCompleted');
    mergeInto(appointments, 'appointments');
    mergeInto(homecare, 'homecareVisits');

    const series = Array.from(bucketMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      data: { period, from: format(fromDate, 'yyyy-MM-dd'), to: format(toDate, 'yyyy-MM-dd'), series },
    });
  }),
);

// ─── 날짜 문자열 헬퍼 ───
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Doctor.doctorCode 필드에서 직접 조회 (DB 기반)

// =====================================================================
// GET /api/dashboard/doctor-schedule?date= — 의사별 일정 통합 뷰
// =====================================================================
router.get(
  '/doctor-schedule',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const dateParam = (req.query.date as string) || toDateStr(new Date());
    const targetDate = new Date(dateParam + 'T00:00:00');
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // 의사 목록 조회
    const doctors = await prisma.doctor.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    // 5개 독립 쿼리 병렬 실행
    const [admissions, appointments, rfSlots, manualSlots, procedures] = await Promise.all([
      // 담당 입원환자
      prisma.admission.findMany({
        where: {
          status: { in: ['ADMITTED', 'DISCHARGE_PLANNED', 'ON_LEAVE'] },
          deletedAt: null,
        },
        include: {
          patient: { select: { id: true, name: true, emrPatientId: true } },
          currentBed: { include: { room: { select: { name: true } } } },
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
          doctor: { select: { id: true, name: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
      // 고주파 스케줄
      prisma.rfScheduleSlot.findMany({
        where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
        include: {
          patient: { select: { id: true, name: true } },
          room: { select: { name: true } },
          doctor: { select: { doctorCode: true } },
        },
      }),
      // 도수치료 스케줄
      prisma.manualTherapySlot.findMany({
        where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
        include: {
          patient: { select: { id: true, name: true } },
          therapist: { select: { name: true } },
        },
      }),
      // 처치
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
    ]);

    // 의사별 담당환자 ID 세트
    const doctorPatients: Record<string, Set<string>> = {};
    for (const doc of doctors) {
      doctorPatients[doc.id] = new Set();
    }
    for (const adm of admissions) {
      for (const doc of doctors) {
        if (adm.attendingDoctorId === doc.userId) {
          doctorPatients[doc.id].add(adm.patient.id);
        }
      }
    }

    // 의사별 스케줄 빌드
    const result = doctors.map((doc) => {
      const doctorCode = doc.doctorCode || '';
      const patientIds = doctorPatients[doc.id];
      const schedules: any[] = [];

      // 외래예약
      for (const appt of appointments) {
        if (appt.doctor.id === doc.id) {
          const t = new Date(appt.startAt);
          schedules.push({
            time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
            endTime: (() => { const e = new Date(appt.endAt); return `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`; })(),
            type: 'APPOINTMENT',
            patientName: appt.patient.name,
            detail: appt.notes || '외래진료',
            status: appt.status,
          });
        }
      }

      // 고주파 (doctorCode 매칭)
      if (doctorCode) {
        for (const rf of rfSlots) {
          if (rf.doctor?.doctorCode === doctorCode) {
            schedules.push({
              time: rf.startTime,
              endTime: (() => {
                const [h, m] = rf.startTime.split(':').map(Number);
                const total = h * 60 + m + rf.durationMinutes;
                return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
              })(),
              type: 'RF',
              patientName: rf.patient?.name || '-',
              detail: `고주파 ${rf.room.name} (${rf.durationMinutes}분)`,
              status: rf.status,
            });
          }
        }
      }

      // 도수치료 (담당환자의 도수)
      for (const mt of manualSlots) {
        if (mt.patientId && patientIds.has(mt.patientId)) {
          const [h, m] = mt.timeSlot.split(':').map(Number);
          const total = h * 60 + m + mt.duration;
          schedules.push({
            time: mt.timeSlot,
            endTime: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
            type: 'MANUAL',
            patientName: mt.patient?.name || '-',
            detail: `도수치료 (${mt.therapist.name})`,
            status: mt.status,
          });
        }
      }

      // 처치 (담당환자의 처치)
      for (const proc of procedures) {
        const pid = proc.plan?.admission?.patient?.id;
        if (pid && patientIds.has(pid)) {
          const t = new Date(proc.scheduledAt);
          schedules.push({
            time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
            endTime: '',
            type: 'PROCEDURE',
            patientName: proc.plan.admission.patient.name,
            detail: proc.plan.procedureCatalog.name,
            status: proc.status,
          });
        }
      }

      // 시간순 정렬
      schedules.sort((a, b) => a.time.localeCompare(b.time));

      // 담당 입원환자 목록
      const inpatients = admissions
        .filter((adm) => adm.attendingDoctorId === doc.userId)
        .map((adm) => ({
          patientId: adm.patient.id,
          patientName: adm.patient.name,
          chartNumber: adm.patient.emrPatientId,
          roomName: adm.currentBed?.room?.name || '-',
          bedLabel: adm.currentBed?.label || '-',
          status: adm.status,
        }));

      return {
        doctorId: doc.id,
        doctorName: doc.name,
        doctorCode,
        userId: doc.userId,
        schedules,
        inpatientCount: inpatients.length,
        appointmentCount: schedules.filter((s) => s.type === 'APPOINTMENT').length,
        rfCount: schedules.filter((s) => s.type === 'RF').length,
        manualCount: schedules.filter((s) => s.type === 'MANUAL').length,
        inpatients,
      };
    });

    res.json({ success: true, data: { date: dateParam, doctors: result } });
  }),
);

export default router;
