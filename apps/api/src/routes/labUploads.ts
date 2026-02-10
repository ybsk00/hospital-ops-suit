import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
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
// DELETE /api/lab-uploads/:id - 파일 삭제 (관련 분석결과 및 InboxItem도 함께 삭제)
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
      include: {
        analyses: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
    });

    if (!upload) {
      throw new AppError(404, 'NOT_FOUND', '파일을 찾을 수 없습니다.');
    }

    const analysisIds = upload.analyses.map((a) => a.id);

    // 트랜잭션으로 삭제 처리
    await prisma.$transaction(async (tx) => {
      // 1. 관련 InboxItem 삭제 (LAB_APPROVED 타입)
      if (analysisIds.length > 0) {
        await tx.inboxItem.deleteMany({
          where: {
            entityType: 'LabAnalysis',
            entityId: { in: analysisIds },
          },
        });

        // 2. 관련 LabResult 삭제 (소프트 삭제)
        await tx.labResult.updateMany({
          where: { analysisId: { in: analysisIds } },
          data: { deletedAt: new Date() },
        });

        // 3. 관련 LabAnalysis 삭제 (소프트 삭제)
        await tx.labAnalysis.updateMany({
          where: { id: { in: analysisIds } },
          data: { deletedAt: new Date() },
        });
      }

      // 4. LabUpload 삭제 (소프트 삭제)
      await tx.labUpload.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });

    // 실제 파일 삭제
    try {
      fs.unlinkSync(upload.storagePath);
    } catch {
      // 파일 삭제 실패 무시
    }

    res.json({
      success: true,
      data: {
        id,
        deletedAnalyses: analysisIds.length,
        message: `파일과 관련 분석결과 ${analysisIds.length}건이 삭제되었습니다.`,
      },
    });
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
// DELETE /api/lab-uploads/analyses/:id - 분석결과 삭제 (개별)
// ============================================================

