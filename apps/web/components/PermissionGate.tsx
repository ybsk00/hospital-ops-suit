'use client';

import { type ReactNode } from 'react';
import { usePermission } from '../hooks/usePermission';
import type { PermissionResource, PermissionAction } from '../lib/permissions';

interface PermissionGateProps {
  /** 필요한 리소스 */
  resource: PermissionResource;
  /** 필요한 액션 */
  action: PermissionAction;
  /** 권한이 있을 때 렌더링할 내용 */
  children: ReactNode;
  /** 권한이 없을 때 렌더링할 내용 (기본: null) */
  fallback?: ReactNode;
}

/**
 * 권한 기반 조건부 렌더링 컴포넌트
 *
 * @example
 * <PermissionGate resource="BEDS" action="WRITE">
 *   <button>베드 상태 변경</button>
 * </PermissionGate>
 *
 * <PermissionGate resource="ADMISSIONS" action="APPROVE" fallback={<span>권한 없음</span>}>
 *   <button>승인</button>
 * </PermissionGate>
 */
export default function PermissionGate({
  resource,
  action,
  children,
  fallback = null,
}: PermissionGateProps) {
  const { can } = usePermission();

  if (!can(resource, action)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
