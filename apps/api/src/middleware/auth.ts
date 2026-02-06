import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { verifyToken } from '../utils/crypto';
import { AppError } from './errorHandler';
import type { AuthUser } from '../types/express';

function extractToken(req: Request): string | null {
  // 1. Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // 2. Cookie
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }
  // 3. Query parameter (for PDF downloads via window.open)
  if (req.query.token && typeof req.query.token === 'string') {
    return req.query.token;
  }
  return null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);

  if (!token) {
    return next(new AppError(401, 'AUTH_REQUIRED', '인증 토큰이 필요합니다.'));
  }

  try {
    const decoded = verifyToken(token, env.JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError(401, 'TOKEN_EXPIRED', '토큰이 만료되었습니다.'));
    }
    return next(new AppError(401, 'INVALID_TOKEN', '유효하지 않은 토큰입니다.'));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = verifyToken(token, env.JWT_SECRET) as AuthUser;
    req.user = decoded;
  } catch {
    // 무시
  }
  next();
}
