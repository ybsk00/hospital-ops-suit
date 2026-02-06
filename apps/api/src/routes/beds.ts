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
