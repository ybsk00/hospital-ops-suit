'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  FileDown,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Filter,
  AlertTriangle,
  GitMerge,
  CheckCircle2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ImportItem {
  id: string;
  filePath: string;
  fileHash: string;
  fileType: string;
  status: string;
  statsJson: any;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  _count: { errors: number; conflicts: number };
}

interface ImportError {
  id: string;
  errorCode: string;
  message: string;
  sheetName: string | null;
  rowNumber: number | null;
  createdAt: string;
}

interface ImportConflict {
  id: string;
  emrPatientId: string;
  beforeJson: any;
  afterJson: any;
  status: string;
  detectedAt: string;
  resolvedBy: { name: string } | null;
}

interface ImportDetail extends ImportItem {
  errors: ImportError[];
  conflicts: ImportConflict[];
}

interface ImportListResponse {
  items: ImportItem[];
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LIMIT = 20;

const STATUS_LABELS: Record<string, string> = {
  PENDING: '대기',
  PROCESSING: '처리중',
  SUCCESS: '성공',
  FAIL: '실패',
  QUARANTINED: '격리',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  PROCESSING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-green-100 text-green-700',
  FAIL: 'bg-red-100 text-red-700',
  QUARANTINED: 'bg-yellow-100 text-yellow-700',
};

const FILE_TYPE_LABELS: Record<string, string> = {
  INPATIENT: '입원',
  OUTPATIENT: '외래',
  LAB: '검사',
};

const FILE_TYPE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'INPATIENT', label: '입원' },
  { value: 'OUTPATIENT', label: '외래' },
  { value: 'LAB', label: '검사' },
];

