import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// ─── GET /api/staff-notes ── 날짜별 메모 조회 ───
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { noteType, date, from, to } = req.query;

    const where: any = {};
    if (noteType) where.noteType = noteType;
    if (date) {
      where.date = new Date(date as string);
    } else if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from as string);
      if (to) where.date.lte = new Date(to as string);
    }

    const notes = await prisma.staffDayNote.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({ success: true, data: notes });
  }),
);

// ─── POST /api/staff-notes ── 메모 생성 ───
const createSchema = z.object({
  noteType: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string().min(1, '내용을 입력하세요.'),
  targetId: z.string().uuid().optional(),
});

router.post(
  '/',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);

    const note = await prisma.staffDayNote.create({
      data: {
        noteType: body.noteType,
        date: new Date(body.date),
        content: body.content,
        targetId: body.targetId || null,
        createdById: (req as any).user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ success: true, data: note });
  }),
);

// ─── PATCH /api/staff-notes/:id ── 메모 수정 ───
const updateSchema = z.object({
  content: z.string().min(1).optional(),
});

router.patch(
  '/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateSchema.parse(req.body);

    const existing = await prisma.staffDayNote.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '메모를 찾을 수 없습니다.');

    const updated = await prisma.staffDayNote.update({
      where: { id: req.params.id },
      data: body,
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    res.json({ success: true, data: updated });
  }),
);

// ─── DELETE /api/staff-notes/:id ── 메모 삭제 ───
router.delete(
  '/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.staffDayNote.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '메모를 찾을 수 없습니다.');

    await prisma.staffDayNote.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, data: { message: '삭제되었습니다.' } });
  }),
);

export default router;
