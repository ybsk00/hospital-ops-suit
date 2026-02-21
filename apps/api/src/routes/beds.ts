import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { BedStatus } from '@prisma/client';

const router = Router();

// ─── GET /api/beds ── 병동별 베드 전체 조회 (베드보드) ───
router.get(
  '/',
  requireAuth,
  requirePermission('BEDS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { wardId, status } = req.query;

    const wards = await prisma.ward.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(wardId ? { id: wardId as string } : {}),
      },
      include: {
        rooms: {
          where: { deletedAt: null, isActive: true },
          orderBy: { name: 'asc' },
          include: {
            beds: {
              where: {
                deletedAt: null,
                isActive: true,
                ...(status ? { status: status as BedStatus } : {}),
              },
              orderBy: { label: 'asc' },
              include: {
                currentAdmission: {
                  where: { deletedAt: null, status: { not: 'DISCHARGED' } },
                  include: {
                    patient: { select: { id: true, name: true, emrPatientId: true, sex: true, dob: true } },
                    attendingDoctor: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // 통계 계산
    const allBeds = wards.flatMap((w) => w.rooms.flatMap((r) => r.beds));
    const stats = {
      total: allBeds.length,
      empty: allBeds.filter((b) => b.status === 'EMPTY').length,
      occupied: allBeds.filter((b) => b.status === 'OCCUPIED').length,
      reserved: allBeds.filter((b) => b.status === 'RESERVED').length,
      cleaning: allBeds.filter((b) => b.status === 'CLEANING').length,
      isolation: allBeds.filter((b) => b.status === 'ISOLATION').length,
      outOfOrder: allBeds.filter((b) => b.status === 'OUT_OF_ORDER').length,
    };

    res.json({ success: true, data: { wards, stats } });
  }),
);

// ─── GET /api/beds/summary ── 간단 요약 (챗봇용) ───
router.get(
  '/summary',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const beds = await prisma.bed.findMany({
      where: { deletedAt: null, isActive: true },
      select: { status: true },
    });

    const summary: Record<string, number> = {};
    for (const bed of beds) {
      summary[bed.status] = (summary[bed.status] || 0) + 1;
    }

    res.json({ success: true, data: { total: beds.length, byStatus: summary } });
  }),
);

// ─── PATCH /api/beds/:id/status ── 베드 상태 변경 ───
const statusChangeSchema = z.object({
  status: z.nativeEnum(BedStatus),
  version: z.number().int(),
});

// ─── POST /api/beds/wards ── 병동 생성 ───
const wardSchema = z.object({
  name: z.string().min(1, '병동명은 필수입니다.'),
  floor: z.number().int().optional(),
});

router.post(
  '/wards',
  requireAuth,
  requirePermission('BEDS', 'ADMIN'),
  auditLog('CREATE', 'Ward'),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, floor } = wardSchema.parse(req.body);

    const existing = await prisma.ward.findFirst({
      where: { name, deletedAt: null },
    });
    if (existing) {
      throw new AppError(400, 'DUPLICATE', '동일한 이름의 병동이 이미 존재합니다.');
    }

    const ward = await prisma.ward.create({
      data: { name, floor },
    });

    res.json({ success: true, data: ward });
  }),
);

// ─── POST /api/beds/rooms ── 병실 생성 ───
const roomSchema = z.object({
  wardId: z.string().uuid(),
  name: z.string().min(1, '병실명은 필수입니다.'),
  capacity: z.number().int().min(1).default(1),
});

router.post(
  '/rooms',
  requireAuth,
  requirePermission('BEDS', 'ADMIN'),
  auditLog('CREATE', 'Room'),
  asyncHandler(async (req: Request, res: Response) => {
    const { wardId, name, capacity } = roomSchema.parse(req.body);

    const ward = await prisma.ward.findFirst({
      where: { id: wardId, deletedAt: null },
    });
    if (!ward) {
      throw new AppError(404, 'NOT_FOUND', '병동을 찾을 수 없습니다.');
    }

    const existing = await prisma.room.findFirst({
      where: { wardId, name, deletedAt: null },
    });
    if (existing) {
      throw new AppError(400, 'DUPLICATE', '동일한 이름의 병실이 이미 존재합니다.');
    }

    const room = await prisma.room.create({
      data: { wardId, name, capacity },
    });

    res.json({ success: true, data: room });
  }),
);

// ─── POST /api/beds ── 베드 생성 (단건 또는 다건) ───
const bedSchema = z.object({
  roomId: z.string().uuid(),
  label: z.string().min(1, '베드 라벨은 필수입니다.'),
});

const bedBatchSchema = z.object({
  roomId: z.string().uuid(),
  labels: z.array(z.string().min(1)).min(1, '최소 1개의 베드 라벨이 필요합니다.'),
});

