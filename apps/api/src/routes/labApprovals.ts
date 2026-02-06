import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission, hasPermissionAsync } from '../middleware/rbac';
import { auditLog } from '../middleware/audit';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { generateDateSummary } from '../services/labAnalysisService';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import ExcelJS from 'exceljs';

const router = Router();

// ============================================================
// GET /api/lab-approvals/calendar - 달력 데이터 (월별 승인 현황)
// ============================================================

router.get(
  '/calendar',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;

    // 해당 월의 시작/끝 날짜
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    // LabAnalysis에서 승인된 건 날짜별 집계
    const analyses = await prisma.labAnalysis.findMany({
      where: {
        status: 'APPROVED',
        approvedAt: {
          gte: startDate,
          lte: endDate,
        },
        deletedAt: null,
      },
      select: {
        id: true,
        approvedAt: true,
        patientName: true,
      },
    });

    // 날짜별로 그룹핑
    const dateMap = new Map<string, number>();
    for (const analysis of analyses) {
      if (analysis.approvedAt) {
        const dateStr = analysis.approvedAt.toISOString().slice(0, 10);
        dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + 1);
      }
    }

    const calendarData = Array.from(dateMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    res.json({
      success: true,
      data: {
        year,
        month,
        days: calendarData,
      },
    });
  }),
);

// ============================================================
// GET /api/lab-approvals/by-date/:date - 특정 날짜 승인된 환자 목록
// ============================================================

router.get(
  '/by-date/:date',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const dateStr = req.params.date;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new AppError(400, 'INVALID_DATE', '유효하지 않은 날짜입니다.');
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const analyses = await prisma.labAnalysis.findMany({
      where: {
        status: 'APPROVED',
        approvedAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        deletedAt: null,
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { approvedAt: 'desc' },
    });

    res.json({
      success: true,
      data: {
        date: dateStr,
        count: analyses.length,
        analyses: analyses.map((a) => ({
          id: a.id,
          patientName: a.patientName,
          emrPatientId: a.emrPatientId,
          patient: a.patient,
          abnormalCount: a.abnormalCount,
          normalCount: a.normalCount,
          priority: a.priority,
          stamp: a.stamp,
          aiComment: a.aiComment,
          approvedBy: a.approvedBy,
          approvedAt: a.approvedAt,
        })),
      },
    });
  }),
);

// ============================================================
// GET /api/lab-approvals - 승인 목록 조회
// ============================================================

router.get(
  '/',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const status = req.query.status as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const page = parseInt(req.query.page as string) || 1;
    const offset = (page - 1) * limit;

    // 권한 체크: APPROVE 권한 없으면 APPROVED만 볼 수 있음
    const canApprove = await hasPermissionAsync(user, 'LAB_APPROVALS', 'APPROVE');
    const where: any = { deletedAt: null };

    if (!canApprove) {
      where.status = 'APPROVED';
    } else if (status) {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      prisma.labApproval.findMany({
        where,
        include: {
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: { uploadDate: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.labApproval.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items: items.map((item) => ({
          id: item.id,
          uploadDate: item.uploadDate,
          patientSummary: item.patientSummary,
          status: item.status,
          approvedBy: item.approvedBy,
          approvedAt: item.approvedAt,
          stampedAt: item.stampedAt,
          version: item.version,
        })),
        total,
        page,
        limit,
      },
    });
  }),
);

// ============================================================
// GET /api/lab-approvals/:id - 상세 조회
// ============================================================

