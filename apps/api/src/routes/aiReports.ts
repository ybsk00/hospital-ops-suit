import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { AiReportStatus } from '@prisma/client';
import { generateAiReport } from '../services/aiReportService';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import ExcelJS from 'exceljs';

const router = Router();

// ============================================================
// GET /api/ai-reports - 소견서 목록 (권한별 필터링)
// ============================================================

router.get(
  '/',
  requireAuth,
  requirePermission('AI_REPORTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, patientId, page: pageRaw, limit: limitRaw } = req.query;

    const page = Math.max(1, parseInt(pageRaw as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    // 권한별 필터링: WRITE 권한 없는 사용자는 승인된 소견서만 조회
    const user = (req as any).user;
    if (!user.isSuperAdmin) {
      const departmentIds = (user.departments || []).map((d: any) => d.departmentId);
      const hasWritePermission = departmentIds.length > 0
        ? await prisma.departmentPermission.findFirst({
            where: {
              departmentId: { in: departmentIds },
              resource: 'AI_REPORTS',
              action: 'WRITE',
            },
          })
        : null;

      if (!hasWritePermission) {
        where.status = { in: ['APPROVED', 'SENT', 'ACKED'] };
      }
    }

    if (status) {
      if (!Object.values(AiReportStatus).includes(status as AiReportStatus)) {
        throw new AppError(400, 'INVALID_STATUS', '유효하지 않은 상태입니다.');
      }
      where.status = status as AiReportStatus;
    }

    if (patientId) {
      where.patientId = patientId as string;
    }

    const [items, total] = await Promise.all([
      prisma.aiReport.findMany({
        where,
        include: {
          patient: { select: { id: true, name: true, emrPatientId: true } },
          visit: {
            select: {
              id: true,
              scheduledAt: true,
              staff: { select: { id: true, name: true } },
            },
          },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.aiReport.count({ where }),
    ]);

    res.json({
      success: true,
      data: { items, total, page, limit },
    });
  }),
);

// ============================================================
// GET /api/ai-reports/:id - 소견서 상세
// ============================================================

router.get(
  '/:id',
  requireAuth,
  requirePermission('AI_REPORTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const report = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: true,
        visit: {
          include: {
            staff: { select: { id: true, name: true } },
            questionnaires: { where: { deletedAt: null }, orderBy: { submittedAt: 'desc' } },
          },
        },
        approvedBy: { select: { id: true, name: true } },
        deliveries: true,
      },
    });

    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    // 환자의 최근 검사결과도 함께 조회
    const labResults = await prisma.labResult.findMany({
      where: { patientId: report.patientId, deletedAt: null },
      orderBy: { collectedAt: 'desc' },
      take: 20,
    });

    res.json({ success: true, data: { ...report, labResults } });
  }),
);

// ============================================================
// POST /api/ai-reports - 소견서 생성 (DRAFT)
// ============================================================

const createReportSchema = z.object({
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
});

router.post(
  '/',
  requireAuth,
  requirePermission('AI_REPORTS', 'WRITE'),
  auditLog('CREATE', 'AiReport'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createReportSchema.parse(req.body);

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, deletedAt: null },
    });
    if (!patient) {
      throw new AppError(404, 'PATIENT_NOT_FOUND', '환자를 찾을 수 없습니다.');
    }

    if (body.visitId) {
      const visit = await prisma.homecareVisit.findFirst({
        where: { id: body.visitId, deletedAt: null },
      });
      if (!visit) {
        throw new AppError(404, 'VISIT_NOT_FOUND', '가정방문 정보를 찾을 수 없습니다.');
      }
    }

    const report = await prisma.aiReport.create({
      data: {
        patientId: body.patientId,
        visitId: body.visitId ?? null,
        status: 'DRAFT',
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    res.locals.auditAfter = report;

    res.status(201).json({ success: true, data: report });
  }),
);

// ============================================================
// POST /api/ai-reports/:id/generate - AI 소견서 자동 생성
// ============================================================

router.post(
  '/:id/generate',
  requireAuth,
  requirePermission('AI_REPORTS', 'WRITE'),
  auditLog('AI_GENERATE', 'AiReport'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    try {
      await generateAiReport(id);

      const updated = await prisma.aiReport.findFirst({
        where: { id },
        include: {
          patient: { select: { id: true, name: true, emrPatientId: true } },
        },
      });

      res.locals.auditAfter = { reportId: id, status: 'AI_REVIEWED' };
      res.json({ success: true, data: updated });
    } catch (err: any) {
      throw new AppError(500, 'AI_GENERATION_FAILED', `AI 소견서 생성 실패: ${err.message}`);
    }
  }),
);

