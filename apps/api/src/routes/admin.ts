import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { hashPassword } from '../utils/crypto';

const router = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const userListQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

const createUserSchema = z.object({
  loginId: z.string().min(3).max(50),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(100),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  departments: z
    .array(
      z.object({
        departmentId: z.string().uuid(),
        role: z.enum([
          'SUPER_ADMIN',
          'DEPT_ADMIN',
          'DOCTOR',
          'HEAD_NURSE',
          'NURSE',
          'STAFF',
          'HOMECARE_STAFF',
          'VIEWER',
        ]),
        isPrimary: z.boolean().default(false),
      }),
    )
    .optional()
    .default([]),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
  departments: z
    .array(
      z.object({
        departmentId: z.string().uuid(),
        role: z.enum([
          'SUPER_ADMIN',
          'DEPT_ADMIN',
          'DOCTOR',
          'HEAD_NURSE',
          'NURSE',
          'STAFF',
          'HOMECARE_STAFF',
          'VIEWER',
        ]),
        isPrimary: z.boolean().default(false),
      }),
    )
    .optional(),
});

const updatePermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      resource: z.enum([
        'BEDS',
        'ADMISSIONS',
        'PROCEDURES',
        'APPOINTMENTS',
        'HOMECARE_VISITS',
        'QUESTIONNAIRES',
        'LAB_RESULTS',
        'AI_REPORTS',
        'INBOX',
        'AUDIT_LOGS',
        'IMPORTS',
        'USERS',
        'DEPARTMENTS',
        'CHATBOT',
        'DASHBOARD',
        'SCHEDULING',
      ]),
      action: z.enum(['READ', 'WRITE', 'DELETE', 'APPROVE', 'EXPORT', 'ADMIN']),
      scope: z.string().optional(),
    }),
  ),
});

// ===========================================================================
// USERS
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/admin/users – 사용자 목록
// ---------------------------------------------------------------------------

