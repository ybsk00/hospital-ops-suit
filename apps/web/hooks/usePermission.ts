'use client';

import { useMemo } from 'react';
import { useAuthStore } from '../stores/auth';
import {
  hasPermission,
  hasAnyPermission,
  hasRole,
  type PermissionResource,
  type PermissionAction,
} from '../lib/permissions';

/**
 * 권한 체크 훅
 *
 * @example
 * const { can, canAny, is } = usePermission();
 * if (can('BEDS', 'WRITE')) { ... }
 * if (canAny([{ resource: 'BEDS', action: 'READ' }, { resource: 'ADMISSIONS', action: 'READ' }])) { ... }
 * if (is('DOCTOR')) { ... }
 */
export function usePermission() {
  const user = useAuthStore((s) => s.user);

  return useMemo(() => ({
    can: (resource: PermissionResource, action: PermissionAction) =>
      hasPermission(user as any, resource, action),

    canAny: (checks: Array<{ resource: PermissionResource; action: PermissionAction }>) =>
      hasAnyPermission(user as any, checks),

    is: (role: string) => hasRole(user as any, role),

    isSuperAdmin: user?.isSuperAdmin ?? false,
  }), [user]);
}