// ============================================================
// PATCH /api/ai-reports/:id - 소견서 수정 (텍스트 편집)
// ============================================================

const updateReportSchema = z.object({
  reviewedText: z.string().max(10000).optional(),
  version: z.number().int(),
});

router.patch(
  '/:id',
  requireAuth,
  requirePermission('AI_REPORTS', 'WRITE'),
  auditLog('UPDATE', 'AiReport'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateReportSchema.parse(req.body);

    const existing = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    if (existing.version !== body.version) {
      throw new AppError(409, 'VERSION_CONFLICT', '다른 사용자가 이미 수정했습니다. 새로고침 후 다시 시도하세요.');
    }

    if (['APPROVED', 'SENT', 'ACKED'].includes(existing.status)) {
      throw new AppError(400, 'ALREADY_APPROVED', '이미 승인된 소견서는 수정할 수 없습니다.');
    }

    res.locals.auditBefore = existing;

    const updated = await prisma.aiReport.update({
      where: { id },
      data: {
        reviewedText: body.reviewedText,
        version: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// PATCH /api/ai-reports/:id/approve - 소견서 승인 (스탬프)
// ============================================================

router.patch(
  '/:id/approve',
  requireAuth,
  requirePermission('AI_REPORTS', 'APPROVE'),
  auditLog('APPROVE', 'AiReport'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { version } = req.body as { version: number };

    const existing = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    if (existing.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT', '버전 충돌이 발생했습니다.');
    }

    if (!['AI_REVIEWED', 'DRAFT'].includes(existing.status)) {
      throw new AppError(400, 'INVALID_STATUS', `현재 상태(${existing.status})에서는 승인할 수 없습니다.`);
    }

    const user = (req as any).user;
    const approvedText = existing.reviewedText || existing.draftText || '';

    res.locals.auditBefore = existing;

    const updated = await prisma.aiReport.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedText,
        approvedById: user.id,
        approvedAt: new Date(),
        stampedAt: new Date(),
        version: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// PATCH /api/ai-reports/:id/reject - 소견서 반려
// ============================================================

router.patch(
  '/:id/reject',
  requireAuth,
  requirePermission('AI_REPORTS', 'APPROVE'),
  auditLog('REJECT', 'AiReport'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { version, rejectionNote } = req.body as { version: number; rejectionNote?: string };

    const existing = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    if (existing.version !== version) {
      throw new AppError(409, 'VERSION_CONFLICT', '버전 충돌이 발생했습니다.');
    }

    res.locals.auditBefore = existing;

    const updated = await prisma.aiReport.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionNote: rejectionNote || null,
        version: { increment: 1 },
      },
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
      },
    });

    res.locals.auditAfter = updated;

    res.json({ success: true, data: updated });
  }),
);

// ============================================================
// DELETE /api/ai-reports/:id - 소프트 삭제
// ============================================================

router.delete(
  '/:id',
  requireAuth,
  requirePermission('AI_REPORTS', 'WRITE'),
  auditLog('DELETE', 'AiReport'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    if (['APPROVED', 'SENT', 'ACKED'].includes(existing.status)) {
      throw new AppError(400, 'CANNOT_DELETE', '승인된 소견서는 삭제할 수 없습니다.');
    }

    res.locals.auditBefore = existing;

    await prisma.aiReport.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true, data: { message: '소견서가 삭제되었습니다.' } });
  }),
);

// ============================================================
// GET /api/ai-reports/:id/export-pdf - 스탬프 PDF 내보내기
// ============================================================

