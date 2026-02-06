import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { LabFlag } from '@prisma/client';
import { generateAiReport } from '../services/aiReportService';

const router = Router();

// ============================================================
// GET /api/lab-results - 검사결과 목록
// ============================================================

router.get(
  '/',
  requireAuth,
  requirePermission('LAB_RESULTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { patientId, flag, testName, page: pageRaw, limit: limitRaw } = req.query;

    const page = Math.max(1, parseInt(pageRaw as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (patientId) where.patientId = patientId as string;
    if (flag) {
      if (!Object.values(LabFlag).includes(flag as LabFlag)) {
        throw new AppError(400, 'INVALID_FLAG', '유효하지 않은 플래그 값입니다.');
      }
      where.flag = flag as LabFlag;
    }
    if (testName) {
      where.testName = { contains: testName as string, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      prisma.labResult.findMany({
        where,
        include: {
          patient: { select: { id: true, name: true, emrPatientId: true } },
        },
        orderBy: { collectedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.labResult.count({ where }),
    ]);

    res.json({ success: true, data: { items, total, page, limit } });
  }),
);

// ============================================================
// GET /api/lab-results/patient/:patientId - 환자별 검사결과
// ============================================================

router.get(
  '/patient/:patientId',
  requireAuth,
  requirePermission('LAB_RESULTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { patientId } = req.params;

    const results = await prisma.labResult.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { collectedAt: 'desc' },
      take: 50,
    });

    // 이상 수치 요약
    const abnormal = results.filter((r) => r.flag !== 'NORMAL');
    const testNames = [...new Set(results.map((r) => r.testName))];

    res.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          abnormalCount: abnormal.length,
          testNames,
        },
      },
    });
  }),
);

// ============================================================
// GET /api/lab-results/:id - 검사결과 상세
// ============================================================

router.get(
  '/:id',
  requireAuth,
  requirePermission('LAB_RESULTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const result = await prisma.labResult.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true, dob: true, sex: true } },
      },
    });

    if (!result) {
      throw new AppError(404, 'NOT_FOUND', '검사결과를 찾을 수 없습니다.');
    }

    res.json({ success: true, data: result });
  }),
);

// ============================================================
// POST /api/lab-results - 검사결과 등록
// ============================================================

const createLabResultSchema = z.object({
  patientId: z.string().uuid(),
  collectedAt: z.string().datetime(),
  testName: z.string().min(1).max(200),
  analyte: z.string().min(1).max(200),
  value: z.number(),
  unit: z.string().max(50).optional(),
  refLow: z.number().optional(),
  refHigh: z.number().optional(),
  flag: z.nativeEnum(LabFlag).optional(),
  flagReason: z.string().max(500).optional(),
});

router.post(
  '/',
  requireAuth,
  requirePermission('LAB_RESULTS', 'WRITE'),
  auditLog('CREATE', 'LabResult'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createLabResultSchema.parse(req.body);

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, deletedAt: null },
    });
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', '환자를 찾을 수 없습니다.');
    }

    // 자동 플래그 판정
    let flag = body.flag || 'NORMAL';
    let flagReason = body.flagReason || null;

    if (!body.flag && body.refLow !== undefined && body.refHigh !== undefined) {
      if (body.value < body.refLow) {
        flag = 'LOW';
        flagReason = `${body.value} < ${body.refLow} (참고 하한)`;
      } else if (body.value > body.refHigh) {
        flag = 'HIGH';
        flagReason = `${body.value} > ${body.refHigh} (참고 상한)`;
      }
    }

    const result = await prisma.labResult.create({
      data: {
        patientId: body.patientId,
        collectedAt: new Date(body.collectedAt),
        testName: body.testName,
        analyte: body.analyte,
        value: body.value,
        unit: body.unit ?? null,
        refLow: body.refLow ?? null,
        refHigh: body.refHigh ?? null,
        flag: flag as LabFlag,
        flagReason,
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    // 이상 수치 시 업무함 알림 생성
    if (flag !== 'NORMAL') {
      // 담당 의사에게 알림 (SuperAdmin에게 전달)
      const admins = await prisma.user.findMany({
        where: { isSuperAdmin: true, deletedAt: null },
        select: { id: true },
        take: 3,
      });

      for (const admin of admins) {
        await prisma.inboxItem.create({
          data: {
            ownerId: admin.id,
            type: 'LAB_ABNORMAL',
            title: `[검사이상] ${patient.name} - ${body.testName}`,
            summary: `${body.analyte}: ${body.value} ${body.unit || ''} (${flag}) ${flagReason || ''}`,
            entityType: 'LabResult',
            entityId: result.id,
            priority: flag === 'HIGH' ? 8 : 5,
          },
        });
      }
    }

    res.locals.auditAfter = result;

    res.status(201).json({ success: true, data: result });
  }),
);

