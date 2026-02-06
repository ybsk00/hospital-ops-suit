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

    // 5개 도메인 병렬 쿼리
    const [admissions, procedures, appointments, homecare, totalBeds] = await Promise.all([
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
    ]);

    // 병상 가동 (해당 날짜에 활성 입원 수)
    const bedOccupancy = await prisma.$queryRawUnsafe<{ bucket: Date; count: bigint }[]>(
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
    );

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

export default router;