router.delete(
  '/analyses/:id',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'DELETE'),
  auditLog('DELETE', 'LabAnalysis'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const analysis = await prisma.labAnalysis.findFirst({
      where: { id, deletedAt: null },
      include: {
        upload: { select: { id: true } },
      },
    });

    if (!analysis) {
      throw new AppError(404, 'NOT_FOUND', '분석 결과를 찾을 수 없습니다.');
    }

    // 트랜잭션으로 삭제 처리
    await prisma.$transaction(async (tx) => {
      // 1. 관련 InboxItem 삭제 (LAB_APPROVED 타입)
      await tx.inboxItem.deleteMany({
        where: {
          entityType: 'LabAnalysis',
          entityId: id,
        },
      });

      // 2. 관련 LabResult 삭제 (소프트 삭제)
      await tx.labResult.updateMany({
        where: { analysisId: id },
        data: { deletedAt: new Date() },
      });

      // 3. LabAnalysis 삭제 (소프트 삭제)
      await tx.labAnalysis.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });

    // 해당 파일의 남은 분석결과가 없으면 파일도 삭제할지 확인
    const remainingAnalyses = await prisma.labAnalysis.count({
      where: {
        uploadId: analysis.upload.id,
        deletedAt: null,
      },
    });

    res.json({
      success: true,
      data: {
        id,
        remainingAnalyses,
        message: '분석결과가 삭제되었습니다.',
      },
    });
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

    // 승인자 정보 조회
    const approver = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

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

    // 승인된 분석 결과 조회
    const approvedAnalyses = await prisma.labAnalysis.findMany({
      where: {
        id: { in: analysisIds },
        status: 'APPROVED',
      },
      select: {
        id: true,
        patientName: true,
        emrPatientId: true,
        stamp: true,
        priority: true,
      },
    });

    // 직원(원무과, 간호부)에게 InboxItem 생성
    const staffUsers = await prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        departments: {
          some: {
            department: {
              code: { in: ['ADMIN', 'NURSING'] },
            },
          },
        },
      },
      select: { id: true },
      take: 10,
    });

    // InboxItem 일괄 생성
    const inboxItems = [];
    for (const analysis of approvedAnalyses) {
      for (const staff of staffUsers) {
        inboxItems.push({
          ownerId: staff.id,
          type: 'LAB_APPROVED' as const,
          title: `[검사결과 승인] ${analysis.patientName || '환자'}`,
          summary: `${analysis.stamp || ''} - ${approver?.name || '의사'} 승인`,
          entityType: 'LabAnalysis',
          entityId: analysis.id,
          priority: analysis.priority === 'EMERGENCY' ? 10 : analysis.priority === 'URGENT' ? 8 : 5,
        });
      }
    }

    if (inboxItems.length > 0) {
      await prisma.inboxItem.createMany({ data: inboxItems });
    }

    res.json({
      success: true,
      data: {
        approvedCount: result.count,
        inboxCreated: inboxItems.length,
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

// ============================================================
// GET /api/lab-uploads/analyses/:id/export-pdf - 환자별 PDF 내보내기
// ============================================================

router.get(
  '/analyses/:id/export-pdf',
  requireAuth,
  requirePermission('LAB_UPLOADS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const analysis = await prisma.labAnalysis.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true, dob: true, sex: true } },
        approvedBy: { select: { id: true, name: true } },
        labResults: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
        upload: { select: { uploadedDate: true } },
      },
    });

    if (!analysis) {
      throw new AppError(404, 'NOT_FOUND', '분석 결과를 찾을 수 없습니다.');
    }

    if (analysis.status !== 'APPROVED') {
      throw new AppError(400, 'NOT_APPROVED', '승인된 검사결과만 PDF로 내보낼 수 있습니다.');
    }

    // PDF 생성 - 한글 폰트 지원
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // Noto Sans KR 폰트 로드
    const fontPath = path.join(__dirname, '../../fonts/NotoSansKR-Regular.ttf');
    let font;
    let boldFont;

    if (fs.existsSync(fontPath)) {
      const fontBytes = fs.readFileSync(fontPath);
      font = await pdfDoc.embedFont(fontBytes);
      boldFont = font; // 한글 폰트는 볼드 별도 없이 동일 사용
    } else {
      // 폰트 파일이 없으면 기본 폰트 사용 (한글 안됨)
      const { StandardFonts } = await import('pdf-lib');
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      console.warn('Korean font not found, using Helvetica (Korean text will not display)');
    }

    // ============================================================
    // EONE 스타일 검사결과 보고서 PDF 생성
    // ============================================================
    const pageW = 595;
    const pageH = 842;
    const margin = 40;
    const contentW = pageW - margin * 2;
    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const headerBg = rgb(0.93, 0.93, 0.93);
    const red = rgb(0.8, 0, 0);
    const blue = rgb(0, 0.3, 0.7);

    const patientName = sanitizeForPdf(analysis.patientName || analysis.patient?.name) || '';
    const chartNo = sanitizeForPdf(analysis.emrPatientId || analysis.patient?.emrPatientId) || '';
    // 생년월일 마스킹: YYMM까지 표시, 나머지 xx 처리 (주민번호 형식)
    let maskedDob = '';
    if (analysis.patient?.dob) {
      const d = new Date(analysis.patient.dob);
      const yy = String(d.getFullYear() % 100).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      maskedDob = `${yy}${mm}xx-xxxxxxx`;
    }
    const testDate = analysis.upload?.uploadedDate
      ? formatShortDate(analysis.upload.uploadedDate)
      : '';
    const approvalDate = analysis.approvedAt ? formatShortDateTime(analysis.approvedAt) : '';
    const approverName = sanitizeForPdf(analysis.approvedBy?.name) || '';

    // 총 페이지 수 사전 계산
    const resultsPerFirstPage = 28;
    const resultsPerNextPage = 38;
    const totalResults = analysis.labResults.length;
    let totalPages = 1;
    if (totalResults > resultsPerFirstPage) {
      totalPages += Math.ceil((totalResults - resultsPerFirstPage) / resultsPerNextPage);
    }

    let currentPage = pdfDoc.addPage([pageW, pageH]);
    let pageCount = 1;
    let y = pageH - margin;

    // ── 우선순위 스탬프 (최상단) ──
    if (analysis.stamp || analysis.priority !== 'NORMAL') {
      const stampText = sanitizeForPdf(analysis.stamp) || getPriorityStampText(analysis.priority);
      const stampColor = getPriorityColor(analysis.priority);
      const sFontSize = 14;
      const sTextW = font.widthOfTextAtSize(stampText, sFontSize);
      const sPad = 16;
      const sW = sTextW + sPad * 2;
      const sH = 30;
      const sX = (pageW - sW) / 2;

      currentPage.drawRectangle({ x: sX, y: y - sH, width: sW, height: sH, borderColor: stampColor, borderWidth: 2, color: rgb(1, 1, 1) });
      currentPage.drawText(stampText, { x: sX + sPad, y: y - sH + 9, size: sFontSize, font: boldFont, color: stampColor });
      y -= sH + 15;
    }

    // ── 헬퍼: 헤더 + 환자정보 테이블 그리기 ──
    const drawPageHeader = (pg: typeof currentPage, startY: number, pgNum: number) => {
      let cy = startY;

      // 타이틀 "검사결과 보고서"
      pg.drawText('검사결과 보고서', { x: margin, y: cy, size: 16, font: boldFont, color: black });
      // 페이지 번호
      const pgText = `${pgNum} of ${totalPages}`;
      const pgTextW = font.widthOfTextAtSize(pgText, 9);
      pg.drawText(pgText, { x: pageW - margin - pgTextW, y: cy + 2, size: 9, font, color: gray });
      cy -= 28;

      // ── 환자정보 테이블 (3열 5행) ──
      const infoH = 14;
      const infoRows = 5;
      const tableH = infoRows * infoH;
      const col1W = contentW * 0.36;
      const col2W = contentW * 0.30;
      const col3W = contentW * 0.34;
      const tX = margin;
      const tY = cy;

      // 외곽 테두리
      pg.drawRectangle({ x: tX, y: tY - tableH, width: contentW, height: tableH, borderColor: black, borderWidth: 0.5 });
      // 세로선
      pg.drawLine({ start: { x: tX + col1W, y: tY }, end: { x: tX + col1W, y: tY - tableH }, thickness: 0.5, color: black });
      pg.drawLine({ start: { x: tX + col1W + col2W, y: tY }, end: { x: tX + col1W + col2W, y: tY - tableH }, thickness: 0.5, color: black });
      // 가로선
      for (let r = 1; r < infoRows; r++) {
        pg.drawLine({ start: { x: tX, y: tY - r * infoH }, end: { x: tX + contentW, y: tY - r * infoH }, thickness: 0.3, color: lightGray });
      }

      const fs = 8;
      const labelC = rgb(0.3, 0.3, 0.3);
      const valC = black;
      const lPad = 4;

      // 좌측 열
      const drawInfoCell = (col: number, row: number, label: string, value: string) => {
        const cx = tX + (col === 0 ? 0 : col === 1 ? col1W : col1W + col2W) + lPad;
        const ry = tY - row * infoH - 10;
        pg.drawText(label, { x: cx, y: ry, size: fs, font, color: labelC });
        const labelW = font.widthOfTextAtSize(label + ' ', fs);
        pg.drawText(value, { x: cx + labelW, y: ry, size: fs, font: boldFont, color: valC });
      };

      // 1열 (좌)
      drawInfoCell(0, 0, '병(의)원명', '서울온케어의원');
      drawInfoCell(0, 1, '수진자명', patientName);
      drawInfoCell(0, 2, '생년월일', maskedDob);
      drawInfoCell(0, 3, '차트번호', chartNo);
      drawInfoCell(0, 4, '검체종류', 'S:Serum');

      // 2열 (중)
      drawInfoCell(1, 0, '기관기호', '');
      drawInfoCell(1, 1, '진료과/병동', '');
      drawInfoCell(1, 2, '의 사 명', approverName);
      drawInfoCell(1, 3, '접수번호', '');

      // 3열 (우)
      drawInfoCell(2, 0, '검체채취일', '');
      drawInfoCell(2, 1, '접수일시', '');
      drawInfoCell(2, 2, '검사일시', testDate);
      drawInfoCell(2, 3, '보고일시', approvalDate);
      drawInfoCell(2, 4, '기    타', '');

      cy -= tableH + 12;
      return cy;
    };

    y = drawPageHeader(currentPage, y, pageCount);

    // ── 결과 테이블 ──
    const rColWidths = [70, 150, 60, 40, 140, 35]; // 보험코드, 검사명, 결과, 판정, 참고치, 검체
    const rTableW = rColWidths.reduce((a, b) => a + b, 0);
    const rTableX = margin;
    const rHeaders = ['보험코드', '검사명', '결과', '판정', '참고치', '검체'];
    const rRowH = 15;
    const rHeaderH = 18;
    const minYForTable = 120;

    // 헬퍼: 결과 테이블 헤더
    const drawResultHeader = (pg: typeof currentPage, startY: number) => {
      // 헤더 배경
      pg.drawRectangle({ x: rTableX, y: startY - rHeaderH, width: rTableW, height: rHeaderH, color: headerBg });
      // 헤더 외곽
      pg.drawRectangle({ x: rTableX, y: startY - rHeaderH, width: rTableW, height: rHeaderH, borderColor: black, borderWidth: 0.5 });
      // 세로선 + 텍스트
      let cx = rTableX;
      for (let i = 0; i < rHeaders.length; i++) {
        if (i > 0) {
          pg.drawLine({ start: { x: cx, y: startY }, end: { x: cx, y: startY - rHeaderH }, thickness: 0.3, color: black });
        }
        pg.drawText(rHeaders[i], { x: cx + 4, y: startY - rHeaderH + 5, size: 8, font: boldFont, color: black });
        cx += rColWidths[i];
      }
      return startY - rHeaderH;
    };

    let tableY = drawResultHeader(currentPage, y);

    // 테이블 데이터
    for (let idx = 0; idx < analysis.labResults.length; idx++) {
      const result = analysis.labResults[idx];

      // 페이지 넘김
      if (tableY - rRowH < minYForTable) {
        // 현재 페이지 테이블 하단 닫기선
        currentPage.drawLine({ start: { x: rTableX, y: tableY }, end: { x: rTableX + rTableW, y: tableY }, thickness: 0.5, color: black });

        currentPage = pdfDoc.addPage([pageW, pageH]);
        pageCount++;
        let ny = pageH - margin;

        // 새 페이지 헤더
        currentPage.drawText('검사결과 보고서 (계속)', { x: margin, y: ny, size: 12, font: boldFont, color: gray });
        const pgText = `${pageCount} of ${totalPages}`;
        const pgTextW = font.widthOfTextAtSize(pgText, 9);
        currentPage.drawText(pgText, { x: pageW - margin - pgTextW, y: ny + 2, size: 9, font, color: gray });
        ny -= 25;

        tableY = drawResultHeader(currentPage, ny);
      }

      // 행 그리기
      const rowY = tableY - rRowH;
      let cx = rTableX;
      const flagColor = getFlagColor(result.flag);

      // 행 배경 (이상수치)
      if (result.flag !== 'NORMAL') {
        currentPage.drawRectangle({ x: rTableX + 0.5, y: rowY, width: rTableW - 1, height: rRowH, color: rgb(1, 0.96, 0.93) });
      }

      // 행 하단선
      currentPage.drawLine({ start: { x: rTableX, y: rowY }, end: { x: rTableX + rTableW, y: rowY }, thickness: 0.2, color: lightGray });

      const rFs = 8;
      const textY = rowY + 4;

      // 보험코드 (빈칸)
      cx += rColWidths[0];

      // 검사명
      const testItemName = sanitizeForPdf(result.analyte || result.testName) || '';
      currentPage.drawText(truncateText(testItemName, 22), { x: cx + 4, y: textY, size: rFs, font, color: black });
      cx += rColWidths[1];

      // 결과
      const valueStr = result.value != null ? String(result.value) : '-';
      currentPage.drawText(valueStr, { x: cx + 4, y: textY, size: rFs, font: boldFont, color: flagColor });
      cx += rColWidths[2];

      // 판정 (▲H / ▼L 형식)
      let flagText = '';
      if (result.flag === 'HIGH' || result.flag === 'CRITICAL') {
        flagText = '\u25B2H'; // ▲H
      } else if (result.flag === 'LOW') {
        flagText = '\u25BCL'; // ▼L
      }
      if (flagText) {
        currentPage.drawText(flagText, { x: cx + 4, y: textY, size: rFs, font: boldFont, color: flagColor });
      }
      cx += rColWidths[3];

      // 참고치 (범위 + 단위)
      const unitStr = sanitizeForPdf(result.unit) || '';
      let refText = '';
      if (result.refLow != null && result.refHigh != null) {
        refText = `${String(result.refLow)} ~ ${String(result.refHigh)}`;
        if (unitStr) refText += ` ${unitStr}`;
      } else if (unitStr) {
        refText = unitStr;
      }
      currentPage.drawText(truncateText(refText, 22), { x: cx + 4, y: textY, size: rFs, font, color: black });
      cx += rColWidths[4];

      // 검체
      currentPage.drawText('S', { x: cx + 8, y: textY, size: rFs, font, color: black });

      tableY = rowY;
    }

    // 테이블 하단 닫기선
    currentPage.drawLine({ start: { x: rTableX, y: tableY }, end: { x: rTableX + rTableW, y: tableY }, thickness: 0.5, color: black });
    // 좌우 세로선 전체
    currentPage.drawLine({ start: { x: rTableX, y: y }, end: { x: rTableX, y: tableY }, thickness: 0.5, color: black });
    currentPage.drawLine({ start: { x: rTableX + rTableW, y: y }, end: { x: rTableX + rTableW, y: tableY }, thickness: 0.5, color: black });

    y = tableY - 15;

    // ── 분석 소견 ──
    const rawComment = analysis.doctorComment || analysis.aiComment;
    const comment = sanitizeForPdf(rawComment);

    if (comment) {
      const commentLines = wrapText(comment, 75);
      const commentHeight = commentLines.length * 13 + 35;

      if (y < commentHeight + 100) {
        currentPage = pdfDoc.addPage([pageW, pageH]);
        pageCount++;
        y = pageH - margin;
        currentPage.drawText('검사결과 보고서 - 분석 소견', { x: margin, y, size: 12, font: boldFont, color: gray });
        y -= 25;
      }

      currentPage.drawLine({ start: { x: margin, y }, end: { x: margin + contentW, y }, thickness: 0.5, color: lightGray });
      y -= 16;
      currentPage.drawText('분석 소견:', { x: margin, y, size: 10, font: boldFont, color: rgb(0.2, 0.4, 0.6) });
      y -= 15;

      for (const line of commentLines) {
        if (y < 90) {
          currentPage = pdfDoc.addPage([pageW, pageH]);
          pageCount++;
          y = pageH - margin;
        }
        currentPage.drawText(line, { x: margin, y, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
        y -= 13;
      }
    }

    // ── 이원의료재단 스타일 푸터 ──
    if (y < 130) {
      currentPage = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin;
    }

    const footerTop = Math.min(y - 10, 105);
    const logoAreaW = 95;
    const infoX = margin + logoAreaW;
    const infoAreaW = contentW - logoAreaW;

    // 상단 구분선
    currentPage.drawLine({ start: { x: margin, y: footerTop }, end: { x: margin + contentW, y: footerTop }, thickness: 0.5, color: black });

    // ── 좌측: eo 로고 ──
    const eoneGreen = rgb(0.15, 0.45, 0.25);
    const eR = 7;
    const eCX = margin + 16;
    const eCY = footerTop - 15;
    // 'e' - 원형 + 가운데 바 + 우하단 개방
    currentPage.drawCircle({ x: eCX, y: eCY, size: eR, borderColor: eoneGreen, borderWidth: 2.2 });
    currentPage.drawLine({ start: { x: eCX - 1, y: eCY }, end: { x: eCX + eR + 1, y: eCY }, thickness: 1.8, color: eoneGreen });
    currentPage.drawRectangle({ x: eCX + 2, y: eCY - eR - 1, width: eR, height: eR - 1, color: rgb(1, 1, 1) });
    // 'o' - 원형
    const oCX = eCX + eR * 2 + 5;
    currentPage.drawCircle({ x: oCX, y: eCY, size: eR, borderColor: eoneGreen, borderWidth: 2.2 });

    // 이원의료재단 텍스트
    currentPage.drawText('이원의료재단', { x: margin + 4, y: footerTop - 32, size: 7.5, font: boldFont, color: black });
    currentPage.drawText('EONE Laboratories', { x: margin + 4, y: footerTop - 42, size: 6, font, color: gray });
    currentPage.drawText('V.2407-A4', { x: margin + 4, y: footerTop - 51, size: 5.5, font, color: gray });

    // 세로 구분선 (로고 | 내용)
    currentPage.drawLine({ start: { x: infoX - 5, y: footerTop }, end: { x: infoX - 5, y: footerTop - 45 }, thickness: 0.3, color: lightGray });

    // ── 우측: 검사자 / 보고자 (서명 없음) ──
    const fRow1Y = footerTop - 14;
    currentPage.drawText('검사자', { x: infoX, y: fRow1Y, size: 8, font: boldFont, color: black });
    currentPage.drawText('보고자', { x: infoX + infoAreaW / 2, y: fRow1Y, size: 8, font: boldFont, color: black });
    if (approverName) {
      currentPage.drawText(approverName, { x: infoX + infoAreaW / 2 + 35, y: fRow1Y, size: 8, font, color: black });
    }

    // 중간 구분선
    currentPage.drawLine({ start: { x: infoX - 5, y: fRow1Y - 8 }, end: { x: margin + contentW, y: fRow1Y - 8 }, thickness: 0.3, color: lightGray });

    // 주소/연락처
    const fRow2Y = fRow1Y - 22;
    currentPage.drawText('인천광역시 연수구 하모니로 291   검사기관번호 41341473', { x: infoX, y: fRow2Y, size: 6.5, font, color: black });
    currentPage.drawText('TEL 1600-0021   www.eonelab.co.kr', { x: infoX + infoAreaW / 2, y: fRow2Y, size: 6.5, font, color: black });

    // 하단 구분선
    const footerBottom = footerTop - 48;
    currentPage.drawLine({ start: { x: margin, y: footerBottom }, end: { x: margin + contentW, y: footerBottom }, thickness: 0.5, color: black });

    // 인증 문구
    currentPage.drawText(
      '대한진단검사의학회 \u00B7 진단검사의학재단의 우수검사실 산업인증과 미국의 CAP 인증을 받은 검사기관입니다.',
      { x: margin + 10, y: footerBottom - 13, size: 6, font, color: gray },
    );

    // ── 승인 스탬프 (우측 하단) ──
    if (analysis.approvedAt && analysis.approvedBy) {
      const stampSize = 55;
      const stampX = pageW - margin - stampSize - 5;
      const stampCY = footerTop + 40;

      currentPage.drawCircle({
        x: stampX + stampSize / 2,
        y: stampCY,
        size: stampSize / 2,
        borderColor: rgb(0.8, 0.1, 0.1),
        borderWidth: 2,
        opacity: 0.7,
      });

      currentPage.drawText('승인', {
        x: stampX + 16, y: stampCY + 8, size: 11, font: boldFont, color: rgb(0.8, 0.1, 0.1),
      });
      currentPage.drawText(formatShortDate(analysis.approvedAt), {
        x: stampX + 8, y: stampCY - 5, size: 7, font, color: rgb(0.8, 0.1, 0.1),
      });
      currentPage.drawText(approverName, {
        x: stampX + 12, y: stampCY - 16, size: 8, font: boldFont, color: rgb(0.8, 0.1, 0.1),
      });
    }

    // PDF 출력
    const pdfBytes = await pdfDoc.save();
    const safePatientName = patientName.replace(/[^a-zA-Z0-9]/g, '_') || 'patient';
    const fileName = `lab-result-${safePatientName}-${testDate.replace(/-/g, '')}.pdf`;

    // download=true 파라미터가 있으면 다운로드, 없으면 브라우저에서 미리보기
    const forceDownload = req.query.download === 'true';
    const disposition = forceDownload ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    res.send(Buffer.from(pdfBytes));
  }),
);

// 헬퍼 함수들
function getPriorityStampText(priority: string): string {
  switch (priority) {
    case 'EMERGENCY': return '응급실 방문 필요';
    case 'URGENT': return '병원 내원 요망';
    case 'RECHECK': return '재검사 요망';
    case 'CAUTION': return '건강 유의';
    default: return '';
  }
}

function getPriorityColor(priority: string) {
  switch (priority) {
    case 'EMERGENCY': return rgb(0.8, 0, 0);
    case 'URGENT': return rgb(0.9, 0.4, 0);
    case 'RECHECK': return rgb(0.8, 0.6, 0);
    case 'CAUTION': return rgb(0.2, 0.6, 0.2);
    default: return rgb(0.5, 0.5, 0.5);
  }
}

function getFlagColor(flag: string) {
  switch (flag) {
    case 'CRITICAL': return rgb(0.8, 0, 0);
    case 'HIGH': return rgb(0.9, 0.4, 0);
    case 'LOW': return rgb(0, 0.4, 0.8);
    default: return rgb(0, 0, 0);
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 2) + '..';
}

// PDF용 텍스트 정제 (이모지만 제거, 한글은 유지)
function sanitizeForPdf(text: string | null | undefined): string {
  if (!text) return '';
  // 이모지만 제거하고 한글은 유지
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // 이모지 제거
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // 기타 기호 제거
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats 제거
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')   // Variation selectors 제거
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // 추가 이모지 범위
    .replace(/[\u{E000}-\u{F8FF}]/gu, '')   // Private Use Area 제거
    .trim();
}

// 날짜를 한글 형식으로 변환
function formatDateForPdf(date: Date | string | null): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function formatDateTimeForPdf(date: Date | string | null): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const para of paragraphs) {
    let remaining = para;
    while (remaining.length > maxChars) {
      let breakPoint = remaining.lastIndexOf(' ', maxChars);
      if (breakPoint === -1) breakPoint = maxChars;
      lines.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trim();
    }
    if (remaining) lines.push(remaining);
  }

  return lines;
}

// YYYY-MM-DD HH:MM 형식
function formatShortDateTime(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd}  ${hh}:${mi}`;
}

// YYYY-MM-DD 형식
function formatShortDate(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export default router;
