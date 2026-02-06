'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../stores/auth';
import { api } from '../../../../lib/api';
import {
  ArrowLeft,
  Building2,
  Save,
  Users,
  Shield,
  Check,
  RefreshCw,
} from 'lucide-react';

/* ─── Interfaces ─── */

interface DeptDetail {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  memberCount: number;
  permissionCount: number;
}

interface Permission {
  resource: string;
  action: string;
  scope?: string;
}

interface DeptPermissionResponse {
  departmentId: string;
  permissions: Permission[];
}

/* ─── Constants ─── */

const RESOURCES = [
  { value: 'BEDS', label: '병상' },
  { value: 'ADMISSIONS', label: '입퇴원' },
  { value: 'PROCEDURES', label: '시술/수술' },
  { value: 'APPOINTMENTS', label: '외래예약' },
  { value: 'HOMECARE_VISITS', label: '방문간호' },
  { value: 'QUESTIONNAIRES', label: '설문' },
  { value: 'LAB_RESULTS', label: '검사결과' },
  { value: 'AI_REPORTS', label: 'AI리포트' },
  { value: 'INBOX', label: '알림함' },
  { value: 'AUDIT_LOGS', label: '감사로그' },
  { value: 'IMPORTS', label: '배치Import' },
  { value: 'USERS', label: '사용자' },
  { value: 'DEPARTMENTS', label: '부서' },
  { value: 'CHATBOT', label: '챗봇' },
  { value: 'DASHBOARD', label: '대시보드' },
];

const ACTIONS = [
  { value: 'READ', label: '읽기' },
  { value: 'WRITE', label: '쓰기' },
  { value: 'DELETE', label: '삭제' },
  { value: 'APPROVE', label: '승인' },
  { value: 'EXPORT', label: '내보내기' },
  { value: 'ADMIN', label: '관리' },
];

/* ─── Main Component: 부서 목록 + 권한 매트릭스 ─── */

