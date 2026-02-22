import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const env = {
  // Server
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  PORT: parseInt(optionalEnv('PORT', '4000'), 10),
  WS_PORT: parseInt(optionalEnv('WS_PORT', '4001'), 10),
  TZ: optionalEnv('TZ', 'Asia/Seoul'),

  // Database (Supabase)
  DATABASE_URL: requireEnv('DATABASE_URL'),
  DIRECT_URL: optionalEnv('DIRECT_URL', ''),
  SUPABASE_URL: optionalEnv('SUPABASE_URL', ''),
  SUPABASE_ANON_KEY: optionalEnv('SUPABASE_ANON_KEY', ''),
  SUPABASE_SERVICE_ROLE_KEY: optionalEnv('SUPABASE_SERVICE_ROLE_KEY', ''),
  REDIS_URL: optionalEnv('REDIS_URL', 'redis://localhost:6379'),

  // JWT
  JWT_SECRET: requireEnv('JWT_SECRET'),
  JWT_REFRESH_SECRET: requireEnv('JWT_REFRESH_SECRET'),
  JWT_ACCESS_EXPIRES: optionalEnv('JWT_ACCESS_EXPIRES', '4h'),  // 15분 → 4시간
  JWT_REFRESH_EXPIRES: optionalEnv('JWT_REFRESH_EXPIRES', '30d'), // 7일 → 30일
  BCRYPT_ROUNDS: parseInt(optionalEnv('BCRYPT_ROUNDS', '12'), 10),

  // CORS
  CORS_ORIGIN: optionalEnv('CORS_ORIGIN', 'http://localhost:3000'),

  // AI / LLM (Gemini 통일)
  GEMINI_API_KEY: optionalEnv('GEMINI_API_KEY', ''),
  GEMINI_CHAT_MODEL: optionalEnv('GEMINI_CHAT_MODEL', 'gemini-2.5-flash'),  // Phase 7: 챗봇/AI소견서/혈액검사 LLM
  GEMINI_EMBEDDING_MODEL: optionalEnv('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
  YOUTUBE_API_KEY: optionalEnv('YOUTUBE_API_KEY', ''),
  YOUTUBE_CHANNEL_ID: optionalEnv('YOUTUBE_CHANNEL_ID', ''),

  // Sheet Sync
  SHEET_SYNC_API_KEY: optionalEnv('SHEET_SYNC_API_KEY', ''),
  RF_SPREADSHEET_ID: optionalEnv('RF_SPREADSHEET_ID', ''),
  MANUAL_SPREADSHEET_ID: optionalEnv('MANUAL_SPREADSHEET_ID', ''),
  WARD_SPREADSHEET_ID: optionalEnv('WARD_SPREADSHEET_ID', ''),
  OUTPATIENT_SPREADSHEET_ID: optionalEnv('OUTPATIENT_SPREADSHEET_ID', ''),
  GOOGLE_SHEETS_SA_KEY: optionalEnv('GOOGLE_SHEETS_SA_KEY', ''),

  // Google OAuth 2.0 (Sheets 연동)
  GOOGLE_OAUTH_CLIENT_ID: optionalEnv('GOOGLE_OAUTH_CLIENT_ID', ''),
  GOOGLE_OAUTH_CLIENT_SECRET: optionalEnv('GOOGLE_OAUTH_CLIENT_SECRET', ''),
  GOOGLE_OAUTH_REDIRECT_URI: optionalEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3000/api/google/oauth/callback'),

  // File Storage
  FILE_STORAGE_PATH: optionalEnv('FILE_STORAGE_PATH', './storage'),
  FILE_SIGNED_URL_EXPIRES: parseInt(optionalEnv('FILE_SIGNED_URL_EXPIRES', '3600'), 10),
  MAX_FILE_SIZE: parseInt(optionalEnv('MAX_FILE_SIZE', '10485760'), 10),

  // Encryption
  ENCRYPTION_KEY: optionalEnv('ENCRYPTION_KEY', ''),

  // Notification
  ALERT_WEBHOOK_URL: optionalEnv('ALERT_WEBHOOK_URL', ''),
  ESCALATION_DELAY_MINUTES: parseInt(optionalEnv('ESCALATION_DELAY_MINUTES', '15'), 10),

  // Helpers
  get isDev() { return this.NODE_ENV === 'development'; },
  get isProd() { return this.NODE_ENV === 'production'; },
  get isTest() { return this.NODE_ENV === 'test'; },
} as const;