router.get(
  '/:id',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;

    const approval = await prisma.labApproval.findFirst({
      where: { id, deletedAt: null },
      include: {
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (!approval) {
      throw new AppError(404, 'NOT_FOUND', '승인 내역을 찾을 수 없습니다.');
    }

    // 권한 체크
    const canApprove = await hasPermissionAsync(user, 'LAB_APPROVALS', 'APPROVE');
    if (!canApprove && approval.status !== 'APPROVED') {
      throw new AppError(403, 'FORBIDDEN', '승인된 검사결과만 조회할 수 있습니다.');
    }

    // 분석 목록 조회
    const analyses = await prisma.labAnalysis.findMany({
      where: {
        id: { in: approval.analysisIds },
        deletedAt: null,
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        labResults: {
          where: { deletedAt: null },
          select: {
            id: true,
            testName: true,
            analyte: true,
            value: true,
            unit: true,
            refLow: true,
            refHigh: true,
            flag: true,
          },
        },
      },
      orderBy: { patientName: 'asc' },
    });

    res.json({
      success: true,
      data: {
        id: approval.id,
        uploadDate: approval.uploadDate,
        patientSummary: approval.patientSummary,
        aiSummary: approval.aiSummary,
        status: approval.status,
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        stampedAt: approval.stampedAt,
        rejectionNote: approval.rejectionNote,
        version: approval.version,
        analyses: analyses.map((a) => ({
          id: a.id,
          patientName: a.patientName,
          emrPatientId: a.emrPatientId,
          patient: a.patient,
          abnormalCount: a.abnormalCount,
          normalCount: a.normalCount,
          aiComment: a.aiComment,
          labResults: a.labResults.map((r) => ({
            ...r,
            value: Number(r.value),
            refLow: r.refLow ? Number(r.refLow) : null,
            refHigh: r.refHigh ? Number(r.refHigh) : null,
          })),
        })),
      },
    });
  }),
);

// ============================================================
// POST /api/lab-approvals/create-from-date - 날짜로부터 승인 객체 생성
// ============================================================

router.post(
  '/create-from-date',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'WRITE'),
  auditLog('CREATE', 'LabApproval'),
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = req.body;
    if (!date) {
      throw new AppError(400, 'DATE_REQUIRED', '날짜가 필요합니다.');
    }

    const uploadDate = new Date(date);
    uploadDate.setHours(0, 0, 0, 0);

    // 이미 존재하는지 확인
    const existing = await prisma.labApproval.findUnique({
      where: { uploadDate },
    });

    if (existing) {
      throw new AppError(400, 'ALREADY_EXISTS', '해당 날짜의 승인 객체가 이미 존재합니다.');
    }

    // 분석된 결과 조회
    const nextDate = new Date(uploadDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const uploads = await prisma.labUpload.findMany({
      where: {
        uploadedDate: { gte: uploadDate, lt: nextDate },
        status: 'ANALYZED',
        deletedAt: null,
      },
      include: {
        analyses: {
          where: { status: 'ANALYZED', deletedAt: null },
          select: { id: true, abnormalCount: true, patientName: true },
        },
      },
    });

    const analysisIds: string[] = [];
    let totalPatients = 0;
    let abnormalPatients = 0;
    const patientNames = new Set<string>();

    for (const upload of uploads) {
      for (const analysis of upload.analyses) {
        analysisIds.push(analysis.id);
        if (!patientNames.has(analysis.patientName || '')) {
          patientNames.add(analysis.patientName || '');
          totalPatients++;
          if (analysis.abnormalCount > 0) abnormalPatients++;
        }
      }
    }

    if (analysisIds.length === 0) {
      throw new AppError(400, 'NO_ANALYSES', '분석된 검사결과가 없습니다.');
    }

    // AI 요약 생성
    let aiSummary: string | null = null;
    try {
      aiSummary = await generateDateSummary(uploadDate);
    } catch (err: any) {
      console.error('[LabApproval] AI 요약 생성 실패:', err.message);
    }

    const approval = await prisma.labApproval.create({
      data: {
        uploadDate,
        analysisIds,
        patientSummary: {
          totalPatients,
          abnormalPatients,
          normalPatients: totalPatients - abnormalPatients,
          totalFiles: uploads.length,
        },
        aiSummary,
        status: 'PENDING',
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: approval.id,
        uploadDate: approval.uploadDate,
        patientSummary: approval.patientSummary,
        aiSummary: approval.aiSummary,
        status: approval.status,
      },
    });
  }),
);

// ============================================================
// PATCH /api/lab-approvals/:id/approve - 승인 (스탬프)
// ============================================================

const approveSchema = z.object({
  version: z.number(),
});