router.post(
  '/',
  requireAuth,
  requirePermission('BEDS', 'ADMIN'),
  auditLog('CREATE', 'Bed'),
  asyncHandler(async (req: Request, res: Response) => {
    // 배치 생성인 경우
    if (req.body.labels) {
      const { roomId, labels } = bedBatchSchema.parse(req.body);

      const room = await prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
      });
      if (!room) {
        throw new AppError(404, 'NOT_FOUND', '병실을 찾을 수 없습니다.');
      }

      const existingBeds = await prisma.bed.findMany({
        where: { roomId, deletedAt: null },
        select: { label: true },
      });
      const existingLabels = new Set(existingBeds.map((b) => b.label));
      const duplicates = labels.filter((l) => existingLabels.has(l));
      if (duplicates.length > 0) {
        throw new AppError(400, 'DUPLICATE', `중복된 베드 라벨: ${duplicates.join(', ')}`);
      }

      const beds = await prisma.bed.createMany({
        data: labels.map((label) => ({ roomId, label })),
      });

      res.json({ success: true, data: { count: beds.count } });
    } else {
      // 단건 생성
      const { roomId, label } = bedSchema.parse(req.body);

      const room = await prisma.room.findFirst({
        where: { id: roomId, deletedAt: null },
      });
      if (!room) {
        throw new AppError(404, 'NOT_FOUND', '병실을 찾을 수 없습니다.');
      }

      const existing = await prisma.bed.findFirst({
        where: { roomId, label, deletedAt: null },
      });
      if (existing) {
        throw new AppError(400, 'DUPLICATE', '동일한 라벨의 베드가 이미 존재합니다.');
      }

      const bed = await prisma.bed.create({
        data: { roomId, label },
      });

      res.json({ success: true, data: bed });
    }
  }),
);

// ─── DELETE /api/beds/wards/:id ── 병동 삭제 ───
router.delete(
  '/wards/:id',
  requireAuth,
  requirePermission('BEDS', 'ADMIN'),
  auditLog('DELETE', 'Ward'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const ward = await prisma.ward.findFirst({
      where: { id, deletedAt: null },
      include: {
        rooms: {
          where: { deletedAt: null },
          include: {
            beds: {
              where: { deletedAt: null, status: 'OCCUPIED' },
            },
          },
        },
      },
    });

    if (!ward) {
      throw new AppError(404, 'NOT_FOUND', '병동을 찾을 수 없습니다.');
    }

    // 사용 중인 베드가 있으면 삭제 불가
    const occupiedBeds = ward.rooms.flatMap((r) => r.beds);
    if (occupiedBeds.length > 0) {
      throw new AppError(400, 'BEDS_IN_USE', '사용 중인 베드가 있어 삭제할 수 없습니다.');
    }

    // 소프트 삭제 (병동 + 병실 + 베드)
    await prisma.$transaction([
      prisma.bed.updateMany({
        where: { room: { wardId: id }, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      }),
      prisma.room.updateMany({
        where: { wardId: id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      }),
      prisma.ward.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
    ]);

    res.json({ success: true, data: { message: '병동이 삭제되었습니다.' } });
  }),
);

// ─── DELETE /api/beds/rooms/:id ── 병실 삭제 ───
router.delete(
  '/rooms/:id',
  requireAuth,
  requirePermission('BEDS', 'ADMIN'),
  auditLog('DELETE', 'Room'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const room = await prisma.room.findFirst({
      where: { id, deletedAt: null },
      include: {
        beds: {
          where: { deletedAt: null, status: 'OCCUPIED' },
        },
      },
    });

    if (!room) {
      throw new AppError(404, 'NOT_FOUND', '병실을 찾을 수 없습니다.');
    }

    if (room.beds.length > 0) {
      throw new AppError(400, 'BEDS_IN_USE', '사용 중인 베드가 있어 삭제할 수 없습니다.');
    }

    // 소프트 삭제 (병실 + 베드)
    await prisma.$transaction([
      prisma.bed.updateMany({
        where: { roomId: id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      }),
      prisma.room.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
    ]);

    res.json({ success: true, data: { message: '병실이 삭제되었습니다.' } });
  }),
);

// ─── DELETE /api/beds/:id ── 베드 삭제 ───
router.delete(
  '/:id',
  requireAuth,
  requirePermission('BEDS', 'ADMIN'),
  auditLog('DELETE', 'Bed'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const bed = await prisma.bed.findFirst({
      where: { id, deletedAt: null },
    });

    if (!bed) {
      throw new AppError(404, 'NOT_FOUND', '베드를 찾을 수 없습니다.');
    }

    if (bed.status === 'OCCUPIED') {
      throw new AppError(400, 'BED_IN_USE', '사용 중인 베드는 삭제할 수 없습니다.');
    }

    await prisma.bed.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    res.json({ success: true, data: { message: '베드가 삭제되었습니다.' } });
  }),
);

