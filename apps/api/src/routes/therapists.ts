import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// ─── GET /api/therapists ── 치료사 목록 ───
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { specialty, active } = req.query;

    const therapists = await prisma.therapist.findMany({
      where: {
        deletedAt: null,
        ...(specialty ? { specialty: specialty as string } : {}),
        ...(active !== undefined ? { isActive: active === 'true' } : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: therapists });
  }),
);

// ─── GET /api/therapists/:id ── 치료사 상세 ───
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const therapist = await prisma.therapist.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!therapist) throw new AppError(404, 'NOT_FOUND', '치료사를 찾을 수 없습니다.');
    res.json({ success: true, data: therapist });
  }),
);

// ─── POST /api/therapists ── 치료사 생성 ───
const createSchema = z.object({
  name: z.string().min(1, '이름을 입력하세요.'),
  specialty: z.string().optional(),
  workSchedule: z.record(z.boolean()).optional(),
});

router.post(
  '/',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const therapist = await prisma.therapist.create({ data: body });
    res.status(201).json({ success: true, data: therapist });
  }),
);

// ─── PATCH /api/therapists/:id ── 치료사 수정 ───
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  specialty: z.string().optional(),
  isActive: z.boolean().optional(),
  workSchedule: z.record(z.boolean()).optional(),
});

router.patch(
  '/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateSchema.parse(req.body);
    const existing = await prisma.therapist.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '치료사를 찾을 수 없습니다.');

    const updated = await prisma.therapist.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json({ success: true, data: updated });
  }),
);

// ─── DELETE /api/therapists/:id ── 치료사 삭제 (soft) ───
router.delete(
  '/:id',
  requireAuth,
  requirePermission('SCHEDULING', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const existing = await prisma.therapist.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', '치료사를 찾을 수 없습니다.');

    await prisma.therapist.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    res.json({ success: true, data: { message: '삭제되었습니다.' } });
  }),
);

export default router;
