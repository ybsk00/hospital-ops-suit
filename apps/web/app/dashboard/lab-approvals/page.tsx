'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  Users,
  FileText,
  Download,
  FileSpreadsheet,
  Stamp,
  Filter,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PatientSummary {
  totalPatients: number;
  abnormalPatients: number;
  normalPatients: number;
  totalFiles: number;
}

interface ApprovalItem {
  id: string;
  uploadDate: string;
  patientSummary: PatientSummary;
  status: string;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  stampedAt: string | null;
  version: number;
}

interface LabResult {
  id: string;
  testName: string;
  analyte: string;
  value: number;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string;
}

interface Analysis {
  id: string;
  patientName: string;
  emrPatientId: string | null;
  patient: { id: string; name: string; emrPatientId: string } | null;
  abnormalCount: number;
  normalCount: number;
  aiComment: string | null;
  labResults: LabResult[];
}

interface ApprovalDetail extends ApprovalItem {
  aiSummary: string | null;
  rejectionNote: string | null;
  analyses: Analysis[];
}

interface ListResponse {
  items: ApprovalItem[];
  total: number;
  page: number;
  limit: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '승인대기',
  APPROVED: '승인완료',
  REJECTED: '반려',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const FLAG_LABELS: Record<string, string> = {
  NORMAL: '정상',
  HIGH: '높음',
  LOW: '낮음',
  CRITICAL: '위험',
};

const FLAG_COLORS: Record<string, string> = {
  NORMAL: 'bg-green-100 text-green-700',
  HIGH: 'bg-orange-100 text-orange-700',
  LOW: 'bg-blue-100 text-blue-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function LabApprovalsPage() {
  const { accessToken, user } = useAuthStore();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Check if user has APPROVE permission (doctor)
  const canApprove = user?.isSuperAdmin || user?.departments?.some((d: any) =>
    d.permissions?.some((p: any) => p.resource === 'LAB_APPROVALS' && p.actions?.includes('APPROVE'))
  );

  // List state
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filter
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action states
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  // Create from date (for incoming from lab-uploads page)
  const dateParam = searchParams.get('date');
  const [creating, setCreating] = useState(false);

  /* ---------- Create approval from date (if param exists) ---------- */

  useEffect(() => {
    async function createFromDate() {
      if (!dateParam || !accessToken) return;

      setCreating(true);
      try {
        const res = await api<{ id: string }>('/api/lab-approvals/create-from-date', {
          method: 'POST',
          body: { date: dateParam },
          token: accessToken,
        });

        // 성공 시 목록 새로고침하고 URL에서 date 파라미터 제거
        router.replace('/dashboard/lab-approvals');
        fetchList();

        // 생성된 항목 자동 확장
        if (res.data?.id) {
          setExpandedId(res.data.id);
          fetchDetail(res.data.id);
        }
      } catch (err: any) {
        if (err.message?.includes('ALREADY_EXISTS')) {
          // 이미 존재하면 그냥 목록 보여주기
          router.replace('/dashboard/lab-approvals');
        } else {
          alert(err.message || '승인 객체 생성 실패');
          router.replace('/dashboard/lab-approvals');
        }
      } finally {
        setCreating(false);
      }
    }

    createFromDate();
  }, [dateParam, accessToken]);

  /* ---------- Fetch list ------------------------------------------ */

  const fetchList = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      if (statusFilter) params.set('status', statusFilter);

      const res = await api<ListResponse>(`/api/lab-approvals?${params.toString()}`, {
        token: accessToken,
      });
      setItems(res.data!.items);
      setTotal(res.data!.total);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, statusFilter]);

  useEffect(() => {
    if (!dateParam) {
      fetchList();
    }
  }, [fetchList, dateParam]);

  /* ---------- Fetch detail ---------------------------------------- */

  const fetchDetail = useCallback(
    async (id: string) => {
      if (!accessToken) return;
      setDetailLoading(true);
      setDetail(null);
      try {
        const res = await api<ApprovalDetail>(`/api/lab-approvals/${id}`, {
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

  /* ---------- Approve --------------------------------------------- */

  async function handleApprove() {
    if (!accessToken || !detail) return;

    setApproving(true);
    try {
      await api(`/api/lab-approvals/${detail.id}/approve`, {
        method: 'PATCH',
        body: { version: detail.version },
        token: accessToken,
      });

      fetchList();
      fetchDetail(detail.id);
    } catch (err: any) {
      alert(err.message || '승인 실패');
    } finally {
      setApproving(false);
    }
  }

  /* ---------- Reject ---------------------------------------------- */

  async function handleReject() {
    if (!accessToken || !detail) return;

    setRejecting(true);
    try {
      await api(`/api/lab-approvals/${detail.id}/reject`, {
        method: 'PATCH',
        body: { version: detail.version, rejectionNote },
        token: accessToken,
      });

      setShowRejectModal(false);
      setRejectionNote('');
      fetchList();
      fetchDetail(detail.id);
    } catch (err: any) {
      alert(err.message || '반려 실패');
    } finally {
      setRejecting(false);
    }
  }

  /* ---------- Export ---------------------------------------------- */

  async function handleExportPdf(id: string) {
    if (!accessToken) return;
    window.open(`${API_BASE}/api/lab-approvals/${id}/export-pdf?token=${accessToken}`, '_blank');
  }

  async function handleExportExcel(id: string) {
    if (!accessToken) return;
    window.open(`${API_BASE}/api/lab-approvals/${id}/export-excel?token=${accessToken}`, '_blank');
  }

  /* ---------- Render ---------------------------------------------- */

  if (creating) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 size={48} className="animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-slate-600">승인 정보를 생성 중입니다...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">검사결과 승인</h1>
          <p className="text-slate-500 mt-1">
            {canApprove
              ? 'AI 분석된 검사결과를 검토하고 승인합니다.'
              : '승인된 검사결과를 조회합니다.'}
          </p>
        </div>
        <button
          onClick={fetchList}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {/* Filter */}
      {canApprove && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Filter size={16} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-700">필터</span>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">상태</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">전체</option>
              <option value="PENDING">승인대기</option>
              <option value="APPROVED">승인완료</option>
              <option value="REJECTED">반려</option>
            </select>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="font-medium text-slate-700">
            {canApprove ? '검사결과 승인 목록' : '승인된 검사결과'}
          </h3>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <FileText size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500">
              {canApprove ? '승인 대기 중인 검사결과가 없습니다.' : '승인된 검사결과가 없습니다.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const isExpanded = expandedId === item.id;

              return (
                <Fragment key={item.id}>
                  <div
                    className="px-4 py-4 hover:bg-slate-50 cursor-pointer transition"
                    onClick={() => handleToggleRow(item.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-slate-400">
                          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>

                        <div>
                          <div className="font-medium text-slate-900">{formatDate(item.uploadDate)}</div>
                          <div className="text-sm text-slate-500 mt-0.5">
                            총 {item.patientSummary.totalPatients}명 환자 / 이상소견 {item.patientSummary.abnormalPatients}명
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Status Badge */}
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || ''}`}>
                          {item.status === 'APPROVED' && <CheckCircle2 size={12} />}
                          {item.status === 'PENDING' && <Clock size={12} />}
                          {item.status === 'REJECTED' && <XCircle size={12} />}
                          {STATUS_LABELS[item.status] || item.status}
                        </span>

                        {/* Stamp indicator */}
                        {item.stampedAt && (
                          <div className="relative">
                            <div className="w-12 h-12 rounded-full border-2 border-red-500 flex items-center justify-center text-red-500 font-bold text-xs transform -rotate-12">
                              <Stamp size={16} />
                            </div>
                          </div>
                        )}

                        {/* Export buttons (for approved) */}
                        {item.status === 'APPROVED' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleExportPdf(item.id); }}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition"
                              title="PDF 다운로드"
                            >
                              <Download size={14} />
                              PDF
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleExportExcel(item.id); }}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition"
                              title="Excel 다운로드"
                            >
                              <FileSpreadsheet size={14} />
                              Excel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="px-4 py-4 bg-slate-50/50 border-t border-slate-100">
                      {detailLoading ? (
                        <div className="text-center py-8 text-slate-400">상세 정보 로딩 중...</div>
                      ) : detail ? (
                        <div className="space-y-6">
                          {/* Summary Cards */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white rounded-lg border border-slate-200 p-4">
                              <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
                                <FileText size={14} />
                                총 파일
                              </div>
                              <div className="text-2xl font-bold text-slate-900">{detail.patientSummary.totalFiles}</div>
                            </div>
                            <div className="bg-white rounded-lg border border-slate-200 p-4">
                              <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
                                <Users size={14} />
                                총 환자
                              </div>
                              <div className="text-2xl font-bold text-slate-900">{detail.patientSummary.totalPatients}</div>
                            </div>
                            <div className="bg-white rounded-lg border border-slate-200 p-4">
                              <div className="flex items-center gap-2 text-red-500 text-sm mb-1">
                                <AlertTriangle size={14} />
                                이상소견
                              </div>
                              <div className="text-2xl font-bold text-red-600">{detail.patientSummary.abnormalPatients}</div>
                            </div>
                            <div className="bg-white rounded-lg border border-slate-200 p-4">
                              <div className="flex items-center gap-2 text-green-500 text-sm mb-1">
                                <CheckCircle2 size={14} />
                                정상
                              </div>
                              <div className="text-2xl font-bold text-green-600">{detail.patientSummary.normalPatients}</div>
                            </div>
                          </div>

                          {/* AI Summary */}
                          {detail.aiSummary && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                              <div className="text-sm font-medium text-blue-700 mb-2">AI 종합 소견</div>
                              <div className="text-sm text-blue-900 whitespace-pre-wrap">{detail.aiSummary}</div>
                            </div>
                          )}

                          {/* Rejection Note */}
                          {detail.rejectionNote && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                              <div className="text-sm font-medium text-red-700 mb-2">반려 사유</div>
                              <div className="text-sm text-red-900">{detail.rejectionNote}</div>
                            </div>
                          )}

                          {/* Patient Analysis Results */}
                          <div>
                            <h4 className="font-medium text-slate-700 mb-3">환자별 검사결과</h4>
                            <div className="space-y-4">
                              {detail.analyses.map((analysis) => (
                                <div key={analysis.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                    <div>
                                      <span className="font-medium text-slate-900">{analysis.patientName}</span>
                                      {analysis.emrPatientId && (
                                        <span className="text-slate-500 text-sm ml-2">({analysis.emrPatientId})</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-green-600">정상 {analysis.normalCount}</span>
                                      <span className="text-xs text-slate-300">|</span>
                                      <span className="text-xs text-red-600">이상 {analysis.abnormalCount}</span>
                                    </div>
                                  </div>

                                  {/* AI Comment */}
                                  {analysis.aiComment && (
                                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-sm text-amber-900">
                                      <span className="font-medium">AI 소견:</span> {analysis.aiComment}
                                    </div>
                                  )}

                                  {/* Results Table */}
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="bg-slate-50 border-b border-slate-100">
                                        <th className="text-left px-4 py-2 font-medium text-slate-600">항목</th>
                                        <th className="text-left px-4 py-2 font-medium text-slate-600">분석물</th>
                                        <th className="text-right px-4 py-2 font-medium text-slate-600">결과</th>
                                        <th className="text-left px-4 py-2 font-medium text-slate-600">단위</th>
                                        <th className="text-center px-4 py-2 font-medium text-slate-600">참고범위</th>
                                        <th className="text-center px-4 py-2 font-medium text-slate-600">판정</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {analysis.labResults.map((result) => (
                                        <tr key={result.id} className={`border-b border-slate-50 ${result.flag === 'CRITICAL' ? 'bg-red-50' : result.flag !== 'NORMAL' ? 'bg-amber-50' : ''}`}>
                                          <td className="px-4 py-2 text-slate-700">{result.testName}</td>
                                          <td className="px-4 py-2 text-slate-600">{result.analyte}</td>
                                          <td className="px-4 py-2 text-right font-mono font-medium text-slate-900">{result.value}</td>
                                          <td className="px-4 py-2 text-slate-500">{result.unit || '-'}</td>
                                          <td className="px-4 py-2 text-center text-slate-500 text-xs">
                                            {result.refLow !== null || result.refHigh !== null
                                              ? `${result.refLow ?? ''} - ${result.refHigh ?? ''}`
                                              : '-'}
                                          </td>
                                          <td className="px-4 py-2 text-center">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${FLAG_COLORS[result.flag] || ''}`}>
                                              {FLAG_LABELS[result.flag] || result.flag}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Approval Info (if approved) */}
                          {detail.status === 'APPROVED' && detail.approvedBy && (
                            <div className="relative bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                                <CheckCircle2 size={18} />
                                승인 정보
                              </div>
                              <div className="text-sm text-green-600">
                                <span className="font-medium">{detail.approvedBy.name}</span>님이
                                {detail.approvedAt && ` ${formatDateTime(detail.approvedAt)}에`} 승인하였습니다.
                              </div>

                              {/* Stamp */}
                              {detail.stampedAt && (
                                <div className="absolute top-4 right-4 w-20 h-20 rounded-full border-4 border-red-500 flex flex-col items-center justify-center text-red-500 font-bold transform -rotate-12 bg-white/50">
                                  <div className="text-xs">승인</div>
                                  <div className="text-[10px]">{new Date(detail.stampedAt).toLocaleDateString('ko-KR')}</div>
                                  <div className="text-[10px]">{detail.approvedBy.name}</div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Action Buttons (for PENDING and canApprove) */}
                          {detail.status === 'PENDING' && canApprove && (
                            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                              <button
                                onClick={() => setShowRejectModal(true)}
                                disabled={rejecting}
                                className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
                              >
                                <XCircle size={16} />
                                반려
                              </button>
                              <button
                                onClick={handleApprove}
                                disabled={approving}
                                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                              >
                                {approving ? (
                                  <>
                                    <Loader2 size={16} className="animate-spin" />
                                    처리중...
                                  </>
                                ) : (
                                  <>
                                    <Stamp size={16} />
                                    승인 (스탬프)
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-slate-400">상세 정보를 불러올 수 없습니다.</div>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <span className="text-sm text-slate-500">총 {total}건</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-sm border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-sm text-slate-700">
                {page} / {Math.ceil(total / 20)}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(Math.ceil(total / 20), p + 1))}
                disabled={page >= Math.ceil(total / 20)}
                className="px-3 py-1 text-sm border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">검사결과 반려</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">반려 사유 (선택)</label>
              <textarea
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="반려 사유를 입력하세요..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowRejectModal(false); setRejectionNote(''); }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                취소
              </button>
              <button
                onClick={handleReject}
                disabled={rejecting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {rejecting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    처리중...
                  </>
                ) : (
                  '반려'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
