import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { ImportStatus, ImportFileType } from '@prisma/client';

const router = Router();

// ─── GET /api/imports ── Import 목록 조회 ─────────────────────────────
router.get(
  '/',
  requireAuth,
  requirePermission('IMPORTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      fileType,
      status,
      page: pageRaw,
      limit: limitRaw,
    } = req.query;

    const page = Math.max(1, parseInt(pageRaw as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (fileType) {
      if (!Object.values(ImportFileType).includes(fileType as ImportFileType)) {
        throw new AppError(400, 'INVALID_FILE_TYPE', `유효하지 않은 파일 유형입니다: ${fileType}`);
      }
      where.fileType = fileType as ImportFileType;
    }

    if (status) {
      if (!Object.values(ImportStatus).includes(status as ImportStatus)) {
        throw new AppError(400, 'INVALID_STATUS', `유효하지 않은 상태값입니다: ${status}`);
      }
      where.status = status as ImportStatus;
    }

    const [items, total] = await Promise.all([
      prisma.import.findMany({
        where,
        include: {
          _count: {
            select: {
              errors: true,
              conflicts: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.import.count({ where }),
    ]);

    res.json({
      success: true,
      data: { items, total, page, limit },
    });
  }),
);

// ─── GET /api/imports/:id ── Import 상세 조회 ─────────────────────────
router.get(
  '/:id',
  requireAuth,
  requirePermission('IMPORTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const importRecord = await prisma.import.findUnique({
      where: { id },
      include: {
        errors: {
          orderBy: { rowNumber: 'asc' },
        },
        conflicts: true,
      },
    });

    if (!importRecord) {
      throw new AppError(404, 'NOT_FOUND', 'Import 정보를 찾을 수 없습니다.');
    }

    res.json({ success: true, data: importRecord });
  }),
);

// ─── POST /api/imports ── 신규 Import 등록 ────────────────────────────
const createImportSchema = z.object({
  filePath: z.string().min(1),
  fileHash: z.string().min(1),
  fileType: z.nativeEnum(ImportFileType),
});

router.post(
  '/',
  requireAuth,
  requirePermission('IMPORTS', 'WRITE'),
  auditLog('IMPORT_CREATE', 'Import'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createImportSchema.parse(req.body);

    // fileHash 중복 확인
    const existing = await prisma.import.findUnique({
      where: { fileHash: body.fileHash },
    });
    if (existing) {
      throw new AppError(
        409,
        'DUPLICATE_FILE_HASH',
        `동일한 파일 해시가 이미 존재합니다. (기존 Import ID: ${existing.id})`,
      );
    }

    const importRecord = await prisma.import.create({
      data: {
        filePath: body.filePath,
        fileHash: body.fileHash,
        fileType: body.fileType,
        status: ImportStatus.PENDING,
      },
    });

    res.locals.auditAfter = { importId: importRecord.id };

    res.status(201).json({ success: true, data: importRecord });
  }),
);

// ─── PATCH /api/imports/:id/status ── Import 상태 업데이트 ────────────
const updateStatusSchema = z.object({
  status: z.nativeEnum(ImportStatus),
  statsJson: z.any().optional(),
});

router.patch(
  '/:id/status',
  requireAuth,
  requirePermission('IMPORTS', 'WRITE'),
  auditLog('IMPORT_STATUS_UPDATE', 'Import'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateStatusSchema.parse(req.body);

    const importRecord = await prisma.import.findUnique({ where: { id } });
    if (!importRecord) {
      throw new AppError(404, 'NOT_FOUND', 'Import 정보를 찾을 수 없습니다.');
    }

    res.locals.auditBefore = {
      status: importRecord.status,
      startedAt: importRecord.startedAt,
      finishedAt: importRecord.finishedAt,
      statsJson: importRecord.statsJson,
    };

    const updateData: any = {
      status: body.status,
    };

    if (body.statsJson !== undefined) {
      updateData.statsJson = body.statsJson;
    }

    // PROCESSING 상태로 변경 시 startedAt 설정
    if (body.status === ImportStatus.PROCESSING) {
      updateData.startedAt = new Date();
    }

    // SUCCESS 또는 FAIL 상태로 변경 시 finishedAt 설정
    if (body.status === ImportStatus.SUCCESS || body.status === ImportStatus.FAIL) {
      updateData.finishedAt = new Date();
    }

    const updated = await prisma.import.update({
      where: { id },
      data: updateData,
    });

    res.locals.auditAfter = {
      status: updated.status,
      startedAt: updated.startedAt,
      finishedAt: updated.finishedAt,
      statsJson: updated.statsJson,
    };

    res.json({ success: true, data: updated });
  }),
);

