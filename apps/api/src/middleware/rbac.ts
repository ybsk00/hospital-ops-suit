import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from './errorHandler';
import type { PermissionResource, PermissionAction } from '@prisma/client';

/**
 * 사용자가 특정 권한을 가지고 있는지 비동기로 체크 (DB 조회)
 */
export async function hasPermissionAsync(
  user: any,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<boolean> {
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const departmentIds = user.departments?.map((d: any) => d.departmentId) || [];
  if (departmentIds.length === 0) return false;

  const permission = await prisma.departmentPermission.findFirst({
    where: {
      departmentId: { in: departmentIds },
      resource,
      action,
    },
  });

  return !!permission;
}

/**
 * 동기 버전 (SuperAdmin 체크만 가능)
 */
export function hasPermission(
  user: any,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  if (!user) return false;
  return user.isSuperAdmin === true;
}

export function requirePermission(resource: PermissionResource, action: PermissionAction) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return next(new AppError(401, 'AUTH_REQUIRED', '인증이 필요합니다.'));
    }

    if (user.isSuperAdmin) {
      return next();
    }

    const departmentIds = user.departments.map((d) => d.departmentId);

    if (departmentIds.length === 0) {
      return next(new AppError(403, 'FORBIDDEN', '소속 부서가 없어 접근이 거부되었습니다.'));
    }

    try {
      const permission = await prisma.departmentPermission.findFirst({
        where: {
          departmentId: { in: departmentIds },
          resource,
          action,
        },
      });

      if (!permission) {
        return next(
          new AppError(403, 'FORBIDDEN', `해당 리소스(${resource})에 대한 ${action} 권한이 없습니다.`),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
