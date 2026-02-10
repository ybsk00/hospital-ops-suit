import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission, hasPermissionAsync } from '../middleware/rbac';
import { auditLog } from '../middleware/audit';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { generateDateSummary } from '../services/labAnalysisService';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import path from 'path';
import fs from 'fs';
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
        patient: { select: { id: true, name: true, emrPatientId: true, dob: true, sex: true } },
        labResults: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
    });

    // PDF 생성 - 한글 폰트 지원
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontPath = path.join(__dirname, '../../fonts/NotoSansKR-Regular.ttf');
    let font;
    let boldFont;
    if (fs.existsSync(fontPath)) {
      const fontBytes = fs.readFileSync(fontPath);
      font = await pdfDoc.embedFont(fontBytes);
      boldFont = font;
    } else {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const pageW = 595;
    const pageH = 842;
    const margin = 40;
    const contentW = pageW - margin * 2;
    const black = rgb(0, 0, 0);
    const gray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.85, 0.85, 0.85);
    const headerBg = rgb(0.93, 0.93, 0.93);

    const dateStr = new Date(approval.uploadDate).toISOString().slice(0, 10);
    const approverName = approval.approvedBy?.name || '';
    const approvalDateStr = approval.approvedAt
      ? `${approval.approvedAt.getFullYear()}-${String(approval.approvedAt.getMonth() + 1).padStart(2, '0')}-${String(approval.approvedAt.getDate()).padStart(2, '0')}  ${String(approval.approvedAt.getHours()).padStart(2, '0')}:${String(approval.approvedAt.getMinutes()).padStart(2, '0')}`
      : '';

    // 환자별로 각각 새 페이지에 EONE 스타일 PDF 생성
    for (let ai = 0; ai < analyses.length; ai++) {
      const analysis = analyses[ai];
      const patientName = (analysis.patientName || analysis.patient?.name || '').replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();
      const chartNo = ((analysis.emrPatientId || analysis.patient?.emrPatientId || '') as string).replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();
      // 생년월일 마스킹: YYMM까지 표시, 나머지 xx 처리
      let maskedDob = '';
      if (analysis.patient?.dob) {
        const d = new Date(analysis.patient.dob);
        const yy = String(d.getFullYear() % 100).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        maskedDob = `${yy}${mm}xx-xxxxxxx`;
      }

      // 페이지 수 계산
      const resultsPerFirst = 28;
      const resultsPerNext = 38;
      const totalR = analysis.labResults.length;
      let totalPg = 1;
      if (totalR > resultsPerFirst) totalPg += Math.ceil((totalR - resultsPerFirst) / resultsPerNext);

      let page = pdfDoc.addPage([pageW, pageH]);
      let pgNum = 1;
      let y = pageH - margin;

      // ── 타이틀 ──
      page.drawText('검사결과 보고서', { x: margin, y, size: 16, font: boldFont, color: black });
      const pgText = `${pgNum} of ${totalPg}`;
      page.drawText(pgText, { x: pageW - margin - font.widthOfTextAtSize(pgText, 9), y: y + 2, size: 9, font, color: gray });
      y -= 28;

      // ── 환자정보 테이블 ──
      const infoH = 14;
      const infoRows = 5;
      const tableH = infoRows * infoH;
      const col1W = contentW * 0.36;
      const col2W = contentW * 0.30;
      const tX = margin;

      page.drawRectangle({ x: tX, y: y - tableH, width: contentW, height: tableH, borderColor: black, borderWidth: 0.5 });
      page.drawLine({ start: { x: tX + col1W, y }, end: { x: tX + col1W, y: y - tableH }, thickness: 0.5, color: black });
      page.drawLine({ start: { x: tX + col1W + col2W, y }, end: { x: tX + col1W + col2W, y: y - tableH }, thickness: 0.5, color: black });
      for (let r = 1; r < infoRows; r++) {
        page.drawLine({ start: { x: tX, y: y - r * infoH }, end: { x: tX + contentW, y: y - r * infoH }, thickness: 0.3, color: lightGray });
      }

      const fs8 = 8;
      const labelC = rgb(0.3, 0.3, 0.3);
      const drawCell = (col: number, row: number, label: string, value: string) => {
        const cx = tX + (col === 0 ? 0 : col === 1 ? col1W : col1W + col2W) + 4;
        const ry = y - row * infoH - 10;
        page.drawText(label, { x: cx, y: ry, size: fs8, font, color: labelC });
        page.drawText(value, { x: cx + font.widthOfTextAtSize(label + ' ', fs8), y: ry, size: fs8, font: boldFont, color: black });
      };

      drawCell(0, 0, '병(의)원명', '서울온케어의원');
      drawCell(0, 1, '수진자명', patientName);
      drawCell(0, 2, '생년월일', maskedDob);
      drawCell(0, 3, '차트번호', chartNo);
      drawCell(0, 4, '검체종류', 'S:Serum');
      drawCell(1, 0, '기관기호', '');
      drawCell(1, 1, '진료과/병동', '');
      drawCell(1, 2, '의 사 명', approverName);
      drawCell(1, 3, '접수번호', '');
      drawCell(2, 0, '검체채취일', '');
      drawCell(2, 1, '접수일시', '');
      drawCell(2, 2, '검사일시', dateStr);
      drawCell(2, 3, '보고일시', approvalDateStr);
      drawCell(2, 4, '기    타', '');

      y -= tableH + 12;

      // ── 결과 테이블 ──
      const rColW = [70, 150, 60, 40, 140, 35];
      const rTW = rColW.reduce((a, b) => a + b, 0);
      const rHeaders = ['보험코드', '검사명', '결과', '판정', '참고치', '검체'];
      const rRowH = 15;
      const rHH = 18;
      const minY = 90;

      const drawRH = (pg: typeof page, sy: number) => {
        pg.drawRectangle({ x: margin, y: sy - rHH, width: rTW, height: rHH, color: headerBg });
        pg.drawRectangle({ x: margin, y: sy - rHH, width: rTW, height: rHH, borderColor: black, borderWidth: 0.5 });
        let cx = margin;
        for (let i = 0; i < rHeaders.length; i++) {
          if (i > 0) pg.drawLine({ start: { x: cx, y: sy }, end: { x: cx, y: sy - rHH }, thickness: 0.3, color: black });
          pg.drawText(rHeaders[i], { x: cx + 4, y: sy - rHH + 5, size: 8, font: boldFont, color: black });
          cx += rColW[i];
        }
        return sy - rHH;
      };

      let tY = drawRH(page, y);
      let curPg = page;

      for (const result of analysis.labResults) {
        if (tY - rRowH < minY) {
          curPg.drawLine({ start: { x: margin, y: tY }, end: { x: margin + rTW, y: tY }, thickness: 0.5, color: black });
          curPg = pdfDoc.addPage([pageW, pageH]);
          pgNum++;
          let ny = pageH - margin;
          curPg.drawText('검사결과 보고서 (계속)', { x: margin, y: ny, size: 12, font: boldFont, color: gray });
          const pt = `${pgNum} of ${totalPg}`;
          curPg.drawText(pt, { x: pageW - margin - font.widthOfTextAtSize(pt, 9), y: ny + 2, size: 9, font, color: gray });
          ny -= 25;
          tY = drawRH(curPg, ny);
        }

        const rowY = tY - rRowH;
        const flagColor = result.flag === 'CRITICAL' ? rgb(0.8, 0, 0) : result.flag === 'HIGH' ? rgb(0.9, 0.4, 0) : result.flag === 'LOW' ? rgb(0, 0.4, 0.8) : black;

        if (result.flag !== 'NORMAL') {
          curPg.drawRectangle({ x: margin + 0.5, y: rowY, width: rTW - 1, height: rRowH, color: rgb(1, 0.96, 0.93) });
        }
        curPg.drawLine({ start: { x: margin, y: rowY }, end: { x: margin + rTW, y: rowY }, thickness: 0.2, color: lightGray });

        let cx = margin;
        const tYY = rowY + 4;
        cx += rColW[0]; // 보험코드 빈칸
        const itemName = (result.analyte || result.testName || '').replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();
        curPg.drawText(itemName.length > 22 ? itemName.substring(0, 20) + '..' : itemName, { x: cx + 4, y: tYY, size: 8, font, color: black });
        cx += rColW[1];
        curPg.drawText(result.value != null ? String(result.value) : '-', { x: cx + 4, y: tYY, size: 8, font: boldFont, color: flagColor });
        cx += rColW[2];
        let fText = '';
        if (result.flag === 'HIGH' || result.flag === 'CRITICAL') fText = '\u25B2H';
        else if (result.flag === 'LOW') fText = '\u25BCL';
        if (fText) curPg.drawText(fText, { x: cx + 4, y: tYY, size: 8, font: boldFont, color: flagColor });
        cx += rColW[3];
        const unitS = (result.unit || '').replace(/[\u{1F300}-\u{1FFFF}]/gu, '').trim();
        let refT = '';
        if (result.refLow != null && result.refHigh != null) {
          refT = `${String(result.refLow)} ~ ${String(result.refHigh)}`;
          if (unitS) refT += ` ${unitS}`;
        }
        curPg.drawText(refT.length > 22 ? refT.substring(0, 20) + '..' : refT, { x: cx + 4, y: tYY, size: 8, font, color: black });
        cx += rColW[4];
        curPg.drawText('S', { x: cx + 8, y: tYY, size: 8, font, color: black });

        tY = rowY;
      }

      // 테이블 닫기
      curPg.drawLine({ start: { x: margin, y: tY }, end: { x: margin + rTW, y: tY }, thickness: 0.5, color: black });
      curPg.drawLine({ start: { x: margin, y }, end: { x: margin, y: tY }, thickness: 0.5, color: black });
      curPg.drawLine({ start: { x: margin + rTW, y }, end: { x: margin + rTW, y: tY }, thickness: 0.5, color: black });

      // ── 푸터 ──
      const fY = Math.min(tY - 25, 75);
      curPg.drawLine({ start: { x: margin, y: fY + 16 }, end: { x: margin + contentW, y: fY + 16 }, thickness: 0.5, color: black });
      curPg.drawText('검사자', { x: margin + 4, y: fY + 3, size: 8, font: boldFont, color: black });
      curPg.drawText('보고자', { x: margin + contentW / 2, y: fY + 3, size: 8, font: boldFont, color: black });
      if (approverName) curPg.drawText(approverName, { x: margin + contentW / 2 + 40, y: fY + 3, size: 8, font, color: black });
      curPg.drawLine({ start: { x: margin, y: fY - 2 }, end: { x: margin + contentW, y: fY - 2 }, thickness: 0.5, color: black });

      const barY = fY - 16;
      curPg.drawRectangle({ x: margin, y: barY - 2, width: contentW, height: 14, color: rgb(0.95, 0.95, 0.95) });
      curPg.drawText('서울온케어의원', { x: margin + 4, y: barY + 1, size: 7, font: boldFont, color: black });
      curPg.drawText('TEL 031-000-0000  |  www.seouloncare.com', { x: margin + contentW - 200, y: barY + 1, size: 7, font, color: gray });

      // ── 승인 스탬프 ──
      if (approval.stampedAt) {
        const stS = 55;
        const stX = pageW - margin - stS - 5;
        const stCY = fY + 50;

        curPg.drawCircle({ x: stX + stS / 2, y: stCY, size: stS / 2, borderColor: rgb(0.8, 0.1, 0.1), borderWidth: 2, opacity: 0.7 });
        curPg.drawText('승인', { x: stX + 16, y: stCY + 8, size: 11, font: boldFont, color: rgb(0.8, 0.1, 0.1) });
        const stDate = approval.stampedAt ? `${approval.stampedAt.getFullYear()}-${String(approval.stampedAt.getMonth() + 1).padStart(2, '0')}-${String(approval.stampedAt.getDate()).padStart(2, '0')}` : '';
        curPg.drawText(stDate, { x: stX + 8, y: stCY - 5, size: 7, font, color: rgb(0.8, 0.1, 0.1) });
        if (approverName) curPg.drawText(approverName, { x: stX + 12, y: stCY - 16, size: 8, font: boldFont, color: rgb(0.8, 0.1, 0.1) });
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
