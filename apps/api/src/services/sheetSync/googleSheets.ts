import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';

// ─── Cached OAuth client ───
let cachedSheetsClient: sheets_v4.Sheets | null = null;
let cachedExpiry: number = 0;

/**
 * Create a raw OAuth2Client instance (for auth URL generation, token exchange).
 */
export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

/**
 * Get authenticated Google Sheets client.
 * Priority: 1) OAuth tokens from DB  2) Service Account from env
 */
async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  // Return cached client if token is still valid (with 60s buffer)
  if (cachedSheetsClient && Date.now() < cachedExpiry - 60_000) {
    return cachedSheetsClient;
  }

  // 1) Try OAuth from DB
  const config = await prisma.googleSheetsConfig.findUnique({
    where: { id: 'singleton' },
  });

  if (config?.refreshToken) {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
      access_token: config.accessToken || undefined,
      expiry_date: config.tokenExpiresAt?.getTime() || 0,
    });

    // Refresh if expired or about to expire
    const needsRefresh = !config.accessToken
      || !config.tokenExpiresAt
      || config.tokenExpiresAt.getTime() < Date.now() + 60_000;

    if (needsRefresh) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);

        // Persist new tokens
        await prisma.googleSheetsConfig.update({
          where: { id: 'singleton' },
          data: {
            accessToken: credentials.access_token || undefined,
            tokenExpiresAt: credentials.expiry_date
              ? new Date(credentials.expiry_date)
              : undefined,
          },
        });

        cachedExpiry = credentials.expiry_date || Date.now() + 3_600_000;
      } catch (err: any) {
        console.error('[GoogleSheets] OAuth 토큰 갱신 실패:', err.message);
        throw new Error('Google OAuth 토큰 갱신 실패. 관리자 페이지에서 재연결하세요.');
      }
    } else {
      cachedExpiry = config.tokenExpiresAt!.getTime();
    }

    cachedSheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });
    return cachedSheetsClient;
  }

  // 2) Fallback: Service Account from env
  if (env.GOOGLE_SHEETS_SA_KEY) {
    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(env.GOOGLE_SHEETS_SA_KEY);
    } catch {
      throw new Error('[GoogleSheets] GOOGLE_SHEETS_SA_KEY JSON 파싱 실패');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    cachedSheetsClient = google.sheets({ version: 'v4', auth });
    cachedExpiry = Date.now() + 3_600_000; // SA tokens auto-refresh
    return cachedSheetsClient;
  }

  throw new Error('[GoogleSheets] 미설정: 관리자 페이지에서 Google 계정을 연결하세요');
}

/**
 * Invalidate cached client (call after disconnect).
 */
export function invalidateSheetsClient(): void {
  cachedSheetsClient = null;
  cachedExpiry = 0;
}

// ─── Sheets API functions ───

export async function readSheet(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return (response.data.values as string[][]) || [];
}

export async function readFullTab(
  spreadsheetId: string,
  tabName: string,
): Promise<string[][]> {
  return readSheet(spreadsheetId, tabName);
}

export async function writeCell(
  spreadsheetId: string,
  range: string,
  value: string,
): Promise<void> {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

export async function writeCellsBatch(
  spreadsheetId: string,
  cells: { range: string; value: string }[],
): Promise<void> {
  if (cells.length === 0) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: cells.map(c => ({ range: c.range, values: [[c.value]] })),
    },
  });
}

export async function setCellNote(
  spreadsheetId: string,
  sheetId: number,
  rowIndex: number,
  columnIndex: number,
  note: string,
): Promise<void> {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateCells: {
          rows: [{ values: [{ note }] }],
          fields: 'note',
          start: { sheetId, rowIndex, columnIndex },
        },
      }],
    },
  });
}

export async function getSheetMetadata(
  spreadsheetId: string,
): Promise<{ sheetId: number; title: string }[]> {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.sheetId,sheets.properties.title',
  });
  return (response.data.sheets || []).map(s => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title ?? '',
  }));
}

// ─── Configuration helpers ───

/**
 * Check if Google Sheets integration is configured (OAuth or SA).
 */
export async function isGoogleSheetsConfigured(): Promise<boolean> {
  const config = await prisma.googleSheetsConfig.findUnique({
    where: { id: 'singleton' },
    select: { refreshToken: true },
  });
  if (config?.refreshToken) return true;
  return !!env.GOOGLE_SHEETS_SA_KEY;
}

/**
 * Get spreadsheet ID (from DB config, then env fallback).
 */
export async function getSpreadsheetId(type: 'rf' | 'manual' | 'ward' | 'outpatient'): Promise<string> {
  const config = await prisma.googleSheetsConfig.findUnique({
    where: { id: 'singleton' },
    select: { rfSpreadsheetId: true, manualSpreadsheetId: true, wardSpreadsheetId: true, outpatientSpreadsheetId: true },
  });

  if (type === 'rf') return config?.rfSpreadsheetId || env.RF_SPREADSHEET_ID || '';
  if (type === 'manual') return config?.manualSpreadsheetId || env.MANUAL_SPREADSHEET_ID || '';
  if (type === 'ward') return config?.wardSpreadsheetId || env.WARD_SPREADSHEET_ID || '';
  if (type === 'outpatient') return config?.outpatientSpreadsheetId || env.OUTPATIENT_SPREADSHEET_ID || '';
  return '';
}