// ============================================================
// POST /api/lab-results/batch - 검사결과 일괄 등록
// ============================================================

const batchLabResultSchema = z.object({
  patientId: z.string().uuid(),
  collectedAt: z.string().datetime(),
  results: z.array(z.object({
    testName: z.string().min(1),
    analyte: z.string().min(1),
    value: z.number(),
    unit: z.string().optional(),
    refLow: z.number().optional(),
    refHigh: z.number().optional(),
  })).min(1).max(50),
});

router.post(
  '/batch',
  requireAuth,
  requirePermission('LAB_RESULTS', 'WRITE'),
  auditLog('BATCH_CREATE', 'LabResult'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = batchLabResultSchema.parse(req.body);

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, deletedAt: null },
    });
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', '환자를 찾을 수 없습니다.');
    }

    const created: any[] = [];
    const abnormals: any[] = [];

    for (const item of body.results) {
      let flag: LabFlag = 'NORMAL';
      let flagReason: string | null = null;

      if (item.refLow !== undefined && item.refHigh !== undefined) {
        if (item.value < item.refLow) {
          flag = 'LOW';
          flagReason = `${item.value} < ${item.refLow}`;
        } else if (item.value > item.refHigh) {
          flag = 'HIGH';
          flagReason = `${item.value} > ${item.refHigh}`;
        }
      }

      const result = await prisma.labResult.create({
        data: {
          patientId: body.patientId,
          collectedAt: new Date(body.collectedAt),
          testName: item.testName,
          analyte: item.analyte,
          value: item.value,
          unit: item.unit ?? null,
          refLow: item.refLow ?? null,
          refHigh: item.refHigh ?? null,
          flag,
          flagReason,
        },
      });

      created.push(result);
      if (flag !== 'NORMAL') abnormals.push(result);
    }

    // 이상 수치 있으면 알림 생성
    if (abnormals.length > 0) {
      const admins = await prisma.user.findMany({
        where: { isSuperAdmin: true, deletedAt: null },
        select: { id: true },
        take: 3,
      });

      for (const admin of admins) {
        await prisma.inboxItem.create({
          data: {
            ownerId: admin.id,
            type: 'LAB_ABNORMAL',
            title: `[검사이상] ${patient.name} - ${abnormals.length}건 이상 수치`,
            summary: abnormals.map((a) => `${a.analyte}: ${a.value} (${a.flag})`).join(', '),
            entityType: 'LabResult',
            entityId: created[0].id,
            priority: 8,
          },
        });
      }
    }

    // AI 소견서 자동 생성
    let autoReport: { id: string; status: string } | null = null;
    try {
      const report = await prisma.aiReport.create({
        data: {
          patientId: body.patientId,
          labBatchId: created[0].id,
          status: 'DRAFT',
        },
      });
      autoReport = { id: report.id, status: report.status };

      // 비동기로 AI 생성 트리거 (실패해도 배치 업로드 응답에 영향 없음)
      generateAiReport(report.id).catch((err) => {
        console.error('[LabBatch] AI 소견서 자동 생성 실패:', err.message);
      });
    } catch (err: any) {
      console.error('[LabBatch] AI 소견서 생성 실패:', err.message);
    }

    res.locals.auditAfter = { count: created.length, abnormalCount: abnormals.length };

    res.status(201).json({
      success: true,
      data: {
        created: created.length,
        abnormalCount: abnormals.length,
        items: created,
        autoReport,
      },
    });
  }),
);

export default router;
