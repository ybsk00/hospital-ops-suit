'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  ScrollText,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Filter,
} from 'lucide-react';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: any;
  afterJson: any;
  ip: string | null;
  createdAt: string;
  actor: { name: string } | null;
}

interface AuditResponse {
  items: AuditEntry[];
  total: number;
}

const ENTITY_TYPES = [
  { value: '', label: '전체' },
  { value: 'Bed', label: 'Bed' },
  { value: 'Admission', label: 'Admission' },
  { value: 'Appointment', label: 'Appointment' },
  { value: 'ProcedureExecution', label: 'ProcedureExecution' },
  { value: 'InboxItem', label: 'InboxItem' },
  { value: 'HomecareVisit', label: 'HomecareVisit' },
  { value: 'User', label: 'User' },
];

const LIMIT = 50;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function JsonDiff({ label, data }: { label: string; data: any }) {
  if (!data) {
    return (
      <div className="flex-1">
        <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
        <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-400 font-mono">null</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <pre className="bg-slate-50 rounded-lg p-3 text-xs text-slate-700 font-mono overflow-auto max-h-64 whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditPage() {
  const { accessToken } = useAuthStore();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const totalPages = Math.ceil(total / LIMIT);

  const fetchLogs = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(LIMIT));
      if (entityType) params.set('entityType', entityType);
      if (action.trim()) params.set('action', action.trim());
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const res = await api<AuditResponse>(`/api/audit?${params.toString()}`, {
        token: accessToken,
      });
      setItems(res.data!.items);
      setTotal(res.data!.total);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, entityType, action, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  function handleSearch() {
    setPage(1);
    fetchLogs();
  }

  function handleReset() {
    setEntityType('');
    setAction('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">감사 로그</h1>
          <p className="text-slate-500 mt-1">시스템 활동 기록을 조회합니다.</p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-700">필터</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Entity Type */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">대상 유형</label>
            <select
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Action */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">액션</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="액션 검색..."
                value={action}
                onChange={(e) => setAction(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">시작일</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">종료일</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            onClick={handleReset}
            className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-700 transition"
          >
            초기화
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <ScrollText size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500">감사 로그가 없습니다.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-600 w-10" />
                    <th className="text-left px-4 py-3 font-medium text-slate-600">시간</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">사용자</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">액션</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">대상</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">상세</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry) => {
                    const isExpanded = expandedId === entry.id;
                    return (
                      <Fragment key={entry.id}>
                        <tr
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition"
                        >
                          <td className="px-4 py-3 text-slate-400">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                            {formatDateTime(entry.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {entry.actor?.name || <span className="text-slate-400">시스템</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-medium">
                              {entry.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <span className="text-slate-500">{entry.entityType}</span>
                            <span className="text-slate-300 mx-1">/</span>
                            <span className="font-mono text-xs text-slate-500">{entry.entityId.slice(0, 8)}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {entry.ip && <span>IP: {entry.ip}</span>}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-slate-100">
                            <td colSpan={6} className="px-4 py-4 bg-slate-50/50">
                              <div className="flex gap-4">
                                <JsonDiff label="변경 전 (Before)" data={entry.beforeJson} />
                                <JsonDiff label="변경 후 (After)" data={entry.afterJson} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <span className="text-sm text-slate-500">
                총 {total.toLocaleString()}건 중 {((page - 1) * LIMIT) + 1}-{Math.min(page * LIMIT, total)}건
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
    </div>
  );
}
