'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  Settings,
  Users,
  Building2,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UserCheck,
  UserX,
  X,
  Shield,
} from 'lucide-react';

/* ─── Interfaces ─── */

interface UserItem {
  id: string;
  loginId: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  departments: { department: { name: string }; role: string; isPrimary: boolean }[];
}

interface DeptItem {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  memberCount: number;
  permissionCount: number;
}

interface UsersResponse {
  items: UserItem[];
  total: number;
}

/* ─── Constants ─── */

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: '최고관리자',
  DEPT_ADMIN: '부서관리자',
  DOCTOR: '의사',
  HEAD_NURSE: '수간호사',
  NURSE: '간호사',
  STAFF: '직원',
  HOMECARE_STAFF: '방문간호사',
  VIEWER: '뷰어',
};

const LIMIT = 20;

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── Main Component ─── */

export default function AdminPage() {
  const { accessToken } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<'users' | 'departments'>('users');

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">관리자 설정</h1>
        <p className="text-slate-500 mt-1">사용자와 부서를 관리합니다.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-6">
        <button
          onClick={() => setTab('users')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'users'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Users size={16} />
          사용자 관리
        </button>
        <button
          onClick={() => setTab('departments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'departments'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Building2 size={16} />
          부서 관리
        </button>
      </div>

      {/* Tab Content */}
      {tab === 'users' ? (
        <UsersTab accessToken={accessToken} router={router} />
      ) : (
        <DepartmentsTab accessToken={accessToken} router={router} />
      )}
    </div>
  );
}

/* ─── Users Tab ─── */

function UsersTab({ accessToken, router }: { accessToken: string | null; router: ReturnType<typeof useRouter> }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const totalPages = Math.ceil(total / LIMIT);

  const fetchUsers = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      if (search.trim()) params.set('search', search.trim());
      const res = await api<UsersResponse>(`/api/admin/users?${params.toString()}`, {
        token: accessToken,
      });
      setUsers(res.data!.items);
      setTotal(res.data!.total);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleToggleStatus(user: UserItem) {
    if (!accessToken) return;
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { isActive: !user.isActive },
        token: accessToken,
      });
      await fetchUsers();
    } catch (err: any) {
      alert(err.message || '상태 변경에 실패했습니다.');
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      setPage(1);
      fetchUsers();
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="이름 또는 로그인ID 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsers}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
          >
            <RefreshCw size={16} />
            새로고침
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
          >
            <Plus size={16} />
            사용자 추가
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-12">
            <Users size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500">사용자가 없습니다.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-600">이름</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">로그인ID</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">이메일</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">부서/역할</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">상태</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">마지막로그인</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 w-24">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                      <td className="px-4 py-3 text-slate-900 font-medium">
                        <button
                          onClick={() => router.push(`/dashboard/admin/users?id=${user.id}`)}
                          className="flex items-center gap-2 hover:text-blue-600 transition"
                        >
                          {user.name}
                          {user.isSuperAdmin && (
                            <Shield size={14} className="text-amber-500" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{user.loginId}</td>
                      <td className="px-4 py-3 text-slate-600">{user.email || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {user.departments.length === 0 ? (
                            <span className="text-slate-400">-</span>
                          ) : (
                            user.departments.map((d, idx) => (
                              <span
                                key={idx}
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                                  d.isPrimary
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {d.department.name} ({ROLE_LABELS[d.role] || d.role})
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {user.isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                            활성
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                            비활성
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {formatDateTime(user.lastLoginAt)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleStatus(user)}
                          title={user.isActive ? '비활성화' : '활성화'}
                          className={`p-1.5 rounded-lg transition ${
                            user.isActive
                              ? 'text-red-500 hover:bg-red-50'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {user.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <span className="text-sm text-slate-500">
                총 {total.toLocaleString()}명
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-slate-700 min-w-[80px] text-center">
                  {page} / {totalPages || 1}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <AddUserModal
          accessToken={accessToken}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}

/* ─── Add User Modal ─── */

function AddUserModal({
  accessToken,
  onClose,
  onSuccess,
}: {
  accessToken: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    loginId: '',
    name: '',
    password: '',
    email: '',
    phone: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function handleChange(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;

    if (!form.loginId || !form.name || !form.password) {
      setError('로그인ID, 이름, 비밀번호는 필수 항목입니다.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: {
          loginId: form.loginId,
          name: form.name,
          password: form.password,
          email: form.email || undefined,
          phone: form.phone || undefined,
        },
        token: accessToken,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || '사용자 생성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-slate-900">사용자 추가</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              로그인ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.loginId}
              onChange={(e) => handleChange('loginId', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="로그인ID를 입력하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="이름을 입력하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              비밀번호 <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="비밀번호를 입력하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">이메일</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="이메일을 입력하세요"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">전화번호</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="전화번호를 입력하세요"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm transition"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              {submitting ? '생성 중...' : '추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Departments Tab ─── */

function DepartmentsTab({ accessToken, router }: { accessToken: string | null; router: ReturnType<typeof useRouter> }) {
  const [departments, setDepartments] = useState<DeptItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDepartments = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<{ items: DeptItem[] }>('/api/admin/departments', {
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

  return (
    <div>
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
              onClick={() => router.push(`/dashboard/admin/departments?id=${dept.id}`)}
              className={`bg-white rounded-xl border p-5 text-left transition hover:shadow-md hover:border-blue-300 ${
                dept.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{dept.name}</h3>
                  <span className="text-xs font-mono text-slate-400">{dept.code}</span>
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