router.patch(
  '/:id/approve',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'APPROVE'),
  auditLog('APPROVE', 'LabApproval'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = approveSchema.parse(req.body);
    const userId = (req as any).user.id;

    const approval = await prisma.labApproval.findFirst({
      where: { id, deletedAt: null },
    });

    if (!approval) {
      throw new AppError(404, 'NOT_FOUND', '승인 내역을 찾을 수 없습니다.');
    }

    if (approval.status !== 'PENDING') {
      throw new AppError(400, 'INVALID_STATUS', '대기중인 상태만 승인할 수 있습니다.');
    }

    if (approval.version !== body.version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 수정했습니다. 새로고침 후 다시 시도해주세요.');
    }

    const updated = await prisma.labApproval.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        stampedAt: new Date(),
        version: { increment: 1 },
      },
      include: {
        approvedBy: { select: { id: true, name: true } },
      },
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        approvedBy: updated.approvedBy,
        approvedAt: updated.approvedAt,
        stampedAt: updated.stampedAt,
        version: updated.version,
      },
    });
  }),
);

// ============================================================
// PATCH /api/lab-approvals/:id/reject - 반려
// ============================================================

const rejectSchema = z.object({
  version: z.number(),
  rejectionNote: z.string().optional(),
});

router.patch(
  '/:id/reject',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'APPROVE'),
  auditLog('REJECT', 'LabApproval'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = rejectSchema.parse(req.body);
    const userId = (req as any).user.id;

    const approval = await prisma.labApproval.findFirst({
      where: { id, deletedAt: null },
    });

    if (!approval) {
      throw new AppError(404, 'NOT_FOUND', '승인 내역을 찾을 수 없습니다.');
    }

    if (approval.status !== 'PENDING') {
      throw new AppError(400, 'INVALID_STATUS', '대기중인 상태만 반려할 수 있습니다.');
    }

    if (approval.version !== body.version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 수정했습니다.');
    }

    const updated = await prisma.labApproval.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionNote: body.rejectionNote,
        version: { increment: 1 },
      },
    });

    res.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        rejectionNote: updated.rejectionNote,
        version: updated.version,
      },
    });
  }),
);

// ============================================================
// GET /api/lab-approvals/:id/export-pdf - 스탬프 PDF 다운로드
// ============================================================

