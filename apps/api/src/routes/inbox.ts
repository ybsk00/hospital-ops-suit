import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { InboxItemType, InboxItemStatus } from '@prisma/client';

const router = Router();

// ─── GET /api/inbox/count ── 안 읽은 업무함 수 (배지용) ─────────────
// NOTE: /count 는 /:id 보다 먼저 선언해야 라우트 충돌 방지
router.get(
  '/count',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const unreadCount = await prisma.inboxItem.count({
      where: {
        ownerId: req.user!.id,
        status: InboxItemStatus.UNREAD,
      },
    });

    res.json({ success: true, data: { unreadCount } });
  }),
);

// ─── GET /api/inbox/calendar ── 달력 데이터 (월별 업무함 현황) ─────────
router.get(
  '/calendar',
  requireAuth,
  requirePermission('INBOX', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const type = req.query.type as string; // Optional: filter by type (e.g., LAB_APPROVED)

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const where: any = {
      ownerId: req.user!.id,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (type && Object.values(InboxItemType).includes(type as InboxItemType)) {
      where.type = type as InboxItemType;
    }

    // 날짜별 그룹핑
    const items = await prisma.inboxItem.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
      },
    });

    // 날짜별 카운트 집계
    const dateCountMap = new Map<string, number>();
    for (const item of items) {
      const dateStr = item.createdAt.toISOString().slice(0, 10);
      dateCountMap.set(dateStr, (dateCountMap.get(dateStr) || 0) + 1);
    }

    const days = Array.from(dateCountMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    res.json({
      success: true,
      data: {
        year,
        month,
        days,
      },
    });
  }),
);

// ─── GET /api/inbox/by-date/:date ── 특정 날짜 업무함 목록 ────────────
router.get(
  '/by-date/:date',
  requireAuth,
  requirePermission('INBOX', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const dateStr = req.params.date;
    const type = req.query.type as string; // Optional filter

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new AppError(400, 'INVALID_DATE', '유효하지 않은 날짜입니다.');
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const where: any = {
      ownerId: req.user!.id,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };

    if (type && Object.values(InboxItemType).includes(type as InboxItemType)) {
      where.type = type as InboxItemType;
    }

    const items = await prisma.inboxItem.findMany({
      where,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    res.json({
      success: true,
      data: {
        date: dateStr,
        count: items.length,
        items,
      },
    });
  }),
);

// ─── GET /api/inbox ── 업무함 목록 조회 ─────────────────────────────
router.get(
  '/',
  requireAuth,
  requirePermission('INBOX', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      type,
      status,
      priority: priorityRaw,
      page: pageRaw,
      limit: limitRaw,
    } = req.query;

    const page = Math.max(1, parseInt(pageRaw as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = { ownerId: req.user!.id };

    if (type) {
      if (!Object.values(InboxItemType).includes(type as InboxItemType)) {
        throw new AppError(400, 'INVALID_TYPE', `유효하지 않은 타입입니다: ${type}`);
      }
      where.type = type as InboxItemType;
    }

    if (status) {
      if (!Object.values(InboxItemStatus).includes(status as InboxItemStatus)) {
        throw new AppError(400, 'INVALID_STATUS', `유효하지 않은 상태값입니다: ${status}`);
      }
      where.status = status as InboxItemStatus;
    }

    if (priorityRaw !== undefined) {
      const priority = parseInt(priorityRaw as string, 10);
      if (isNaN(priority)) {
        throw new AppError(400, 'INVALID_PRIORITY', '우선순위는 숫자여야 합니다.');
      }
      where.priority = priority;
    }

    const [items, total] = await Promise.all([
      prisma.inboxItem.findMany({
        where,
        include: {
          escalations: true,
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      prisma.inboxItem.count({ where }),
    ]);

    res.json({
      success: true,
      data: { items, total, page, limit },
    });
  }),
);

// ─── GET /api/inbox/:id ── 업무함 상세 조회 ─────────────────────────
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const item = await prisma.inboxItem.findUnique({
      where: { id },
      include: {
        escalations: {
          orderBy: { escalatedAt: 'desc' },
        },
      },
    });

    if (!item || item.ownerId !== req.user!.id) {
      throw new AppError(404, 'NOT_FOUND', '업무함 항목을 찾을 수 없습니다.');
    }

    res.json({ success: true, data: item });
  }),
);

// ─── PATCH /api/inbox/:id/status ── 업무함 상태 변경 ────────────────
const updateStatusSchema = z.object({
  status: z.nativeEnum(InboxItemStatus),
  comment: z.string().max(2000).optional(),
});

router.patch(
  '/:id/status',
  requireAuth,
  requirePermission('INBOX', 'WRITE'),
  auditLog('INBOX_STATUS_CHANGE', 'InboxItem'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateStatusSchema.parse(req.body);

    const item = await prisma.inboxItem.findUnique({ where: { id } });

    if (!item || item.ownerId !== req.user!.id) {
      throw new AppError(404, 'NOT_FOUND', '업무함 항목을 찾을 수 없습니다.');
    }

    res.locals.auditBefore = {
      status: item.status,
      comment: item.comment,
      resolvedAt: item.resolvedAt,
    };

    const updateData: any = {
      status: body.status,
    };

    if (body.comment !== undefined) {
      updateData.comment = body.comment;
    }

    if (body.status === InboxItemStatus.RESOLVED) {
      updateData.resolvedAt = new Date();
    }

    const updated = await prisma.inboxItem.update({
      where: { id },
      data: updateData,
      include: {
        escalations: true,
      },
    });

    res.locals.auditAfter = {
      status: updated.status,
      comment: updated.comment,
      resolvedAt: updated.resolvedAt,
    };

    res.json({ success: true, data: updated });
  }),
);

// ─── POST /api/inbox/:id/escalate ── 업무함 에스컬레이션 ────────────
const escalateSchema = z.object({
  escalatedToId: z.string().uuid(),
  reason: z.string().min(1).max(2000),
});

router.post(
  '/:id/escalate',
  requireAuth,
  requirePermission('INBOX', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = escalateSchema.parse(req.body);

    const item = await prisma.inboxItem.findUnique({ where: { id } });

    if (!item || item.ownerId !== req.user!.id) {
      throw new AppError(404, 'NOT_FOUND', '업무함 항목을 찾을 수 없습니다.');
    }

    // 에스컬레이션 대상 사용자 확인
    const targetUser = await prisma.user.findUnique({
      where: { id: body.escalatedToId },
    });
    if (!targetUser || targetUser.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '에스컬레이션 대상 사용자를 찾을 수 없습니다.');
    }

    const [escalation, newInboxItem] = await prisma.$transaction(async (tx) => {
      // 1) 에스컬레이션 기록 생성
      const esc = await tx.inboxEscalation.create({
        data: {
          inboxItemId: id,
          escalatedToId: body.escalatedToId,
          reason: body.reason,
        },
      });

      // 2) 대상 사용자의 업무함에 새 항목 생성
      const newItem = await tx.inboxItem.create({
        data: {
          ownerId: body.escalatedToId,
          type: item.type,
          status: InboxItemStatus.UNREAD,
          title: `[에스컬레이션] ${item.title}`,
          summary: item.summary,
          entityType: item.entityType,
          entityId: item.entityId,
          priority: Math.min(item.priority + 1, 10),
        },
      });

      return [esc, newItem];
    });

    res.status(201).json({
      success: true,
      data: { escalation, newInboxItem },
    });
  }),
);

export default router;
