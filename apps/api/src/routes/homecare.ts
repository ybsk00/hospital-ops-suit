import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { VisitStatus, RiskLevel } from '@prisma/client';

const router = Router();

// ─── GET /api/homecare/today ── 오늘의 방문 (현재 사용자) ─────────────
// NOTE: /today 는 /:id 보다 먼저 선언해야 라우트 충돌 방지
router.get(
  '/today',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const where: any = {
      deletedAt: null,
      scheduledAt: {
        gte: startOfDay,
        lt: endOfDay,
      },
    };

    // SUPER_ADMIN은 전체 조회, 일반 사용자는 본인 방문만
    if (!req.user!.isSuperAdmin) {
      where.staffId = req.user!.id;
    }

    const items = await prisma.homecareVisit.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            emrPatientId: true,
            dob: true,
            sex: true,
            phone: true,
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({ success: true, data: { items } });
  }),
);

// ─── GET /api/homecare/visits ── 가정방문 목록 조회 ──────────────────
router.get(
  '/visits',
  requireAuth,
  requirePermission('HOMECARE_VISITS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      date,
      status,
      staffId,
      patientId,
      page: pageRaw,
      limit: limitRaw,
    } = req.query;

    const page = Math.max(1, parseInt(pageRaw as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    // 날짜 필터 (YYYY-MM-DD)
    if (date) {
      const parsed = new Date(date as string);
      if (isNaN(parsed.getTime())) {
        throw new AppError(400, 'INVALID_DATE', '유효하지 않은 날짜 형식입니다. (YYYY-MM-DD)');
      }
      const startOfDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      const endOfDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + 1);
      where.scheduledAt = { gte: startOfDay, lt: endOfDay };
    }

    if (status) {
      if (!Object.values(VisitStatus).includes(status as VisitStatus)) {
        throw new AppError(400, 'INVALID_STATUS', `유효하지 않은 상태값입니다: ${status}`);
      }
      where.status = status as VisitStatus;
    }

    if (staffId) {
      where.staffId = staffId as string;
    }

    if (patientId) {
      where.patientId = patientId as string;
    }

    const [items, total] = await Promise.all([
      prisma.homecareVisit.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              name: true,
              emrPatientId: true,
            },
          },
          staff: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
      }),
      prisma.homecareVisit.count({ where }),
    ]);

    res.json({
      success: true,
      data: { items, total, page, limit },
    });
  }),
);

// ─── GET /api/homecare/visits/:id ── 가정방문 상세 조회 ──────────────
router.get(
  '/visits/:id',
  requireAuth,
  requirePermission('HOMECARE_VISITS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const visit = await prisma.homecareVisit.findUnique({
      where: { id },
      include: {
        patient: true,
        staff: {
          select: {
            id: true,
            name: true,
            loginId: true,
            email: true,
            phone: true,
          },
        },
        questionnaires: {
          where: { deletedAt: null },
          orderBy: { submittedAt: 'desc' },
        },
        aiReports: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!visit || visit.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '가정방문 정보를 찾을 수 없습니다.');
    }

    res.json({ success: true, data: visit });
  }),
);

// ─── POST /api/homecare/visits ── 가정방문 생성 ─────────────────────
const createVisitSchema = z.object({
  patientId: z.string().uuid(),
  staffId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }).or(z.string().date()),
});

router.post(
  '/visits',
  requireAuth,
  requirePermission('HOMECARE_VISITS', 'WRITE'),
  auditLog('HOMECARE_VISIT_CREATE', 'HomecareVisit'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createVisitSchema.parse(req.body);

    // 환자 존재 확인
    const patient = await prisma.patient.findUnique({
      where: { id: body.patientId },
    });
    if (!patient || patient.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '환자를 찾을 수 없습니다.');
    }

    // 담당 직원 존재 확인
    const staff = await prisma.user.findUnique({
      where: { id: body.staffId },
    });
    if (!staff || staff.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '담당 직원을 찾을 수 없습니다.');
    }

    const visit = await prisma.homecareVisit.create({
      data: {
        patientId: body.patientId,
        staffId: body.staffId,
        scheduledAt: new Date(body.scheduledAt),
        status: VisitStatus.SCHEDULED,
      },
      include: {
        patient: {
          select: { id: true, name: true, emrPatientId: true },
        },
        staff: {
          select: { id: true, name: true },
        },
      },
    });

    res.locals.auditAfter = { visitId: visit.id };

    res.status(201).json({ success: true, data: visit });
  }),
);

// ─── PATCH /api/homecare/visits/:id ── 가정방문 수정 ────────────────
const updateVisitSchema = z.object({
  status: z.nativeEnum(VisitStatus).optional(),
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .optional(),
  staffId: z.string().uuid().optional(),
});