router.get(
  '/:id/export-pdf',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const approval = await prisma.labApproval.findFirst({
      where: { id, deletedAt: null },
      include: {
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (!approval) {
      throw new AppError(404, 'NOT_FOUND', '승인 내역을 찾을 수 없습니다.');
    }

    if (approval.status !== 'APPROVED') {
      throw new AppError(400, 'NOT_APPROVED', '승인된 검사결과만 PDF로 내보낼 수 있습니다.');
    }

    // 분석 데이터 조회
    const analyses = await prisma.labAnalysis.findMany({
      where: { id: { in: approval.analysisIds }, deletedAt: null },
      include: {
        labResults: { where: { deletedAt: null } },
      },
    });

    // PDF 생성
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([595, 842]); // A4
    let y = 800;
    const lineHeight = 14;
    const margin = 50;

    // 제목
    page.drawText('Lab Results Report', { x: margin, y, font: boldFont, size: 18 });
    y -= 30;

    // 날짜
    const dateStr = new Date(approval.uploadDate).toLocaleDateString('ko-KR');
    page.drawText(`Date: ${dateStr}`, { x: margin, y, font, size: 12 });
    y -= 20;

    // 요약
    const summary = approval.patientSummary as any;
    page.drawText(`Total Patients: ${summary?.totalPatients || 0} | Abnormal: ${summary?.abnormalPatients || 0}`, {
      x: margin, y, font, size: 11,
    });
    y -= 30;

    // 환자별 결과
    for (const analysis of analyses) {
      if (y < 100) {
        page = pdfDoc.addPage([595, 842]);
        y = 800;
      }

      page.drawText(`Patient: ${analysis.patientName || 'Unknown'} (${analysis.emrPatientId || '-'})`, {
        x: margin, y, font: boldFont, size: 11,
      });
      y -= lineHeight;

      for (const result of analysis.labResults) {
        if (y < 50) {
          page = pdfDoc.addPage([595, 842]);
          y = 800;
        }
        const flag = result.flag !== 'NORMAL' ? ` [${result.flag}]` : '';
        page.drawText(`  ${result.analyte}: ${result.value} ${result.unit || ''}${flag}`, {
          x: margin + 10, y, font, size: 9,
          color: result.flag === 'CRITICAL' ? rgb(1, 0, 0) : result.flag !== 'NORMAL' ? rgb(0.8, 0.4, 0) : rgb(0, 0, 0),
        });
        y -= lineHeight;
      }
      y -= 10;
    }

    // 스탬프
    if (approval.stampedAt) {
      const stampY = 100;
      const stampX = 450;

      page.drawCircle({ x: stampX, y: stampY, size: 40, borderColor: rgb(1, 0, 0), borderWidth: 2 });
      page.drawText('APPROVED', { x: stampX - 28, y: stampY + 8, font: boldFont, size: 10, color: rgb(1, 0, 0) });
      page.drawText(new Date(approval.stampedAt).toLocaleDateString('ko-KR'), {
        x: stampX - 22, y: stampY - 5, font, size: 8, color: rgb(1, 0, 0),
      });
      if (approval.approvedBy) {
        page.drawText(approval.approvedBy.name, {
          x: stampX - 15, y: stampY - 18, font, size: 8, color: rgb(1, 0, 0),
        });
      }
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lab-results-${dateStr}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  }),
);

// ============================================================
// GET /api/lab-approvals/:id/export-excel - 엑셀 다운로드
// ============================================================

router.get(
  '/:id/export-excel',
  requireAuth,
  requirePermission('LAB_APPROVALS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const approval = await prisma.labApproval.findFirst({
      where: { id, deletedAt: null },
    });

    if (!approval) {
      throw new AppError(404, 'NOT_FOUND', '승인 내역을 찾을 수 없습니다.');
    }

    if (approval.status !== 'APPROVED') {
      throw new AppError(400, 'NOT_APPROVED', '승인된 검사결과만 엑셀로 내보낼 수 있습니다.');
    }

    const analyses = await prisma.labAnalysis.findMany({
      where: { id: { in: approval.analysisIds }, deletedAt: null },
      include: {
        labResults: { where: { deletedAt: null } },
      },
    });

    // Excel 생성
    const workbook = new ExcelJS.Workbook();

    // Sheet 1: 요약
    const summarySheet = workbook.addWorksheet('요약');
    summarySheet.columns = [
      { header: '항목', key: 'key', width: 20 },
      { header: '값', key: 'value', width: 30 },
    ];

    const summary = approval.patientSummary as any;
    summarySheet.addRow({ key: '검사일', value: new Date(approval.uploadDate).toLocaleDateString('ko-KR') });
    summarySheet.addRow({ key: '총 환자 수', value: summary?.totalPatients || 0 });
    summarySheet.addRow({ key: '이상 환자 수', value: summary?.abnormalPatients || 0 });
    summarySheet.addRow({ key: '승인자', value: approval.approvedById || '-' });
    summarySheet.addRow({ key: '승인일', value: approval.approvedAt?.toLocaleString('ko-KR') || '-' });

    // Sheet 2: 검사결과
    const resultsSheet = workbook.addWorksheet('검사결과');
    resultsSheet.columns = [
      { header: '환자명', key: 'patientName', width: 15 },
      { header: 'EMR ID', key: 'emrId', width: 15 },
      { header: '검사항목', key: 'testName', width: 15 },
      { header: '분석물', key: 'analyte', width: 15 },
      { header: '결과', key: 'value', width: 12 },
      { header: '단위', key: 'unit', width: 10 },
      { header: '참고하한', key: 'refLow', width: 10 },
      { header: '참고상한', key: 'refHigh', width: 10 },
      { header: '판정', key: 'flag', width: 10 },
    ];

    // 헤더 스타일
    resultsSheet.getRow(1).font = { bold: true };
    resultsSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    for (const analysis of analyses) {
      for (const result of analysis.labResults) {
        const row = resultsSheet.addRow({
          patientName: analysis.patientName,
          emrId: analysis.emrPatientId,
          testName: result.testName,
          analyte: result.analyte,
          value: Number(result.value),
          unit: result.unit,
          refLow: result.refLow ? Number(result.refLow) : null,
          refHigh: result.refHigh ? Number(result.refHigh) : null,
          flag: result.flag,
        });

        if (result.flag === 'CRITICAL') {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
        } else if (result.flag !== 'NORMAL') {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0CC' } };
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();

    const dateStr = new Date(approval.uploadDate).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="lab-results-${dateStr}.xlsx"`);
    res.send(buffer);
  }),
);

export default router;