export default function DepartmentsPage() {
  const { accessToken } = useAuthStore();
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedDeptId = searchParams.get('id');

  const [departments, setDepartments] = useState<DeptDetail[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDepartments = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<{ items: DeptDetail[] }>('/api/admin/departments', {
        token: accessToken,
      });
      setDepartments(res.data?.items || []);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  // 부서 선택 시 → 권한 매트릭스 뷰
  if (selectedDeptId) {
    const dept = departments.find((d) => d.id === selectedDeptId);
    return (
      <PermissionMatrix
        accessToken={accessToken}
        departmentId={selectedDeptId}
        departmentName={dept?.name || ''}
        onBack={() => router.push('/dashboard/admin/departments')}
        onSaved={fetchDepartments}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push('/dashboard/admin')}
          className="p-2 rounded-lg hover:bg-slate-100 transition"
        >
          <ArrowLeft size={20} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">부서 관리</h1>
          <p className="text-slate-500 text-sm mt-1">
            부서를 선택하여 권한을 설정하세요.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={fetchDepartments}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">로딩 중...</div>
      ) : departments.length === 0 ? (
        <div className="text-center py-12">
          <Building2 size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">부서가 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((dept) => (
            <button
              key={dept.id}
              onClick={() =>
                router.push(`/dashboard/admin/departments?id=${dept.id}`)
              }
              className={`bg-white rounded-xl border p-5 text-left transition hover:shadow-md hover:border-blue-300 ${
                dept.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {dept.name}
                  </h3>
                  <span className="text-xs font-mono text-slate-400">
                    {dept.code}
                  </span>
                </div>
                {dept.isActive ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
                    활성
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                    비활성
                  </span>
                )}
              </div>

              <div className="flex gap-4 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Users size={14} className="text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {dept.memberCount}
                    </div>
                    <div className="text-xs text-slate-500">구성원</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Shield size={14} className="text-amber-600" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {dept.permissionCount}
                    </div>
                    <div className="text-xs text-slate-500">권한</div>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Permission Matrix ─── */

function PermissionMatrix({
  accessToken,
  departmentId,
  departmentName,
  onBack,
  onSaved,
}: {
  accessToken: string | null;
  departmentId: string;
  departmentName: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  // 권한 매트릭스 상태: Set<"RESOURCE:ACTION">
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchPermissions = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<DeptPermissionResponse>(
        `/api/admin/departments/${departmentId}/permissions`,
        { token: accessToken },
      );
      const perms = res.data?.permissions || [];
      const initial = new Set<string>();
      perms.forEach((p) => initial.add(`${p.resource}:${p.action}`));
      setChecked(initial);
    } catch {
      setError('권한 정보를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, departmentId]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  function togglePermission(resource: string, action: string) {
    const key = `${resource}:${action}`;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleRow(resource: string) {
    const allChecked = ACTIONS.every((a) => checked.has(`${resource}:${a.value}`));
    setChecked((prev) => {
      const next = new Set(prev);
      ACTIONS.forEach((a) => {
        const key = `${resource}:${a.value}`;
        if (allChecked) {
          next.delete(key);
        } else {
          next.add(key);
        }
      });
      return next;
    });
  }

  function toggleColumn(action: string) {
    const allChecked = RESOURCES.every((r) => checked.has(`${r.value}:${action}`));
    setChecked((prev) => {
      const next = new Set(prev);
      RESOURCES.forEach((r) => {
        const key = `${r.value}:${action}`;
        if (allChecked) {
          next.delete(key);
        } else {
          next.add(key);
        }
      });
      return next;
    });
  }

  async function handleSave() {
    if (!accessToken) return;
    setSaving(true);
    setError('');
    setSuccess('');

    const permissions: Permission[] = [];
    checked.forEach((key) => {
      const [resource, action] = key.split(':');
      permissions.push({ resource, action });
    });

    try {
      await api(`/api/admin/departments/${departmentId}/permissions`, {
        method: 'PATCH',
        body: { permissions },
        token: accessToken,
      });
      setSuccess('권한이 저장되었습니다.');
      onSaved();
    } catch (err: any) {
      setError(err.message || '권한 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-slate-100 transition"
        >
          <ArrowLeft size={20} className="text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">
            {departmentName} 권한 설정
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            리소스별 액션 권한을 체크하세요. 저장 시 기존 권한은 모두 교체됩니다.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {/* 알림 */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 px-4 py-3 bg-green-50 text-green-700 rounded-lg text-sm">
          {success}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">로딩 중...</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-40 sticky left-0 bg-slate-50 z-10">
                    리소스
                  </th>
                  {ACTIONS.map((action) => (
                    <th
                      key={action.value}
                      className="text-center px-3 py-3 font-medium text-slate-600 min-w-[72px]"
                    >
                      <button
                        onClick={() => toggleColumn(action.value)}
                        className="hover:text-blue-600 transition"
                      >
                        {action.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESOURCES.map((resource, rIdx) => {
                  const allInRow = ACTIONS.every((a) =>
                    checked.has(`${resource.value}:${a.value}`),
                  );
                  return (
                    <tr
                      key={resource.value}
                      className={`border-b border-slate-100 ${
                        rIdx % 2 === 0 ? '' : 'bg-slate-50/50'
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-700 sticky left-0 bg-inherit z-10">
                        <button
                          onClick={() => toggleRow(resource.value)}
                          className={`hover:text-blue-600 transition ${
                            allInRow ? 'text-blue-600' : ''
                          }`}
                        >
                          {resource.label}
                        </button>
                      </td>
                      {ACTIONS.map((action) => {
                        const key = `${resource.value}:${action.value}`;
                        const isChecked = checked.has(key);
                        return (
                          <td key={action.value} className="text-center px-3 py-2.5">
                            <button
                              onClick={() =>
                                togglePermission(resource.value, action.value)
                              }
                              className={`w-7 h-7 rounded-md border-2 inline-flex items-center justify-center transition ${
                                isChecked
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'border-slate-300 hover:border-blue-400'
                              }`}
                            >
                              {isChecked && <Check size={14} strokeWidth={3} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 요약 */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-sm text-slate-500">
            선택된 권한: {checked.size}개 / 전체 {RESOURCES.length * ACTIONS.length}개
          </div>
        </div>
      )}
    </div>
  );
}
