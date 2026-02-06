import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { auditLog } from '../middleware/audit';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { analyzeLabUploads } from '../services/labAnalysisService';

const router = Router();

// 파일 저장 경로
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads/lab-files');

// 디렉토리 생성
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer 설정
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel', // xls
    'text/csv',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];
  const allowedExts = ['.xlsx', '.xls', '.csv', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('지원하지 않는 파일 형식입니다. (xlsx, csv, pdf, jpg, png 가능)'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ============================================================
// POST /api/lab-uploads - 파일 업로드
// ============================================================

router.post(
  '/',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'WRITE'),
  upload.array('files', 20),
  auditLog('CREATE', 'LabUpload'),
  asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      throw new AppError(400, 'NO_FILES', '업로드할 파일이 없습니다.');
    }

    const userId = (req as any).user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const created = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      const fileType = ext === 'xlsx' || ext === 'xls' ? 'xlsx' : ext;

      const labUpload = await prisma.labUpload.create({
        data: {
          uploadedById: userId,
          fileName: file.originalname,
          storagePath: file.path,
          fileSize: file.size,
          fileType,
          uploadedDate: today,
          status: 'PENDING',
        },
      });

      created.push(labUpload);
    }

    res.status(201).json({
      success: true,
      data: {
        uploaded: created.length,
        files: created.map((u) => ({
          id: u.id,
          fileName: u.fileName,
          fileSize: u.fileSize,
          fileType: u.fileType,
          status: u.status,
        })),
      },
    });
  }),
);

// ============================================================
// GET /api/lab-uploads - 날짜별 업로드 현황 목록
// ============================================================

router.get(
  '/',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

    // 날짜별로 그룹핑하여 조회
    const uploads = await prisma.labUpload.groupBy({
      by: ['uploadedDate', 'status'],
      where: { deletedAt: null },
      _count: { id: true },
      orderBy: { uploadedDate: 'desc' },
      take: limit * 5, // 상태별로 여러 행이 나올 수 있으므로
    });

    // 날짜별로 병합
    const dateMap = new Map<string, {
      date: string;
      totalFiles: number;
      pendingFiles: number;
      analyzedFiles: number;
      failedFiles: number;
    }>();

    for (const row of uploads) {
      const dateStr = new Date(row.uploadedDate).toISOString().slice(0, 10);
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, {
          date: dateStr,
          totalFiles: 0,
          pendingFiles: 0,
          analyzedFiles: 0,
          failedFiles: 0,
        });
      }
      const entry = dateMap.get(dateStr)!;
      entry.totalFiles += row._count.id;
      if (row.status === 'PENDING' || row.status === 'ANALYZING') {
        entry.pendingFiles += row._count.id;
      } else if (row.status === 'ANALYZED') {
        entry.analyzedFiles += row._count.id;
      } else if (row.status === 'FAILED') {
        entry.failedFiles += row._count.id;
      }
    }

    // 승인 상태 조회
    const approvals = await prisma.labApproval.findMany({
      where: { deletedAt: null },
      select: { uploadDate: true, status: true },
    });

    const approvalMap = new Map<string, string>();
    for (const a of approvals) {
      const dateStr = new Date(a.uploadDate).toISOString().slice(0, 10);
      approvalMap.set(dateStr, a.status);
    }

    const items = Array.from(dateMap.values())
      .map((entry) => ({
        ...entry,
        approvalStatus: approvalMap.get(entry.date) || null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);

    res.json({ success: true, data: { items } });
  }),
);

// ============================================================
// GET /api/lab-uploads/:date - 특정 날짜 상세 (파일 목록 + 분석 상태)
// ============================================================

router.get(
  '/:date',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const dateStr = req.params.date;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new AppError(400, 'INVALID_DATE', '유효하지 않은 날짜입니다.');
    }

    date.setHours(0, 0, 0, 0);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const uploads = await prisma.labUpload.findMany({
      where: {
        uploadedDate: { gte: date, lt: nextDate },
        deletedAt: null,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        analyses: {
          where: { deletedAt: null },
          select: {
            id: true,
            patientName: true,
            emrPatientId: true,
            abnormalCount: true,
            normalCount: true,
            status: true,
            aiComment: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 요약 통계
    let totalPatients = 0;
    let abnormalPatients = 0;
    const patientSet = new Set<string>();

    for (const upload of uploads) {
      for (const analysis of upload.analyses) {
        if (analysis.emrPatientId) {
          if (!patientSet.has(analysis.emrPatientId)) {
            patientSet.add(analysis.emrPatientId);
            totalPatients++;
            if (analysis.abnormalCount > 0) abnormalPatients++;
          }
        }
      }
    }

    // 승인 상태
    const approval = await prisma.labApproval.findUnique({
      where: { uploadDate: date },
      include: {
        approvedBy: { select: { id: true, name: true } },
      },
    });

    res.json({
      success: true,
      data: {
        date: dateStr,
        files: uploads.map((u) => ({
          id: u.id,
          fileName: u.fileName,
          fileSize: u.fileSize,
          fileType: u.fileType,
          status: u.status,
          errorMessage: u.errorMessage,
          uploadedBy: u.uploadedBy,
          createdAt: u.createdAt,
          analyses: u.analyses,
        })),
        summary: {
          totalFiles: uploads.length,
          analyzedFiles: uploads.filter((u) => u.status === 'ANALYZED').length,
          pendingFiles: uploads.filter((u) => u.status === 'PENDING' || u.status === 'ANALYZING').length,
          failedFiles: uploads.filter((u) => u.status === 'FAILED').length,
          totalPatients,
          abnormalPatients,
          normalPatients: totalPatients - abnormalPatients,
        },
        approval: approval ? {
          id: approval.id,
          status: approval.status,
          approvedBy: approval.approvedBy,
          approvedAt: approval.approvedAt,
          stampedAt: approval.stampedAt,
        } : null,
      },
    });
  }),
);

// ============================================================
// POST /api/lab-uploads/:date/analyze - 분석 시작
// ============================================================

router.post(
  '/:date/analyze',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'WRITE'),
  auditLog('ANALYZE', 'LabUpload'),
  asyncHandler(async (req: Request, res: Response) => {
    const dateStr = req.params.date;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new AppError(400, 'INVALID_DATE', '유효하지 않은 날짜입니다.');
    }

    date.setHours(0, 0, 0, 0);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    // 대기중인 파일 조회
    const pendingUploads = await prisma.labUpload.findMany({
      where: {
        uploadedDate: { gte: date, lt: nextDate },
        status: 'PENDING',
        deletedAt: null,
      },
    });

    if (pendingUploads.length === 0) {
      throw new AppError(400, 'NO_PENDING_FILES', '분석할 대기중인 파일이 없습니다.');
    }

    // 상태를 ANALYZING으로 변경
    await prisma.labUpload.updateMany({
      where: { id: { in: pendingUploads.map((u) => u.id) } },
      data: { status: 'ANALYZING' },
    });

    // 비동기로 분석 시작
    analyzeLabUploads(pendingUploads.map((u) => u.id)).catch((err) => {
      console.error('[LabUpload] 분석 실패:', err.message);
    });

    res.json({
      success: true,
      data: {
        message: '분석이 시작되었습니다.',
        fileCount: pendingUploads.length,
      },
    });
  }),
);

