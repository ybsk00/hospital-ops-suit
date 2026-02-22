import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { createOAuth2Client, invalidateSheetsClient } from '../services/sheetSync/googleSheets';

const router = Router();

// ─── GET /url ── OAuth 인증 URL 생성 ───
router.get(
  '/url',
  requireAuth,
  requirePermission('SCHEDULING', 'ADMIN'),
  asyncHandler(async (_req: Request, res: Response) => {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new AppError(500, 'CONFIG_MISSING', 'Google OAuth 환경변수(CLIENT_ID/SECRET)가 설정되지 않았습니다');
    }

    const oauth2Client = createOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });

    res.json({ success: true, data: { url } });
  }),
);

// ─── POST /exchange ── auth code → tokens ───
router.post(
  '/exchange',
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.body;
    if (!code) {
      throw new AppError(400, 'INVALID_REQUEST', 'code 파라미터가 필요합니다');
    }

    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new AppError(400, 'NO_REFRESH_TOKEN', 'refresh_token을 받지 못했습니다. Google 계정 설정에서 앱 접근 권한을 해제 후 다시 시도하세요.');
    }

    // Get connected user email
    oauth2Client.setCredentials(tokens);
    let email: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();
      email = data.email || null;
    } catch {
      // email retrieval is optional
    }

    // Upsert config
    await prisma.googleSheetsConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope || null,
        connectedEmail: email,
      },
      update: {
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scope: tokens.scope || null,
        connectedEmail: email,
      },
    });

    invalidateSheetsClient();

    res.json({ success: true, data: { email } });
  }),
);

// ─── GET /status ── 연결 상태 확인 ───
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const config = await prisma.googleSheetsConfig.findUnique({
      where: { id: 'singleton' },
    });

    res.json({
      success: true,
      data: {
        connected: !!config?.refreshToken,
        connectedEmail: config?.connectedEmail || null,
        rfSpreadsheetId: config?.rfSpreadsheetId || env.RF_SPREADSHEET_ID || '',
        manualSpreadsheetId: config?.manualSpreadsheetId || env.MANUAL_SPREADSHEET_ID || '',
        wardSpreadsheetId: config?.wardSpreadsheetId || env.WARD_SPREADSHEET_ID || '',
        outpatientSpreadsheetId: config?.outpatientSpreadsheetId || env.OUTPATIENT_SPREADSHEET_ID || '',
        autoSyncEnabled: config?.autoSyncEnabled ?? true,
        autoSyncIntervalMin: config?.autoSyncIntervalMin ?? 5,
        lastAutoSyncAt: config?.lastAutoSyncAt || null,
        updatedAt: config?.updatedAt || null,
      },
    });
  }),
);

// ─── PATCH /config ── 스프레드시트 ID 등 설정 변경 ───
const configSchema = z.object({
  rfSpreadsheetId: z.string().optional(),
  manualSpreadsheetId: z.string().optional(),
  wardSpreadsheetId: z.string().optional(),
  outpatientSpreadsheetId: z.string().optional(),
  autoSyncEnabled: z.boolean().optional(),
  autoSyncIntervalMin: z.number().min(1).max(60).optional(),
});

router.patch(
  '/config',
  requireAuth,
  requirePermission('SCHEDULING', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = configSchema.parse(req.body);

    const config = await prisma.googleSheetsConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...body },
      update: body,
    });

    res.json({ success: true, data: config });
  }),
);

// ─── DELETE /disconnect ── OAuth 연결 해제 ───
router.delete(
  '/disconnect',
  requireAuth,
  requirePermission('SCHEDULING', 'ADMIN'),
  asyncHandler(async (_req: Request, res: Response) => {
    await prisma.googleSheetsConfig.update({
      where: { id: 'singleton' },
      data: {
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        scope: null,
        connectedEmail: null,
        connectedBy: null,
      },
    }).catch(() => {});

    invalidateSheetsClient();

    res.json({ success: true, data: { message: 'Google 계정 연결이 해제되었습니다.' } });
  }),
);

// ─── POST /test ── 연결 테스트 (시트 탭 이름 조회) ───
router.post(
  '/test',
  requireAuth,
  requirePermission('SCHEDULING', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
      throw new AppError(400, 'INVALID_REQUEST', 'spreadsheetId가 필요합니다');
    }

    const { getSheetMetadata } = await import('../services/sheetSync/googleSheets');
    const tabs = await getSheetMetadata(spreadsheetId);

    res.json({
      success: true,
      data: { tabs, message: `${tabs.length}개 탭 확인됨` },
    });
  }),
);

export default router;