const STATUS_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'PENDING', label: '대기' },
  { value: 'PROCESSING', label: '처리중' },
  { value: 'SUCCESS', label: '성공' },
  { value: 'FAIL', label: '실패' },
  { value: 'QUARANTINED', label: '격리' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function ImportsPage() {
  const { accessToken } = useAuthStore();

  // List state
  const [items, setItems] = useState<ImportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [fileType, setFileType] = useState('');
  const [status, setStatus] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const totalPages = Math.ceil(total / LIMIT);

  /* ---------- Fetch list ------------------------------------------ */

  const fetchList = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      if (fileType) params.set('fileType', fileType);
      if (status) params.set('status', status);

      const res = await api<ImportListResponse>(`/api/imports?${params.toString()}`, {
        token: accessToken,
      });
      setItems(res.data!.items);
      setTotal(res.data!.total);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, fileType, status]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  /* ---------- Fetch detail ---------------------------------------- */

  const fetchDetail = useCallback(
    async (id: string) => {
      if (!accessToken) return;
      setDetailLoading(true);
      setDetail(null);
      try {
        const res = await api<ImportDetail>(`/api/imports/${id}`, {
          token: accessToken,
        });
        setDetail(res.data!);
      } catch {
        // handle error silently
      } finally {
        setDetailLoading(false);
      }
    },
    [accessToken],
  );

  function handleToggleRow(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
    } else {
      setExpandedId(id);
      fetchDetail(id);
    }
  }

  /* ---------- Resolve conflict ------------------------------------ */

  async function handleResolveConflict(conflictId: string) {
    if (!accessToken) return;
    try {
      await api(`/api/imports/conflicts/${conflictId}/resolve`, {
        method: 'PATCH',
        body: { resolution: 'ACCEPT_NEW' },
        token: accessToken,
      });
      // Refresh the detail so the conflict status updates
      if (expandedId) {
        fetchDetail(expandedId);
      }
    } catch {
      // handle error silently
    }
  }

  /* ---------- Render ---------------------------------------------- */

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">배치 관리</h1>
          <p className="text-slate-500 mt-1">EMR 데이터 가져오기를 관리합니다.</p>
        </div>
        <button
          onClick={fetchList}
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
        <div className="flex items-center gap-3 flex-wrap">
          {/* FileType */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">파일타입</label>
            <select
              value={fileType}
              onChange={(e) => { setFileType(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {FILE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">상태</label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <FileDown size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500">배치 데이터가 없습니다.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-600 w-10" />
                    <th className="text-left px-4 py-3 font-medium text-slate-600">파일경로</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">파일타입</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">상태</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">오류수</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">충돌수</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">생성일</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isExpanded = expandedId === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr
                          onClick={() => handleToggleRow(item.id)}
                          className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition"
                        >
                          <td className="px-4 py-3 text-slate-400">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </td>
                          <td className="px-4 py-3 text-slate-700 font-mono text-xs max-w-xs truncate">
                            {item.filePath}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {FILE_TYPE_LABELS[item.fileType] || item.fileType}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || ''}`}
                            >
                              {STATUS_LABELS[item.status] || item.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {item._count.errors > 0 ? (
                              <span className="text-red-600 font-medium">{item._count.errors}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {item._count.conflicts > 0 ? (
                              <span className="text-yellow-600 font-medium">{item._count.conflicts}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                            {formatDateTime(item.createdAt)}
                          </td>
                        </tr>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <tr className="border-b border-slate-100">
                            <td colSpan={7} className="px-4 py-4 bg-slate-50/50">
                              {detailLoading ? (
                                <div className="text-center py-4 text-slate-400 text-sm">상세 정보 로딩 중...</div>
                              ) : detail ? (
                                <div className="space-y-4">
                                  {/* Errors Section */}
                                  <div>
                                    <div className="flex items-center gap-2 mb-2">
                                      <AlertTriangle size={14} className="text-red-500" />
                                      <span className="text-sm font-medium text-slate-700">
                                        오류 목록 ({detail.errors.length}건)
                                      </span>
                                    </div>
                                    {detail.errors.length === 0 ? (
                                      <p className="text-xs text-slate-400 ml-5">오류가 없습니다.</p>
                                    ) : (
                                      <div className="ml-5 overflow-x-auto">
                                        <table className="w-full text-xs">
                                          <thead>
                                            <tr className="bg-red-50 border-b border-red-100">
                                              <th className="text-left px-3 py-2 font-medium text-red-700">오류코드</th>
                                              <th className="text-left px-3 py-2 font-medium text-red-700">메시지</th>
                                              <th className="text-left px-3 py-2 font-medium text-red-700">시트명</th>
                                              <th className="text-left px-3 py-2 font-medium text-red-700">행번호</th>
                                              <th className="text-left px-3 py-2 font-medium text-red-700">생성일</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {detail.errors.map((err) => (
                                              <tr key={err.id} className="border-b border-red-50">
                                                <td className="px-3 py-2 font-mono text-red-600">{err.errorCode}</td>
                                                <td className="px-3 py-2 text-slate-700">{err.message}</td>
                                                <td className="px-3 py-2 text-slate-500">{err.sheetName || '-'}</td>
                                                <td className="px-3 py-2 text-slate-500">{err.rowNumber ?? '-'}</td>
                                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                                                  {formatDateTime(err.createdAt)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>

                                  {/* Conflicts Section */}
                                  <div>
                                    <div className="flex items-center gap-2 mb-2">
                                      <GitMerge size={14} className="text-yellow-500" />
                                      <span className="text-sm font-medium text-slate-700">
                                        충돌 목록 ({detail.conflicts.length}건)
                                      </span>
                                    </div>
                                    {detail.conflicts.length === 0 ? (
                                      <p className="text-xs text-slate-400 ml-5">충돌이 없습니다.</p>
                                    ) : (
                                      <div className="ml-5 space-y-3">
                                        {detail.conflicts.map((conflict) => (
                                          <div
                                            key={conflict.id}
                                            className="border border-yellow-200 rounded-lg p-3 bg-yellow-50/50"
                                          >
                                            <div className="flex items-center justify-between mb-2">
                                              <div className="flex items-center gap-3 text-xs">
                                                <span className="font-medium text-slate-700">
                                                  EMR ID: <span className="font-mono">{conflict.emrPatientId}</span>
                                                </span>
                                                <span className="text-slate-400">|</span>
                                                <span className="text-slate-500">
                                                  상태:{' '}
                                                  <span className="font-medium">
                                                    {conflict.status === 'RESOLVED' ? '처리완료' : '미처리'}
                                                  </span>
                                                </span>
                                                <span className="text-slate-400">|</span>
                                                <span className="text-slate-500">
                                                  감지일: {formatDateTime(conflict.detectedAt)}
                                                </span>
                                                {conflict.resolvedBy && (
                                                  <>
                                                    <span className="text-slate-400">|</span>
                                                    <span className="text-slate-500">
                                                      처리자: {conflict.resolvedBy.name}
                                                    </span>
                                                  </>
                                                )}
                                              </div>
                                              {conflict.status !== 'RESOLVED' && (
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleResolveConflict(conflict.id);
                                                  }}
                                                  className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition"
                                                >
                                                  <CheckCircle2 size={12} />
                                                  처리
                                                </button>
                                              )}
                                            </div>
                                            <div className="flex gap-3">
                                              <div className="flex-1 min-w-0">
                                                <div className="text-xs font-medium text-slate-500 mb-1">변경 전</div>
                                                <pre className="bg-white rounded-lg p-2 text-xs text-slate-700 font-mono overflow-auto max-h-40 whitespace-pre-wrap break-all border border-slate-200">
                                                  {JSON.stringify(conflict.beforeJson, null, 2)}
                                                </pre>
                                              </div>
                                              <div className="flex-1 min-w-0">
                                                <div className="text-xs font-medium text-slate-500 mb-1">변경 후</div>
                                                <pre className="bg-white rounded-lg p-2 text-xs text-slate-700 font-mono overflow-auto max-h-40 whitespace-pre-wrap break-all border border-slate-200">
                                                  {JSON.stringify(conflict.afterJson, null, 2)}
                                                </pre>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-4 text-slate-400 text-sm">상세 정보를 불러올 수 없습니다.</div>
                              )}
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
                총 {total.toLocaleString()}건 중 {(page - 1) * LIMIT + 1}-{Math.min(page * LIMIT, total)}건
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