// ─── POST /api/imports/:id/errors ── Import 오류 추가 ─────────────────
const createErrorSchema = z.object({
  errorCode: z.string().min(1),
  message: z.string().min(1),
  sheetName: z.string().optional(),
  rowNumber: z.number().int().optional(),
  rawRowJson: z.any().optional(),
  detailsJson: z.any().optional(),
});

router.post(
  '/:id/errors',
  requireAuth,
  requirePermission('IMPORTS', 'WRITE'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = createErrorSchema.parse(req.body);

    // Import 존재 확인
    const importRecord = await prisma.import.findUnique({ where: { id } });
    if (!importRecord) {
      throw new AppError(404, 'NOT_FOUND', 'Import 정보를 찾을 수 없습니다.');
    }

    const importError = await prisma.importError.create({
      data: {
        importId: id,
        errorCode: body.errorCode,
        message: body.message,
        sheetName: body.sheetName ?? null,
        rowNumber: body.rowNumber ?? null,
        rawRowJson: body.rawRowJson ?? null,
        detailsJson: body.detailsJson ?? null,
      },
    });

    res.status(201).json({ success: true, data: importError });
  }),
);

// ─── GET /api/imports/:id/conflicts ── Import 충돌 목록 조회 ──────────
router.get(
  '/:id/conflicts',
  requireAuth,
  requirePermission('IMPORTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Import 존재 확인
    const importRecord = await prisma.import.findUnique({ where: { id } });
    if (!importRecord) {
      throw new AppError(404, 'NOT_FOUND', 'Import 정보를 찾을 수 없습니다.');
    }

    const conflicts = await prisma.patientIdentityConflict.findMany({
      where: { importId: id },
      include: {
        resolvedBy: {
          select: { name: true },
        },
      },
      orderBy: { detectedAt: 'desc' },
    });

    res.json({ success: true, data: conflicts });
  }),
);

// ─── PATCH /api/imports/conflicts/:conflictId/resolve ── 충돌 해결 ────
const resolveConflictSchema = z.object({
  resolution: z.enum(['ACCEPT_NEW', 'KEEP_OLD', 'MANUAL']),
});

router.patch(
  '/conflicts/:conflictId/resolve',
  requireAuth,
  requirePermission('IMPORTS', 'WRITE'),
  auditLog('CONFLICT_RESOLVE', 'PatientIdentityConflict'),
  asyncHandler(async (req: Request, res: Response) => {
    const { conflictId } = req.params;
    const body = resolveConflictSchema.parse(req.body);

    const conflict = await prisma.patientIdentityConflict.findUnique({
      where: { id: conflictId },
    });
    if (!conflict) {
      throw new AppError(404, 'NOT_FOUND', '충돌 정보를 찾을 수 없습니다.');
    }

    if (conflict.status !== 'OPEN') {
      throw new AppError(400, 'ALREADY_RESOLVED', '이미 해결된 충돌입니다.');
    }

    res.locals.auditBefore = {
      status: conflict.status,
      resolvedById: conflict.resolvedById,
      resolvedAt: conflict.resolvedAt,
    };

    const updated = await prisma.$transaction(async (tx) => {
      // ACCEPT_NEW인 경우 Patient 레코드를 afterJson 데이터로 업데이트
      if (body.resolution === 'ACCEPT_NEW') {
        const afterData = conflict.afterJson as Record<string, any>;

        // emrPatientId로 환자 조회
        const patient = await tx.patient.findUnique({
          where: { emrPatientId: conflict.emrPatientId },
        });

        if (patient) {
          const patientUpdateData: any = {};
          if (afterData.name !== undefined) patientUpdateData.name = afterData.name;
          if (afterData.dob !== undefined) patientUpdateData.dob = new Date(afterData.dob);
          if (afterData.sex !== undefined) patientUpdateData.sex = afterData.sex;
          if (afterData.phone !== undefined) patientUpdateData.phone = afterData.phone;

          await tx.patient.update({
            where: { emrPatientId: conflict.emrPatientId },
            data: patientUpdateData,
          });
        }
      }

      // 충돌 상태 업데이트
      return tx.patientIdentityConflict.update({
        where: { id: conflictId },
        data: {
          status: body.resolution,
          resolvedById: req.user!.id,
          resolvedAt: new Date(),
        },
      });
    });

    res.locals.auditAfter = {
      status: updated.status,
      resolvedById: updated.resolvedById,
      resolvedAt: updated.resolvedAt,
    };

    res.json({ success: true, data: updated });
  }),
);

export default router;