// ============================================================
// DELETE /api/lab-uploads/:id - 파일 삭제
// ============================================================

router.delete(
  '/:id',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'DELETE'),
  auditLog('DELETE', 'LabUpload'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const upload = await prisma.labUpload.findFirst({
      where: { id, deletedAt: null },
    });

    if (!upload) {
      throw new AppError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
    }

    // 분석완료된 파일은 삭제 불가
    if (upload.status === 'ANALYZED') {
      throw new AppError(400, 'CANNOT_DELETE', '분석완료된 파일은 삭제할 수 없습니다.');
    }

    await prisma.labUpload.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // 실제 파일 삭제
    try {
      fs.unlinkSync(upload.storagePath);
    } catch {
      // 파일 삭제 실패 무시
    }

    res.json({ success: true, data: { id } });
  }),
);

// ============================================================
// GET /api/lab-uploads/analyses/:id - 분석 상세 조회
// ============================================================

router.get(
  '/analyses/:id',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const analysis = await prisma.labAnalysis.findFirst({
      where: { id, deletedAt: null },
      include: {
        upload: { select: { fileName: true, fileType: true } },
        patient: { select: { id: true, name: true, emrPatientId: true } },
        labResults: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (!analysis) {
      throw new AppError(404, 'NOT_FOUND', '분석 결과를 찾을 수 없습니다.');
    }

    res.json({ success: true, data: analysis });
  }),
);

// ============================================================
// PUT /api/lab-uploads/analyses/:id - 분석 결과 수정 (코멘트, 스탬프, 우선순위)
// ============================================================

router.put(
  '/analyses/:id',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'WRITE'),
  auditLog('UPDATE', 'LabAnalysis'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { doctorComment, stamp, priority } = req.body;

    const analysis = await prisma.labAnalysis.findFirst({
      where: { id, deletedAt: null },
    });

    if (!analysis) {
      throw new AppError(404, 'NOT_FOUND', '분석 결과를 찾을 수 없습니다.');
    }

    // 이미 승인된 경우 수정 불가
    if (analysis.status === 'APPROVED') {
      throw new AppError(400, 'ALREADY_APPROVED', '이미 승인된 분석결과는 수정할 수 없습니다.');
    }

    const updateData: any = {};
    if (doctorComment !== undefined) updateData.doctorComment = doctorComment;
    if (stamp !== undefined) updateData.stamp = stamp;
    if (priority !== undefined) updateData.priority = priority;

    const updated = await prisma.labAnalysis.update({
      where: { id },
      data: updateData,
    });

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// POST /api/lab-uploads/analyses/approve - 분석 결과 승인 (다건)
// ============================================================

router.post(
  '/analyses/approve',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'APPROVE'),
  auditLog('APPROVE', 'LabAnalysis'),
  asyncHandler(async (req: Request, res: Response) => {
    const { analysisIds } = req.body;
    const userId = (req as any).user.id;

    if (!Array.isArray(analysisIds) || analysisIds.length === 0) {
      throw new AppError(400, 'INVALID_INPUT', '승인할 분석 ID 목록이 필요합니다.');
    }

    // 승인 처리
    const result = await prisma.labAnalysis.updateMany({
      where: {
        id: { in: analysisIds },
        status: 'ANALYZED',
        deletedAt: null,
      },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        approvedCount: result.count,
        message: `${result.count}건이 승인되었습니다.`,
      },
    });
  }),
);

// ============================================================
// GET /api/lab-uploads/approved - 승인된 검사결과 목록 (간호사 확인용)
// ============================================================

router.get(
  '/approved',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const dateStr = req.query.date as string;

    const where: any = {
      status: 'APPROVED',
      deletedAt: null,
    };

    if (dateStr) {
      const date = new Date(dateStr);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      where.approvedAt = { gte: date, lt: nextDate };
    }

    const analyses = await prisma.labAnalysis.findMany({
      where,
      include: {
        upload: { select: { fileName: true, uploadedDate: true } },
        patient: { select: { id: true, name: true, emrPatientId: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { approvedAt: 'desc' },
      take: limit,
    });

    res.json({ success: true, data: { items: analyses } });
  }),
);

export default router;
