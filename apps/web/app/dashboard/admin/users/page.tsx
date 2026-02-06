'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../stores/auth';
import { api } from '../../../../lib/api';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Shield,
  UserCheck,
  UserX,
} from 'lucide-react';

/* ─── Interfaces ─── */

interface Department {
  id: string;
  name: string;
  code: string;
}

interface UserDept {
  departmentId: string;
  role: string;
  isPrimary: boolean;
  department?: Department;
}

interface UserDetail {
  id: string;
  loginId: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  departments: UserDept[];
}

/* ─── Constants ─── */

const ROLES = [
  { value: 'SUPER_ADMIN', label: '최고관리자' },
  { value: 'DEPT_ADMIN', label: '부서관리자' },
  { value: 'DOCTOR', label: '의사' },
  { value: 'HEAD_NURSE', label: '수간호사' },
  { value: 'NURSE', label: '간호사' },
  { value: 'STAFF', label: '직원' },
  { value: 'HOMECARE_STAFF', label: '방문간호사' },
  { value: 'VIEWER', label: '뷰어' },
];

/* ─── Main Component ─── */

export default function UserDetailPage() {
  const { accessToken } = useAuthStore();
  const searchParams = useSearchParams();
  const router = useRouter();
  const userId = searchParams.get('id');

  const [user, setUser] = useState<UserDetail | null>(null);
  const [allDepts, setAllDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 편집 폼 상태
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [deptAssignments, setDeptAssignments] = useState<
    { departmentId: string; role: string; isPrimary: boolean }[]
  >([]);

  const fetchData = useCallback(async () => {
    if (!accessToken || !userId) return;
    setLoading(true);
    try {
      const [userRes, deptRes] = await Promise.all([
        api<UserDetail>(`/api/admin/users/${userId}`, { token: accessToken }),
        api<{ items: Department[] }>('/api/admin/departments', { token: accessToken }),
      ]);

      const u = userRes.data!;
      setUser(u);
      setFormName(u.name);
      setFormEmail(u.email || '');
      setFormPhone(u.phone || '');
      setDeptAssignments(
        u.departments.map((d) => ({
          departmentId: d.departmentId || d.department?.id || '',
          role: d.role,
          isPrimary: d.isPrimary,
        })),
      );
      setAllDepts(deptRes.data?.items || []);
    } catch (err: any) {
      setError(err.message || '데이터 로딩에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function addDeptAssignment() {
    setDeptAssignments((prev) => [
      ...prev,
      { departmentId: '', role: 'STAFF', isPrimary: prev.length === 0 },
    ]);
  }

  function removeDeptAssignment(index: number) {
    setDeptAssignments((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // 주 부서가 삭제되었으면 첫 번째를 주 부서로
      if (next.length > 0 && !next.some((d) => d.isPrimary)) {
        next[0].isPrimary = true;
      }
      return next;
    });
  }

  function updateDeptAssignment(
    index: number,
    field: 'departmentId' | 'role' | 'isPrimary',
    value: string | boolean,
  ) {
    setDeptAssignments((prev) =>
      prev.map((item, i) => {
        if (i === index) {
          return { ...item, [field]: value };
        }
        // isPrimary가 설정되면 다른 항목은 해제
        if (field === 'isPrimary' && value === true) {
          return { ...item, isPrimary: false };
        }
        return item;
      }),
    );
  }

  async function handleSave() {
    if (!accessToken || !userId) return;

    // 유효성 검사
    const invalidDepts = deptAssignments.filter((d) => !d.departmentId);
    if (invalidDepts.length > 0) {
      setError('부서를 선택해 주세요.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await api(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: {
          name: formName,
          email: formEmail || undefined,
          phone: formPhone || undefined,
          departments: deptAssignments.filter((d) => d.departmentId),
        },
        token: accessToken,
      });
      setSuccess('저장되었습니다.');
      await fetchData();
    } catch (err: any) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!accessToken || !userId || !user) return;
    try {
      await api(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: { isActive: !user.isActive },
        token: accessToken,
      });
      await fetchData();
    } catch (err: any) {
      setError(err.message || '상태 변경에 실패했습니다.');
    }
  }

  if (!userId) {
    return (
      <div className="text-center py-12 text-slate-500">
        사용자 ID가 지정되지 않았습니다.
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-12 text-slate-400">로딩 중...</div>;
  }

  if (!user) {
    return (
      <div className="text-center py-12 text-slate-500">
        사용자를 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push('/dashboard/admin')}
          className="p-2 rounded-lg hover:bg-slate-100 transition"
        >
          <ArrowLeft size={20} className="text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            {user.name}
            {user.isSuperAdmin && <Shield size={18} className="text-amber-500" />}
          </h1>
          <p className="text-sm text-slate-500 font-mono">{user.loginId}</p>
        </div>
        <button
          onClick={handleToggleActive}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            user.isActive
              ? 'bg-red-50 text-red-600 hover:bg-red-100'
              : 'bg-green-50 text-green-700 hover:bg-green-100'
          }`}
        >
          {user.isActive ? (
            <>
              <UserX size={16} /> 비활성화
            </>
          ) : (
            <>
              <UserCheck size={16} /> 활성화
            </>
          )}
        </button>
      </div>

      {/* 알림 메시지 */}
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

      {/* 기본 정보 */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">기본 정보</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">이름</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">로그인ID</label>
            <input
              type="text"
              value={user.loginId}
              disabled
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">이메일</label>
            <input
              type="email"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="이메일"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">전화번호</label>
            <input
              type="tel"
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="전화번호"
            />
          </div>
        </div>
      </div>

      {/* 부서 배정 */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">부서 배정</h2>
          <button
            onClick={addDeptAssignment}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus size={16} /> 부서 추가
          </button>
        </div>

        {deptAssignments.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            배정된 부서가 없습니다. &quot;부서 추가&quot; 버튼을 눌러 추가하세요.
          </p>
        ) : (
          <div className="space-y-3">
            {deptAssignments.map((da, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  da.isPrimary ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200'
                }`}
              >
                {/* 부서 선택 */}
                <select
                  value={da.departmentId}
                  onChange={(e) => updateDeptAssignment(idx, 'departmentId', e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">-- 부서 선택 --</option>
                  {allDepts.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} ({dept.code})
                    </option>
                  ))}
                </select>

                {/* 역할 선택 */}
                <select
                  value={da.role}
                  onChange={(e) => updateDeptAssignment(idx, 'role', e.target.value)}
                  className="w-36 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>

                {/* 주부서 토글 */}
                <label className="flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap cursor-pointer">
                  <input
                    type="radio"
                    name="primaryDept"
                    checked={da.isPrimary}
                    onChange={() => updateDeptAssignment(idx, 'isPrimary', true)}
                    className="accent-blue-600"
                  />
                  주부서
                </label>

                {/* 삭제 */}
                <button
                  onClick={() => removeDeptAssignment(idx)}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 저장 버튼 */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"
        >
          <Save size={16} />
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
