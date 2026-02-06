import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../utils/crypto';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { AppError } from '../middleware/errorHandler';
import { loginLimiter } from '../middleware/rateLimiter';

const router = Router();

// ---------- Validation ----------

const loginSchema = z.object({
  loginId: z.string().min(1),
  password: z.string().min(1),
});

// ---------- POST /api/auth/login ----------

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { loginId, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { loginId, deletedAt: null },
      include: {
        departments: {
          include: { department: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'AUTH_FAILED', '아이디 또는 비밀번호가 올바르지 않습니다.');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, 'AUTH_FAILED', '아이디 또는 비밀번호가 올바르지 않습니다.');
    }

    // Build JWT payload
    const tokenPayload = {
      id: user.id,
      loginId: user.loginId,
      isSuperAdmin: user.isSuperAdmin,
      departments: user.departments.map((ud) => ({
        departmentId: ud.departmentId,
        departmentName: ud.department.name,
        role: ud.role,
        isPrimary: ud.isPrimary,
      })),
    };

    const accessToken = generateToken(tokenPayload, env.JWT_SECRET, env.JWT_ACCESS_EXPIRES);
    const refreshToken = generateToken(
      { id: user.id, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      env.JWT_REFRESH_EXPIRES,
    );

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: env.isProd,
      sameSite: env.isProd ? 'none' : 'lax', // 크로스 도메인 허용
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/api/auth',
    });

    res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          loginId: user.loginId,
          name: user.name,
          isSuperAdmin: user.isSuperAdmin,
          departments: tokenPayload.departments,
        },
      },
    });
  }),
);

// ---------- POST /api/auth/refresh ----------

router.post(
  '/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.cookies?.refreshToken;
    if (!token) {
      throw new AppError(401, 'NO_REFRESH_TOKEN', '세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    let decoded: any;
    try {
      decoded = verifyToken(token, env.JWT_REFRESH_SECRET);
    } catch {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id, deletedAt: null },
      include: {
        departments: {
          include: { department: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'USER_INACTIVE', '비활성화된 계정입니다.');
    }

    const tokenPayload = {
      id: user.id,
      loginId: user.loginId,
      isSuperAdmin: user.isSuperAdmin,
      departments: user.departments.map((ud) => ({
        departmentId: ud.departmentId,
        departmentName: ud.department.name,
        role: ud.role,
        isPrimary: ud.isPrimary,
      })),
    };

    const accessToken = generateToken(tokenPayload, env.JWT_SECRET, env.JWT_ACCESS_EXPIRES);

    res.json({
      success: true,
      data: { accessToken },
    });
  }),
);

// ---------- POST /api/auth/logout ----------

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.json({ success: true });
});

// ---------- GET /api/auth/me ----------

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id, deletedAt: null },
      select: {
        id: true,
        loginId: true,
        name: true,
        phone: true,
        email: true,
        isSuperAdmin: true,
        lastLoginAt: true,
        departments: {
          include: {
            department: {
              include: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    }

    res.json({
      success: true,
      data: user,
    });
  }),
);

export default router;
