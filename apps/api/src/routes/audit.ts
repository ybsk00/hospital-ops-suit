import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// GET /api/audit – 감사로그 목록 조회
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireAuth,
  requirePermission('AUDIT_LOGS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);

    const { actorUserId, action, entityType, entityId, dateFrom, dateTo, page, limit } = query;

    const where: Record<string, unknown> = {};

    if (actorUserId) where.actorUserId = actorUserId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      };
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          actor: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/audit/:id – 감사로그 상세 조회
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  requireAuth,
  requirePermission('AUDIT_LOGS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const auditLog = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        actor: {
          select: { id: true, name: true, loginId: true },
        },
      },
    });

    if (!auditLog) {
      throw new AppError(404, 'NOT_FOUND', '해당 감사로그를 찾을 수 없습니다.');
    }

    res.json({
      success: true,
      data: auditLog,
    });
  }),
);

export default router;
