/**
 * 프론트엔드 권한 체크 유틸리티
 * 서버 RBAC(DepartmentPermission)와 동일한 로직
 */

export type PermissionResource =
  | 'BEDS' | 'ADMISSIONS' | 'PROCEDURES' | 'APPOINTMENTS'
  | 'HOMECARE_VISITS' | 'QUESTIONNAIRES' | 'LAB_RESULTS' | 'AI_REPORTS'
  | 'INBOX' | 'AUDIT_LOGS' | 'IMPORTS' | 'USERS'
  | 'DEPARTMENTS' | 'CHATBOT' | 'DASHBOARD';

export type PermissionAction = 'READ' | 'WRITE' | 'DELETE' | 'APPROVE' | 'EXPORT' | 'ADMIN';

export interface UserDepartment {
  departmentId: string;
  departmentName: string;
  role: string;
  isPrimary: boolean;
  permissions?: Array<{
    resource: PermissionResource;
    action: PermissionAction;
    scope: string;
  }>;
}

export interface AuthUser {
  id: string;
  loginId: string;
  name: string;
  isSuperAdmin: boolean;
  departments: UserDepartment[];
}

/**
 * 사용자가 특정 리소스+액션 권한을 가지고 있는지 확인
 * - superAdmin은 모든 권한 보유
 * - 부서별 권한을 확인 (하나라도 있으면 true)
 */
export function hasPermission(
  user: AuthUser | null,
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  return user.departments.some((dept) =>
    dept.permissions?.some(
      (p) => p.resource === resource && p.action === action,
    ),
  );
}

/**
 * 사용자가 여러 권한 중 하나라도 가지고 있는지 확인
 */
export function hasAnyPermission(
  user: AuthUser | null,
  checks: Array<{ resource: PermissionResource; action: PermissionAction }>,
): boolean {
  return checks.some((c) => hasPermission(user, c.resource, c.action));
}

/**
 * 사용자가 특정 역할인지 확인
 */
export function hasRole(user: AuthUser | null, role: string): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.departments.some((d) => d.role === role);
}