// ─── GET /api/beds/projection ── 베드 주간 전망 ───
router.get(
  '/projection',
  requireAuth,
  requirePermission('BEDS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fromDate = from ? new Date(from as string) : today;
    const toDate = to ? new Date(to as string) : new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);

    // 날짜 배열 생성
    const dates: string[] = [];
    const d = new Date(fromDate);
    while (d <= toDate) {
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      d.setDate(d.getDate() + 1);
    }

    // 병실+베드 전체 조회
    const rooms = await prisma.room.findMany({
      where: { deletedAt: null, isActive: true },
      include: {
        ward: { select: { id: true, name: true } },
        beds: {
          where: { deletedAt: null, isActive: true },
          orderBy: { label: 'asc' },
          include: {
            currentAdmission: {
              include: {
                patient: { select: { id: true, name: true } },
                attendingDoctor: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // 미래 입원예약 (아직 입원하지 않은)
    const futureAdmissions = await prisma.admission.findMany({
      where: {
        deletedAt: null,
        status: { not: 'DISCHARGED' },
        admitDate: { gte: fromDate, lte: toDate },
      },
      include: {
        patient: { select: { id: true, name: true } },
        currentBed: true,
      },
    });

    // 병실별 베드별 날짜별 상태 계산
    const result = rooms.map((room) => ({
      roomName: room.name,
      wardName: room.ward.name,
      beds: room.beds.map((bed) => {
        const admission = bed.currentAdmission || null;

        const days = dates.map((dateStr) => {
          const dayDate = new Date(dateStr + 'T00:00:00');

          // 현재 입원이 있는 경우
          if (admission) {
            const admitDate = new Date(admission.admitDate);
            const plannedDischarge = admission.plannedDischargeDate
              ? new Date(admission.plannedDischargeDate)
              : null;

            // 퇴원 예정일인 경우
            if (plannedDischarge) {
              const pdStr = `${plannedDischarge.getFullYear()}-${String(plannedDischarge.getMonth() + 1).padStart(2, '0')}-${String(plannedDischarge.getDate()).padStart(2, '0')}`;
              if (pdStr === dateStr) {
                return {
                  date: dateStr,
                  status: 'DISCHARGE_SOON' as const,
                  patientName: admission.patient.name,
                  event: 'DISCHARGE' as const,
                };
              }
            }

            // 입원일인 경우
            const adStr = `${admitDate.getFullYear()}-${String(admitDate.getMonth() + 1).padStart(2, '0')}-${String(admitDate.getDate()).padStart(2, '0')}`;
            if (adStr === dateStr) {
              return {
                date: dateStr,
                status: 'OCCUPIED' as const,
                patientName: admission.patient.name,
                event: 'ADMIT' as const,
              };
            }

            // 재원 중
            if (admitDate <= dayDate && (!plannedDischarge || plannedDischarge > dayDate)) {
              return {
                date: dateStr,
                status: 'OCCUPIED' as const,
                patientName: admission.patient.name,
                event: null,
              };
            }
          }

          // 미래 예약이 있는 경우
          const futureAdmission = futureAdmissions.find(
            (fa) => fa.currentBedId === bed.id,
          );
          if (futureAdmission) {
            const faDate = new Date(futureAdmission.admitDate);
            const faStr = `${faDate.getFullYear()}-${String(faDate.getMonth() + 1).padStart(2, '0')}-${String(faDate.getDate()).padStart(2, '0')}`;
            if (faStr === dateStr) {
              return {
                date: dateStr,
                status: 'RESERVED' as const,
                patientName: futureAdmission.patient.name,
                event: 'ADMIT' as const,
              };
            }
          }

          // 빈 베드
          return {
            date: dateStr,
            status: bed.status === 'OUT_OF_ORDER' ? ('OUT_OF_ORDER' as const) : ('EMPTY' as const),
            patientName: null,
            event: null,
          };
        });

        return {
          bedId: bed.id,
          label: bed.label,
          currentStatus: bed.status,
          days,
        };
      }),
    }));

    res.json({
      success: true,
      data: { dates, rooms: result },
    });
  }),
);

// ─── PATCH /api/beds/:id/status ── 베드 상태 변경 ───
router.patch(
  '/:id/status',
  requireAuth,
  requirePermission('BEDS', 'WRITE'),
  auditLog('BED_STATUS_CHANGE', 'Bed'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, version } = statusChangeSchema.parse(req.body);

    const bed = await prisma.bed.findUnique({ where: { id } });
    if (!bed || bed.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '베드를 찾을 수 없습니다.');
    }

    // 낙관적 잠금
    if (bed.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 변경했습니다. 새로고침 후 재시도하세요.');
    }

    // OCCUPIED 상태는 입원 배정을 통해서만 변경
    if (status === 'OCCUPIED') {
      throw new AppError(400, 'INVALID_STATUS', 'OCCUPIED 상태는 입원 배정을 통해서만 설정할 수 있습니다.');
    }

    // 현재 환자가 있는 베드는 EMPTY로 변경 불가
    if (status === 'EMPTY' && bed.status === 'OCCUPIED') {
      throw new AppError(400, 'INVALID_STATUS', '환자가 있는 베드는 퇴원 처리 후 변경하세요.');
    }

    res.locals.auditBefore = { status: bed.status, version: bed.version };

    const updated = await prisma.bed.update({
      where: { id, version },
      data: { status, version: { increment: 1 } },
    });

    res.locals.auditAfter = { status: updated.status, version: updated.version };

    res.json({ success: true, data: updated });
  }),
);

export default router;