router.get(
  '/:id/export-pdf',
  requireAuth,
  requirePermission('AI_REPORTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const report = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: true,
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    const labResults = await prisma.labResult.findMany({
      where: { patientId: report.patientId, deletedAt: null },
      orderBy: { collectedAt: 'desc' },
      take: 20,
    });

    const displayText = report.approvedText || report.reviewedText || report.draftText || '';

    // PDF 생성
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([595, 842]); // A4
    const { width, height } = page.getSize();
    let y = height - 50;
    const margin = 50;
    const lineHeight = 16;

    // 헤더
    page.drawText('Medical Opinion Report', {
      x: margin, y, size: 18, font: boldFont, color: rgb(0.1, 0.1, 0.1),
    });
    y -= 30;

    // 환자정보
    const patientLines = [
      `Patient: ${report.patient.name} (EMR: ${report.patient.emrPatientId})`,
      `DOB: ${report.patient.dob ? new Date(report.patient.dob).toLocaleDateString('ko-KR') : 'N/A'} | Sex: ${report.patient.sex}`,
      `Status: ${report.status} | Created: ${new Date(report.createdAt).toLocaleDateString('ko-KR')}`,
    ];

    for (const line of patientLines) {
      page.drawText(line, { x: margin, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      y -= lineHeight;
    }
    y -= 10;

    // 구분선
    page.drawLine({
      start: { x: margin, y }, end: { x: width - margin, y },
      thickness: 1, color: rgb(0.8, 0.8, 0.8),
    });
    y -= 20;

    // 소견서 본문 (줄바꿈 처리)
    const contentLines = displayText.split('\n');
    for (const line of contentLines) {
      // 긴 줄 자동 줄바꿈 (약 80자)
      const chunks = [];
      let remaining = line;
      while (remaining.length > 80) {
        chunks.push(remaining.slice(0, 80));
        remaining = remaining.slice(80);
      }
      chunks.push(remaining);

      for (const chunk of chunks) {
        if (y < 80) {
          page = pdfDoc.addPage([595, 842]);
          y = height - 50;
        }
        page.drawText(chunk || ' ', { x: margin, y, size: 9, font, color: rgb(0.15, 0.15, 0.15) });
        y -= lineHeight;
      }
    }

    // 검사결과 테이블
    if (labResults.length > 0) {
      y -= 20;
      if (y < 200) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
      }

      page.drawText('Lab Results', { x: margin, y, size: 12, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
      y -= 20;

      // 헤더행
      const cols = [margin, margin + 120, margin + 220, margin + 290, margin + 340, margin + 410];
      const headers = ['Test', 'Analyte', 'Value', 'Unit', 'Ref Range', 'Flag'];
      headers.forEach((h, i) => {
        page.drawText(h, { x: cols[i], y, size: 8, font: boldFont, color: rgb(0.4, 0.4, 0.4) });
      });
      y -= 14;

      for (const lab of labResults) {
        if (y < 60) {
          page = pdfDoc.addPage([595, 842]);
          y = height - 50;
        }
        const vals = [
          lab.testName.slice(0, 18),
          lab.analyte.slice(0, 15),
          String(lab.value),
          lab.unit || '-',
          lab.refLow != null && lab.refHigh != null ? `${lab.refLow}-${lab.refHigh}` : '-',
          lab.flag,
        ];
        const flagColor = lab.flag === 'HIGH' || lab.flag === 'LOW' ? rgb(0.8, 0.1, 0.1) : rgb(0.3, 0.3, 0.3);
        vals.forEach((v, i) => {
          page.drawText(v, {
            x: cols[i], y, size: 8, font,
            color: i === 5 ? flagColor : rgb(0.3, 0.3, 0.3),
          });
        });
        y -= 13;
      }
    }

    // 스탬프 (승인된 소견서만)
    if (report.stampedAt && report.approvedBy) {
      const stampSize = 80;
      const stampX = width - margin - stampSize - 10;
      const stampY = 60;

      // 빨간 원
      page.drawCircle({
        x: stampX + stampSize / 2,
        y: stampY + stampSize / 2,
        size: stampSize / 2,
        borderColor: rgb(0.85, 0.1, 0.1),
        borderWidth: 2,
        opacity: 0.8,
      });

      // APPROVED 텍스트
      page.drawText('APPROVED', {
        x: stampX + 10, y: stampY + stampSize / 2 + 10,
        size: 10, font: boldFont, color: rgb(0.85, 0.1, 0.1),
      });

      // 날짜
      const stampDate = new Date(report.stampedAt).toLocaleDateString('ko-KR');
      page.drawText(stampDate, {
        x: stampX + 12, y: stampY + stampSize / 2 - 5,
        size: 8, font, color: rgb(0.85, 0.1, 0.1),
      });

      // 승인자
      page.drawText(report.approvedBy.name, {
        x: stampX + 18, y: stampY + stampSize / 2 - 18,
        size: 9, font: boldFont, color: rgb(0.85, 0.1, 0.1),
      });
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report-${report.id.slice(0, 8)}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  }),
);

// ============================================================
// GET /api/ai-reports/:id/export-excel - 엑셀 내보내기
// ============================================================

router.get(
  '/:id/export-excel',
  requireAuth,
  requirePermission('AI_REPORTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const report = await prisma.aiReport.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: true,
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (!report) {
      throw new AppError(404, 'NOT_FOUND', '소견서를 찾을 수 없습니다.');
    }

    const labResults = await prisma.labResult.findMany({
      where: { patientId: report.patientId, deletedAt: null },
      orderBy: { collectedAt: 'desc' },
      take: 50,
    });

    const displayText = report.approvedText || report.reviewedText || report.draftText || '';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Seoul OnCare';
    workbook.created = new Date();

    // 소견서 시트
    const reportSheet = workbook.addWorksheet('소견서');
    reportSheet.columns = [
      { header: '항목', key: 'field', width: 20 },
      { header: '내용', key: 'value', width: 60 },
    ];

    reportSheet.addRow({ field: '환자명', value: report.patient.name });
    reportSheet.addRow({ field: 'EMR ID', value: report.patient.emrPatientId });
    reportSheet.addRow({ field: '생년월일', value: report.patient.dob ? new Date(report.patient.dob).toLocaleDateString('ko-KR') : '' });
    reportSheet.addRow({ field: '성별', value: report.patient.sex === 'M' ? '남성' : '여성' });
    reportSheet.addRow({ field: '상태', value: report.status });
    reportSheet.addRow({ field: '생성일', value: new Date(report.createdAt).toLocaleString('ko-KR') });
    if (report.approvedBy) {
      reportSheet.addRow({ field: '승인자', value: report.approvedBy.name });
      reportSheet.addRow({ field: '승인일', value: report.approvedAt ? new Date(report.approvedAt).toLocaleString('ko-KR') : '' });
    }
    if (report.stampedAt) {
      reportSheet.addRow({ field: '스탬프일', value: new Date(report.stampedAt).toLocaleString('ko-KR') });
    }
    reportSheet.addRow({ field: '', value: '' });
    reportSheet.addRow({ field: '소견서 내용', value: '' });

    // 소견서 본문을 줄별로 추가
    const textLines = displayText.split('\n');
    for (const line of textLines) {
      reportSheet.addRow({ field: '', value: line });
    }

    // 헤더 스타일
    const headerRow = reportSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };

    // 검사결과 시트
    if (labResults.length > 0) {
      const labSheet = workbook.addWorksheet('검사결과');
      labSheet.columns = [
        { header: '채취일', key: 'collectedAt', width: 15 },
        { header: '검사항목', key: 'testName', width: 20 },
        { header: '분석물', key: 'analyte', width: 15 },
        { header: '수치', key: 'value', width: 12 },
        { header: '단위', key: 'unit', width: 10 },
        { header: '참고하한', key: 'refLow', width: 10 },
        { header: '참고상한', key: 'refHigh', width: 10 },
        { header: '판정', key: 'flag', width: 10 },
        { header: '판정사유', key: 'flagReason', width: 30 },
      ];

      for (const lab of labResults) {
        labSheet.addRow({
          collectedAt: new Date(lab.collectedAt).toLocaleDateString('ko-KR'),
          testName: lab.testName,
          analyte: lab.analyte,
          value: Number(lab.value),
          unit: lab.unit || '',
          refLow: lab.refLow != null ? Number(lab.refLow) : '',
          refHigh: lab.refHigh != null ? Number(lab.refHigh) : '',
          flag: lab.flag,
          flagReason: lab.flagReason || '',
        });
      }

      const labHeaderRow = labSheet.getRow(1);
      labHeaderRow.font = { bold: true };
      labHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };

      // 이상 수치 행 강조
      labSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const flagCell = row.getCell('flag');
        if (flagCell.value === 'HIGH' || flagCell.value === 'LOW') {
          row.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
          });
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="report-${report.id.slice(0, 8)}.xlsx"`);
    res.send(Buffer.from(buffer as ArrayBuffer));
  }),
);

export default router;
