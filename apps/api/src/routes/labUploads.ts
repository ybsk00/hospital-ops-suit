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
        patient: { select: { id: true, name: true, emrPatientId: true } },
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

    const page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    // 스탬프 (우선순위) - 최상단에 배치
    if (analysis.stamp || analysis.priority !== 'NORMAL') {
      const stampText = sanitizeForPdf(analysis.stamp) || getPriorityStampText(analysis.priority);
      const stampColor = getPriorityColor(analysis.priority);

      // 상단 중앙에 큰 스탬프 배치
      const stampWidth = 200;
      const stampHeight = 40;
      const stampX = (width - stampWidth) / 2;
      const stampY = y - stampHeight;

      // 스탬프 배경
      page.drawRectangle({
        x: stampX,
        y: stampY,
        width: stampWidth,
        height: stampHeight,
        borderColor: stampColor,
        borderWidth: 3,
        color: rgb(1, 1, 1),
      });

      // 스탬프 텍스트
      page.drawText(stampText, {
        x: stampX + 10,
        y: stampY + 12,
        size: 16,
        font: boldFont,
        color: stampColor,
      });

      y -= stampHeight + 20;
    }

    // 헤더: 서울온케어 의원
    page.drawText('서울온케어 의원', {
      x: margin,
      y,
      size: 20,
      font: boldFont,
      color: rgb(0.2, 0.4, 0.6),
    });
    y -= 25;

    page.drawText('혈액검사 결과지', {
      x: margin,
      y,
      size: 14,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 30;

    // 구분선
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 25;

    // 환자 정보
    const patientName = sanitizeForPdf(analysis.patientName || analysis.patient?.name) || 'Unknown';
    const emrId = sanitizeForPdf(analysis.emrPatientId || analysis.patient?.emrPatientId) || '-';
    const testDate = formatDateForPdf(analysis.upload?.uploadedDate);

    page.drawText(`환자명: ${patientName}`, { x: margin, y, size: 11, font: boldFont });
    page.drawText(`차트번호: ${emrId}`, { x: 300, y, size: 11, font });
    y -= 18;
    page.drawText(`검사일: ${testDate}`, { x: margin, y, size: 11, font });
    y -= 30;

    // 검사 결과 테이블
    const colWidths = [120, 70, 60, 100, 60];
    const headers = ['검사항목', '결과', '단위', '참고범위', '판정'];
    const tableX = margin;
    let tableY = y;

    // 테이블 헤더
    page.drawRectangle({
      x: tableX,
      y: tableY - 20,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: 20,
      color: rgb(0.9, 0.9, 0.9),
    });

    let colX = tableX;
    for (let i = 0; i < headers.length; i++) {
      page.drawText(headers[i], {
        x: colX + 5,
        y: tableY - 15,
        size: 9,
        font: boldFont,
      });
      colX += colWidths[i];
    }
    tableY -= 22;

    // 테이블 데이터
    for (const result of analysis.labResults) {
      if (tableY < 150) {
        // 페이지 넘김 필요시 중단 (간단히 처리)
        break;
      }

      colX = tableX;
      const flagColor = getFlagColor(result.flag);

      // 행 배경 (이상수치인 경우)
      if (result.flag !== 'NORMAL') {
        page.drawRectangle({
          x: tableX,
          y: tableY - 15,
          width: colWidths.reduce((a, b) => a + b, 0),
          height: 16,
          color: rgb(1, 0.95, 0.9),
        });
      }

      // 항목명 (null 안전 처리 + PDF 정제)
      const testItemName = sanitizeForPdf(result.analyte || result.testName) || 'Unknown';
      page.drawText(truncateText(testItemName, 18), {
        x: colX + 5,
        y: tableY - 12,
        size: 9,
        font,
      });
      colX += colWidths[0];

      // 결과 (Decimal to String 안전 변환)
      const valueStr = result.value != null ? String(result.value) : '-';
      page.drawText(valueStr, {
        x: colX + 5,
        y: tableY - 12,
        size: 9,
        font: boldFont,
        color: flagColor,
      });
      colX += colWidths[1];

      // 단위
      page.drawText(sanitizeForPdf(result.unit) || '', {
        x: colX + 5,
        y: tableY - 12,
        size: 9,
        font,
      });
      colX += colWidths[2];

      // 참고범위 (Decimal to String 안전 변환)
      const refRange = result.refLow != null && result.refHigh != null
        ? `${String(result.refLow)} - ${String(result.refHigh)}`
        : '-';
      page.drawText(refRange, {
        x: colX + 5,
        y: tableY - 12,
        size: 9,
        font,
      });
      colX += colWidths[3];

      // 판정
      page.drawText(result.flag, {
        x: colX + 5,
        y: tableY - 12,
        size: 9,
        font: boldFont,
        color: flagColor,
      });

      tableY -= 18;
    }

    y = tableY - 20;

    // AI 소견
    const rawComment = analysis.doctorComment || analysis.aiComment;
    const comment = sanitizeForPdf(rawComment);
    if (comment && y > 150) {
      page.drawLine({
        start: { x: margin, y },
        end: { x: width - margin, y },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 20;

      page.drawText('AI 분석 소견:', {
        x: margin,
        y,
        size: 11,
        font: boldFont,
        color: rgb(0.2, 0.4, 0.6),
      });
      y -= 18;

      // 코멘트 줄바꿈 처리
      const lines = wrapText(comment, 80);
      for (const line of lines) {
        if (y < 100) break;
        page.drawText(line, {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0.3, 0.3, 0.3),
        });
        y -= 14;
      }
    }

    // 승인 정보 (하단)
    y = 80;
    page.drawLine({
      start: { x: margin, y: y + 10 },
      end: { x: width - margin, y: y + 10 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });

    if (analysis.approvedAt && analysis.approvedBy) {
      const approvalDate = formatDateTimeForPdf(analysis.approvedAt);
      const approverName = sanitizeForPdf(analysis.approvedBy.name) || 'Doctor';

      page.drawText(`승인일시: ${approvalDate}`, {
        x: margin,
        y,
        size: 9,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      page.drawText(`승인의사: ${approverName}`, {
        x: margin,
        y: y - 14,
        size: 9,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });

      // 승인 스탬프 (우측 하단)
      const stampSize = 60;
      const stampX = width - margin - stampSize;
      const stampY = y - 20;

      page.drawCircle({
        x: stampX + stampSize / 2,
        y: stampY + stampSize / 2,
        size: stampSize / 2,
        borderColor: rgb(0.8, 0.1, 0.1),
        borderWidth: 2,
      });

      page.drawText('승인', {
        x: stampX + 18,
        y: stampY + stampSize / 2 + 5,
        size: 10,
        font: boldFont,
        color: rgb(0.8, 0.1, 0.1),
      });

      const stampDate = formatDateForPdf(analysis.approvedAt);
      page.drawText(stampDate, {
        x: stampX + 10,
        y: stampY + stampSize / 2 - 8,
        size: 7,
        font,
        color: rgb(0.8, 0.1, 0.1),
      });

      page.drawText(approverName, {
        x: stampX + 15,
        y: stampY + stampSize / 2 - 20,
        size: 8,
        font: boldFont,
        color: rgb(0.8, 0.1, 0.1),
      });
    }

    // PDF 출력
    const pdfBytes = await pdfDoc.save();
    const safePatientName = patientName.replace(/[^a-zA-Z0-9]/g, '_') || 'patient';
    const fileName = `lab-result-${safePatientName}-${testDate.replace(/-/g, '')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
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

export default router;