router.get(
  '/users',
  requireAuth,
  requirePermission('USERS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = userListQuerySchema.parse(req.query);
    const { search, isActive, page, limit } = query;

    const where: Record<string, unknown> = {
      deletedAt: null,
    };

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { loginId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          loginId: true,
          name: true,
          phone: true,
          email: true,
          isActive: true,
          isSuperAdmin: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          departments: {
            include: {
              department: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id – 사용자 상세
// ---------------------------------------------------------------------------

router.get(
  '/users/:id',
  requireAuth,
  requirePermission('USERS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        loginId: true,
        name: true,
        phone: true,
        email: true,
        isActive: true,
        isSuperAdmin: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
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
      throw new AppError(404, 'NOT_FOUND', '해당 사용자를 찾을 수 없습니다.');
    }

    res.json({ success: true, data: user });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/admin/users – 사용자 생성
// ---------------------------------------------------------------------------

router.post(
  '/users',
  requireAuth,
  requirePermission('USERS', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createUserSchema.parse(req.body);

    // 중복 loginId 확인
    const existing = await prisma.user.findFirst({
      where: { loginId: body.loginId, deletedAt: null },
    });
    if (existing) {
      throw new AppError(409, 'DUPLICATE_LOGIN_ID', '이미 사용 중인 로그인 ID입니다.');
    }

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          loginId: body.loginId,
          passwordHash,
          name: body.name,
          phone: body.phone,
          email: body.email,
          departments: {
            create: body.departments.map((d) => ({
              departmentId: d.departmentId,
              role: d.role,
              isPrimary: d.isPrimary,
            })),
          },
        },
        select: {
          id: true,
          loginId: true,
          name: true,
          phone: true,
          email: true,
          isActive: true,
          createdAt: true,
          departments: {
            include: {
              department: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
      });

      return created;
    });

    res.status(201).json({ success: true, data: user });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id – 사용자 수정
// ---------------------------------------------------------------------------

router.patch(
  '/users/:id',
  requireAuth,
  requirePermission('USERS', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateUserSchema.parse(req.body);

    // 존재 확인
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '해당 사용자를 찾을 수 없습니다.');
    }

    const { departments, ...userData } = body;

    const user = await prisma.$transaction(async (tx) => {
      // 부서 배정 갱신
      if (departments) {
        await tx.userDepartment.deleteMany({ where: { userId: id } });
        await tx.userDepartment.createMany({
          data: departments.map((d) => ({
            userId: id,
            departmentId: d.departmentId,
            role: d.role,
            isPrimary: d.isPrimary,
          })),
        });
      }

      // 사용자 기본 정보 갱신
      const updated = await tx.user.update({
        where: { id },
        data: userData,
        select: {
          id: true,
          loginId: true,
          name: true,
          phone: true,
          email: true,
          isActive: true,
          isSuperAdmin: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          departments: {
            include: {
              department: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
      });

      return updated;
    });

    res.json({ success: true, data: user });
  }),
);

// ===========================================================================
// DEPARTMENTS
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/admin/departments – 부서 목록
// ---------------------------------------------------------------------------

router.get(
  '/departments',
  requireAuth,
  requirePermission('DEPARTMENTS', 'READ'),
  asyncHandler(async (_req: Request, res: Response) => {
    const departments = await prisma.department.findMany({
      where: { deletedAt: null },
      include: {
        _count: {
          select: {
            members: true,
            permissions: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const items = departments.map((dept) => ({
      id: dept.id,
      name: dept.name,
      code: dept.code,
      parentId: dept.parentId,
      isActive: dept.isActive,
      createdAt: dept.createdAt,
      updatedAt: dept.updatedAt,
      memberCount: dept._count.members,
      permissionCount: dept._count.permissions,
    }));

    res.json({ success: true, data: { items } });
  }),
);

// ---------------------------------------------------------------------------
// POST /api/admin/departments – 부서 생성
// ---------------------------------------------------------------------------

const createDepartmentSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
});

router.post(
  '/departments',
  requireAuth,
  requirePermission('DEPARTMENTS', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createDepartmentSchema.parse(req.body);

    const existing = await prisma.department.findFirst({
      where: { code: body.code, deletedAt: null },
    });
    if (existing) {
      throw new AppError(409, 'DUPLICATE', '이미 사용 중인 부서 코드입니다.');
    }

    const department = await prisma.department.create({
      data: {
        name: body.name,
        code: body.code,
      },
    });

    res.status(201).json({ success: true, data: department });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/admin/departments/:id – 부서 수정
// ---------------------------------------------------------------------------

const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
});

router.patch(
  '/departments/:id',
  requireAuth,
  requirePermission('DEPARTMENTS', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateDepartmentSchema.parse(req.body);

    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '해당 부서를 찾을 수 없습니다.');
    }

    if (body.code && body.code !== existing.code) {
      const dup = await prisma.department.findFirst({
        where: { code: body.code, deletedAt: null, id: { not: id } },
      });
      if (dup) {
        throw new AppError(409, 'DUPLICATE', '이미 사용 중인 부서 코드입니다.');
      }
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.code !== undefined && { code: body.code }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    res.json({ success: true, data: updated });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/admin/departments/:id/permissions – 부서 권한 조회
// ---------------------------------------------------------------------------

router.get(
  '/departments/:id/permissions',
  requireAuth,
  requirePermission('DEPARTMENTS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const department = await prisma.department.findUnique({ where: { id } });
    if (!department || department.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '해당 부서를 찾을 수 없습니다.');
    }

    const permissions = await prisma.departmentPermission.findMany({
      where: { departmentId: id },
    });

    res.json({ success: true, data: { departmentId: id, permissions } });
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/admin/departments/:id/permissions – 부서 권한 갱신
// ---------------------------------------------------------------------------

router.patch(
  '/departments/:id/permissions',
  requireAuth,
  requirePermission('DEPARTMENTS', 'ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updatePermissionsSchema.parse(req.body);

    // 부서 존재 확인
    const department = await prisma.department.findUnique({ where: { id } });
    if (!department || department.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '해당 부서를 찾을 수 없습니다.');
    }

    const permissions = await prisma.$transaction(async (tx) => {
      await tx.departmentPermission.deleteMany({ where: { departmentId: id } });

      await tx.departmentPermission.createMany({
        data: body.permissions.map((p) => ({
          departmentId: id,
          resource: p.resource,
          action: p.action,
          scope: p.scope ?? undefined,
        })),
      });

      return tx.departmentPermission.findMany({ where: { departmentId: id } });
    });

    res.json({ success: true, data: { departmentId: id, permissions } });
  }),
);

export default router;