router.patch(
  '/visits/:id',
  requireAuth,
  requirePermission('HOMECARE_VISITS', 'WRITE'),
  auditLog('HOMECARE_VISIT_UPDATE', 'HomecareVisit'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateVisitSchema.parse(req.body);

    const visit = await prisma.homecareVisit.findUnique({ where: { id } });
    if (!visit || visit.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '가정방문 정보를 찾을 수 없습니다.');
    }

    // 변경 전 상태 기록 (감사 로그용)
    res.locals.auditBefore = {
      status: visit.status,
      scheduledAt: visit.scheduledAt,
      staffId: visit.staffId,
      completedAt: visit.completedAt,
    };

    // 담당 직원 변경 시 존재 확인
    if (body.staffId) {
      const staff = await prisma.user.findUnique({
        where: { id: body.staffId },
      });
      if (!staff || staff.deletedAt) {
        throw new AppError(404, 'NOT_FOUND', '담당 직원을 찾을 수 없습니다.');
      }
    }

    const updateData: any = {};
    if (body.status !== undefined) {
      updateData.status = body.status;
      // 완료 상태로 변경 시 completedAt 자동 설정
      if (body.status === VisitStatus.COMPLETED) {
        updateData.completedAt = new Date();
      }
    }
    if (body.scheduledAt !== undefined) {
      updateData.scheduledAt = new Date(body.scheduledAt);
    }
    if (body.staffId !== undefined) {
      updateData.staffId = body.staffId;
    }

    const updated = await prisma.homecareVisit.update({
      where: { id },
      data: updateData,
      include: {
        patient: {
          select: { id: true, name: true, emrPatientId: true },
        },
        staff: {
          select: { id: true, name: true },
        },
      },
    });

    // 변경 후 상태 기록 (감사 로그용)
    res.locals.auditAfter = {
      status: updated.status,
      scheduledAt: updated.scheduledAt,
      staffId: updated.staffId,
      completedAt: updated.completedAt,
    };

    res.json({ success: true, data: updated });
  }),
);

// ─── POST /api/homecare/visits/:id/questionnaire ── 문진표 제출 ──────
const questionnaireSchema = z.object({
  payloadJson: z.record(z.any()),
  riskLevel: z.nativeEnum(RiskLevel).optional(),
  riskReason: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(1).max(255),
});

router.post(
  '/visits/:id/questionnaire',
  requireAuth,
  requirePermission('HOMECARE_VISITS', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = questionnaireSchema.parse(req.body);

    // 방문 존재 확인
    const visit = await prisma.homecareVisit.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, name: true } },
        staff: { select: { id: true, name: true } },
      },
    });
    if (!visit || visit.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '가정방문 정보를 찾을 수 없습니다.');
    }

    // 멱등성 키 중복 확인 → 기존 결과 반환
    const existing = await prisma.questionnaire.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
    });
    if (existing) {
      res.json({ success: true, data: existing });
      return;
    }

    const riskLevel = body.riskLevel ?? RiskLevel.NORMAL;

    const questionnaire = await prisma.questionnaire.create({
      data: {
        visitId: id,
        payloadJson: body.payloadJson,
        riskLevel,
        riskReason: body.riskReason ?? null,
        idempotencyKey: body.idempotencyKey,
        submittedBy: req.user!.id,
      },
    });

    // 위험 수준이 RED 또는 ORANGE인 경우 InboxItem 알림 생성
    if (riskLevel === RiskLevel.RED || riskLevel === RiskLevel.ORANGE) {
      const inboxType = riskLevel === RiskLevel.RED ? 'RED_ALERT' : 'ORANGE_ALERT';
      const title =
        riskLevel === RiskLevel.RED
          ? `[긴급] 가정방문 RED 알림 - ${visit.patient.name}`
          : `[주의] 가정방문 ORANGE 알림 - ${visit.patient.name}`;
      const summary = body.riskReason
        ? `${visit.patient.name} 환자 방문 문진 결과: ${body.riskReason}`
        : `${visit.patient.name} 환자 방문 문진에서 ${riskLevel} 위험도가 감지되었습니다.`;

      // 담당 직원에게 알림 생성
      await prisma.inboxItem.create({
        data: {
          ownerId: visit.staffId,
          type: inboxType,
          title,
          summary,
          entityType: 'Questionnaire',
          entityId: questionnaire.id,
          priority: riskLevel === RiskLevel.RED ? 10 : 5,
        },
      });
    }

    res.status(201).json({ success: true, data: questionnaire });
  }),
);

export default router;
