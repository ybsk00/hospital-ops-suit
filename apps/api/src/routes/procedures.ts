import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { ProcedureStatus } from '@prisma/client';

const router = Router();

// ─── GET /api/procedures/catalog ── 처치 카탈로그 목록 ───
router.get(
  '/catalog',
  requireAuth,
  requirePermission('PROCEDURES', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, search } = req.query;

    const items = await prisma.procedureCatalog.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(category ? { category: category as string } : {}),
        ...(search
          ? { name: { contains: search as string, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    res.json({ success: true, data: items });
  }),
);

// ─── GET /api/procedures/plans ── 처치 계획 목록 ───
router.get(
  '/plans',
  requireAuth,
  requirePermission('PROCEDURES', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { admissionId, patientId, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: any = { deletedAt: null };
    if (admissionId) {
      where.admissionId = admissionId as string;
    }
    if (patientId) {
      where.admission = { patientId: patientId as string, deletedAt: null };
    }

    const [items, total] = await Promise.all([
      prisma.procedurePlan.findMany({
        where,
        include: {
          procedureCatalog: true,
          admission: {
            include: {
              patient: {
                select: { id: true, name: true, emrPatientId: true, sex: true, dob: true },
              },
            },
          },
          executions: {
            where: { deletedAt: null },
            orderBy: { scheduledAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.procedurePlan.count({ where }),
    ]);

    res.json({
      success: true,
      data: items,
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  }),
);

// ─── POST /api/procedures/plans ── 처치 계획 생성 ───
const createPlanSchema = z.object({
  admissionId: z.string().uuid(),
  procedureCatalogId: z.string().uuid(),
  scheduleRule: z.record(z.unknown()),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/plans',
  requireAuth,
  requirePermission('PROCEDURES', 'WRITE'),
  auditLog('PROCEDURE_PLAN_CREATE', 'ProcedurePlan'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createPlanSchema.parse(req.body);

    // 입원 존재 확인
    const admission = await prisma.admission.findUnique({
      where: { id: body.admissionId },
    });
    if (!admission || admission.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '해당 입원 정보를 찾을 수 없습니다.');
    }

    // 카탈로그 존재 확인
    const catalog = await prisma.procedureCatalog.findUnique({
      where: { id: body.procedureCatalogId },
    });
    if (!catalog || catalog.deletedAt || !catalog.isActive) {
      throw new AppError(404, 'NOT_FOUND', '해당 처치 카탈로그를 찾을 수 없습니다.');
    }

    const plan = await prisma.procedurePlan.create({
      data: {
        admissionId: body.admissionId,
        procedureCatalogId: body.procedureCatalogId,
        scheduleRule: body.scheduleRule as any,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null,
        notes: body.notes ?? null,
      },
      include: {
        procedureCatalog: true,
        admission: {
          include: {
            patient: {
              select: { id: true, name: true, emrPatientId: true },
            },
          },
        },
      },
    });

    res.locals.auditAfter = { id: plan.id, admissionId: plan.admissionId, procedureCatalogId: plan.procedureCatalogId };

    res.status(201).json({ success: true, data: plan });
  }),
);

// ─── GET /api/procedures/executions/today ── 오늘 처치 (챗봇용) ───
router.get(
  '/executions/today',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const executions = await prisma.procedureExecution.findMany({
      where: {
        deletedAt: null,
        scheduledAt: { gte: todayStart, lte: todayEnd },
      },
      include: {
        plan: {
          include: {
            procedureCatalog: { select: { id: true, name: true, category: true } },
            admission: {
              include: {
                patient: { select: { id: true, name: true, emrPatientId: true } },
              },
            },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    const data = executions.map((e) => ({
      id: e.id,
      patientName: e.plan.admission.patient.name,
      procedureName: e.plan.procedureCatalog.name,
      category: e.plan.procedureCatalog.category,
      status: e.status,
      scheduledAt: e.scheduledAt,
      executedAt: e.executedAt,
    }));

    res.json({ success: true, data });
  }),
);

// ─── GET /api/procedures/executions/pending ── 미완료 처치 (챗봇용) ───
router.get(
  '/executions/pending',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();

    const executions = await prisma.procedureExecution.findMany({
      where: {
        deletedAt: null,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        scheduledAt: { lte: now },
      },
      include: {
        plan: {
          include: {
            procedureCatalog: { select: { id: true, name: true, category: true } },
            admission: {
              include: {
                patient: { select: { id: true, name: true, emrPatientId: true } },
              },
            },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    const data = executions.map((e) => ({
      id: e.id,
      patientName: e.plan.admission.patient.name,
      procedureName: e.plan.procedureCatalog.name,
      category: e.plan.procedureCatalog.category,
      status: e.status,
      scheduledAt: e.scheduledAt,
    }));

    res.json({ success: true, data });
  }),
);

// ─── GET /api/procedures/executions ── 처치 실행 목록 ───
router.get(
  '/executions',
  requireAuth,
  requirePermission('PROCEDURES', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { date, status, planId } = req.query;

    const where: any = { deletedAt: null };

    if (date) {
      const dayStart = new Date(date as string);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date as string);
      dayEnd.setHours(23, 59, 59, 999);
      where.scheduledAt = { gte: dayStart, lte: dayEnd };
    }

    if (status) {
      where.status = status as ProcedureStatus;
    }

    if (planId) {
      where.planId = planId as string;
    }

    const executions = await prisma.procedureExecution.findMany({
      where,
      include: {
        plan: {
          include: {
            procedureCatalog: true,
            admission: {
              include: {
                patient: {
                  select: { id: true, name: true, emrPatientId: true, sex: true, dob: true },
                },
              },
            },
          },
        },
        executedBy: {
          select: { id: true, name: true, loginId: true },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({ success: true, data: executions });
  }),
);

// ─── PATCH /api/procedures/executions/:id ── 처치 실행 기록 ───
const updateExecutionSchema = z.object({
  status: z.nativeEnum(ProcedureStatus),
  executedAt: z.string().datetime({ offset: true }).optional(),
  appliedUnitPrice: z.number().nonnegative().optional(),
  quantity: z.number().nonnegative().optional(),
  dose: z.string().max(500).optional(),
  detailsJson: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).optional(),
  version: z.number().int(),
});

router.patch(
  '/executions/:id',
  requireAuth,
  requirePermission('PROCEDURES', 'WRITE'),
  auditLog('PROCEDURE_EXECUTION_UPDATE', 'ProcedureExecution'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateExecutionSchema.parse(req.body);

    const execution = await prisma.procedureExecution.findUnique({ where: { id } });
    if (!execution || execution.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '처치 실행 기록을 찾을 수 없습니다.');
    }

    if (execution.isLocked) {
      throw new AppError(400, 'LOCKED', '이미 잠긴 처치 기록은 수정할 수 없습니다.');
    }

    // 낙관적 잠금
    if (execution.version !== body.version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 변경했습니다. 새로고침 후 재시도하세요.');
    }

    res.locals.auditBefore = {
      status: execution.status,
      executedAt: execution.executedAt,
      executedById: execution.executedById,
      version: execution.version,
    };

    // 완료 상태로 전환 시 실행자 자동 설정
    const isCompleting = body.status === 'COMPLETED' && execution.status !== 'COMPLETED';

    const updated = await prisma.procedureExecution.update({
      where: { id, version: body.version },
      data: {
        status: body.status,
        executedAt: body.executedAt
          ? new Date(body.executedAt)
          : isCompleting
            ? new Date()
            : undefined,
        executedById: isCompleting ? req.user!.id : undefined,
        appliedUnitPrice: body.appliedUnitPrice,
        quantity: body.quantity,
        dose: body.dose,
        detailsJson: body.detailsJson as any,
        notes: body.notes,
        version: { increment: 1 },
      },
      include: {
        plan: {
          include: {
            procedureCatalog: { select: { id: true, name: true, category: true } },
            admission: {
              include: {
                patient: { select: { id: true, name: true, emrPatientId: true } },
              },
            },
          },
        },
        executedBy: {
          select: { id: true, name: true, loginId: true },
        },
      },
    });

    res.locals.auditAfter = {
      status: updated.status,
      executedAt: updated.executedAt,
      executedById: updated.executedById,
      version: updated.version,
    };

    res.json({ success: true, data: updated });
  }),
);

// ─── GET /api/procedures/summary ── 요약 ───
router.get(
  '/summary',
  requireAuth,
  requirePermission('PROCEDURES', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.query;

    const targetDate = date ? new Date(date as string) : new Date();
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const executions = await prisma.procedureExecution.findMany({
      where: {
        deletedAt: null,
        scheduledAt: { gte: dayStart, lte: dayEnd },
      },
      select: { status: true },
    });

    const byStatus: Record<string, number> = {};
    for (const e of executions) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    }

    res.json({
      success: true,
      data: {
        date: dayStart.toISOString().slice(0, 10),
        total: executions.length,
        byStatus,
      },
    });
  }),
);

// ─── GET /api/procedures/admitted-patients ── 입원중인 환자 목록 ───
router.get(
  '/admitted-patients',
  requireAuth,
  requirePermission('PROCEDURES', 'READ'),
  asyncHandler(async (_req: Request, res: Response) => {
    const admissions = await prisma.admission.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ADMITTED', 'DISCHARGE_PLANNED'] },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        currentBed: {
          include: { room: { include: { ward: { select: { name: true } } } } },
        },
      },
      orderBy: { patient: { name: 'asc' } },
    });

    res.json({ success: true, data: admissions });
  }),
);

// ─── POST /api/procedures/treatments ── 새 치료 등록 ───
const createTreatmentSchema = z.object({
  admissionId: z.string().uuid(),
  treatmentType: z.enum(['RADIOFREQUENCY', 'HYPERBARIC_OXYGEN', 'OTHER']),
  treatmentName: z.string().max(200).optional(), // 기타치료용
  schedules: z.array(z.object({
    date: z.string().date(),
    time: z.string().regex(/^\d{2}:\d{2}$/),
  })).min(1),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/treatments',
  requireAuth,
  requirePermission('PROCEDURES', 'WRITE'),
  auditLog('TREATMENT_CREATE', 'ProcedureExecution'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createTreatmentSchema.parse(req.body);

    // 입원 확인
    const admission = await prisma.admission.findUnique({
      where: { id: body.admissionId },
      include: { patient: true },
    });
    if (!admission || admission.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '입원 정보를 찾을 수 없습니다.');
    }

    // 치료명 결정
    let treatmentName = '';
    let catalogId: string | null = null;

    if (body.treatmentType === 'RADIOFREQUENCY') {
      treatmentName = '고주파열치료';
    } else if (body.treatmentType === 'HYPERBARIC_OXYGEN') {
      treatmentName = '고압산소치료';
    } else if (body.treatmentType === 'OTHER') {
      treatmentName = body.treatmentName || '기타치료';
    }

    // 카탈로그 찾기 또는 생성
    let catalog = await prisma.procedureCatalog.findFirst({
      where: { name: treatmentName, deletedAt: null },
    });

    if (!catalog) {
      catalog = await prisma.procedureCatalog.create({
        data: {
          name: treatmentName,
          category: body.treatmentType === 'OTHER' ? '기타' : '특수치료',
          isActive: true,
          defaultUnitPrice: 0,
        },
      });
    }
    catalogId = catalog.id;

    // 계획 생성
    const plan = await prisma.procedurePlan.create({
      data: {
        admissionId: body.admissionId,
        procedureCatalogId: catalogId,
        scheduleRule: { schedules: body.schedules },
        startDate: new Date(body.schedules[0].date),
        endDate: body.schedules.length > 1 ? new Date(body.schedules[body.schedules.length - 1].date) : null,
        notes: body.notes ?? null,
      },
    });

    // 실행 레코드 생성 (각 스케줄별)
    const executions = await Promise.all(
      body.schedules.map((schedule) => {
        const scheduledAt = new Date(`${schedule.date}T${schedule.time}:00`);
        return prisma.procedureExecution.create({
          data: {
            planId: plan.id,
            scheduledAt,
            status: 'SCHEDULED',
          },
        });
      })
    );

    res.locals.auditAfter = { planId: plan.id, executionCount: executions.length };

    res.status(201).json({
      success: true,
      data: {
        plan,
        executions,
        treatmentName,
        patientName: admission.patient.name,
      },
    });
  }),
);

// ─── GET /api/procedures/calendar ── 달력 뷰용 치료 조회 ───
router.get(
  '/calendar',
  requireAuth,
  requirePermission('PROCEDURES', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = req.query;

    if (!from || !to) {
      throw new AppError(400, 'INVALID_REQUEST', 'from, to 날짜가 필요합니다.');
    }

    const fromDate = new Date(from as string);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to as string);
    toDate.setHours(23, 59, 59, 999);

    const executions = await prisma.procedureExecution.findMany({
      where: {
        deletedAt: null,
        scheduledAt: { gte: fromDate, lte: toDate },
      },
      include: {
        plan: {
          include: {
            procedureCatalog: { select: { id: true, name: true, category: true } },
            admission: {
              include: {
                patient: { select: { id: true, name: true, emrPatientId: true } },
                currentBed: {
                  include: { room: { include: { ward: { select: { name: true } } } } },
                },
              },
            },
          },
        },
        executedBy: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({ success: true, data: executions });
  }),
);

// ─── DELETE /api/procedures/executions/:id ── 치료 삭제 ───
router.delete(
  '/executions/:id',
  requireAuth,
  requirePermission('PROCEDURES', 'WRITE'),
  auditLog('PROCEDURE_EXECUTION_DELETE', 'ProcedureExecution'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const execution = await prisma.procedureExecution.findUnique({ where: { id } });
    if (!execution || execution.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '치료 기록을 찾을 수 없습니다.');
    }

    if (execution.isLocked || execution.status === 'COMPLETED') {
      throw new AppError(400, 'CANNOT_DELETE', '완료된 치료는 삭제할 수 없습니다.');
    }

    res.locals.auditBefore = { id: execution.id, planId: execution.planId };

    await prisma.procedureExecution.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true, message: '삭제되었습니다.' });
  }),
);

export default router;
