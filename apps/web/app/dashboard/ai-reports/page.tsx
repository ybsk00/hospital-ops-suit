'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { usePermission } from '../../../hooks/usePermission';
import { api } from '../../../lib/api';
import {
  Sparkles,
  RefreshCw,
  Plus,
  FileText,
  CheckCircle,
  XCircle,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  Search,
  Download,
  FileSpreadsheet,
  Stamp,
} from 'lucide-react';

// ── 타입 ──

interface Patient {
  id: string;
  name: string;
  emrPatientId: string;
}

interface AiReport {
  id: string;
  patientId: string;
  visitId: string | null;
  status: string;
  draftText: string | null;
  reviewedText: string | null;
  approvedText: string | null;
  rejectionNote: string | null;
  version: number;
  stampedAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  patient: Patient;
  visit?: {
    id: string;
    scheduledAt: string;
    staff?: { id: string; name: string };
    questionnaires?: any[];
  } | null;
  approvedBy?: { id: string; name: string } | null;
  labResults?: any[];
}

// ── 상수 ──

const statusLabels: Record<string, string> = {
  DRAFT: '초안',
  AI_REVIEWED: 'AI 생성완료',
  APPROVED: '승인됨',
  REJECTED: '반려됨',
  SENT: '발송됨',
  ACKED: '확인됨',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  AI_REVIEWED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  SENT: 'bg-purple-100 text-purple-700',
  ACKED: 'bg-teal-100 text-teal-700',
};

// 의사용 전체 필터
const allStatusFilterOptions = [
  { value: '', label: '전체 상태' },
  { value: 'DRAFT', label: '초안' },
  { value: 'AI_REVIEWED', label: 'AI 생성완료' },
  { value: 'APPROVED', label: '승인됨' },
  { value: 'REJECTED', label: '반려됨' },
];

// 일반 직원용 필터 (DRAFT/AI_REVIEWED 숨김)
const staffStatusFilterOptions = [
  { value: '', label: '전체 상태' },
  { value: 'APPROVED', label: '승인됨' },
  { value: 'SENT', label: '발송됨' },
  { value: 'ACKED', label: '확인됨' },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ── 스탬프 오버레이 컴포넌트 ──

function StampOverlay({ approvedBy, stampedAt }: { approvedBy?: string; stampedAt?: string }) {
  const date = stampedAt ? new Date(stampedAt).toLocaleDateString('ko-KR') : '';
  return (
    <div className="absolute top-4 right-4 pointer-events-none select-none" style={{ transform: 'rotate(-15deg)' }}>
      <div className="w-28 h-28 rounded-full border-4 border-red-500 flex flex-col items-center justify-center opacity-70">
        <span className="text-red-500 text-xs font-bold">서울온케어</span>
        <span className="text-red-500 text-[10px] font-semibold mt-0.5">확인완료</span>
        <div className="w-16 h-px bg-red-400 my-1" />
        <span className="text-red-500 text-[9px]">{date}</span>
        {approvedBy && <span className="text-red-500 text-[9px] font-medium">{approvedBy}</span>}
      </div>
    </div>
  );
}

// ── 메인 페이지 ──

export default function AiReportsPage() {
  const { accessToken } = useAuthStore();
  const { can, isSuperAdmin } = usePermission();

  // 의사/관리자: WRITE 권한 보유 → 모든 상태 조회 가능
  const hasWritePermission = isSuperAdmin || can('AI_REPORTS', 'WRITE');

  // 리스트 상태
  const [reports, setReports] = useState<AiReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  // 상세 상태
  const [selected, setSelected] = useState<AiReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 생성 모달
  const [showCreate, setShowCreate] = useState(false);

  // 편집
  const [editText, setEditText] = useState('');
  const [editing, setEditing] = useState(false);

  // AI 생성 로딩
  const [generating, setGenerating] = useState(false);

  // 다운로드 로딩
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  // 필터 옵션: 권한에 따라 분기
  const statusFilterOptions = hasWritePermission ? allStatusFilterOptions : staffStatusFilterOptions;

  // ── 목록 조회 ──

  const fetchReports = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', '20');
      const query = params.toString() ? `?${params}` : '';

      const res = await api<{ items: AiReport[]; total: number }>(`/api/ai-reports${query}`, {
        token: accessToken,
      });
      setReports(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter, page]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // ── 상세 조회 ──

  async function fetchDetail(id: string) {
    if (!accessToken) return;
    setDetailLoading(true);
    try {
      const res = await api<AiReport>(`/api/ai-reports/${id}`, { token: accessToken });
      if (res.data) {
        setSelected(res.data);
        setEditText(res.data.reviewedText || res.data.draftText || '');
      }
    } catch (err: any) {
      alert(err.message || '소견서 조회 실패');
    } finally {
      setDetailLoading(false);
    }
  }

  // ── AI 생성 ──

  async function handleGenerate() {
    if (!accessToken || !selected) return;
    setGenerating(true);
    try {
      const res = await api<AiReport>(`/api/ai-reports/${selected.id}/generate`, {
        method: 'POST',
        token: accessToken,
      });
      if (res.data) {
        setSelected(res.data);
        setEditText(res.data.draftText || '');
      }
    } catch (err: any) {
      alert(err.message || 'AI 소견서 생성 실패');
    } finally {
      setGenerating(false);
    }
  }

  // ── 텍스트 저장 ──

  async function handleSave() {
    if (!accessToken || !selected) return;
    setEditing(true);
    try {
      const res = await api<AiReport>(`/api/ai-reports/${selected.id}`, {
        method: 'PATCH',
        body: { reviewedText: editText, version: selected.version },
        token: accessToken,
      });
      if (res.data) {
        setSelected(res.data);
        setEditText(res.data.reviewedText || res.data.draftText || '');
      }
    } catch (err: any) {
      alert(err.message || '저장 실패');
    } finally {
      setEditing(false);
    }
  }

  // ── 승인 (스탬프) ──

  async function handleApprove() {
    if (!accessToken || !selected) return;
    if (!confirm('이 소견서를 확인(스탬프)하시겠습니까?\n승인 후에는 직원이 열람할 수 있게 됩니다.')) return;
    try {
      const res = await api<AiReport>(`/api/ai-reports/${selected.id}/approve`, {
        method: 'PATCH',
        body: { version: selected.version },
        token: accessToken,
      });
      if (res.data) {
        setSelected(res.data);
        fetchReports();
      }
    } catch (err: any) {
      alert(err.message || '승인 실패');
    }
  }

  // ── 반려 ──

  async function handleReject() {
    if (!accessToken || !selected) return;
    const note = prompt('반려 사유를 입력하세요:');
    if (note === null) return;
    try {
      const res = await api<AiReport>(`/api/ai-reports/${selected.id}/reject`, {
        method: 'PATCH',
        body: { version: selected.version, rejectionNote: note },
        token: accessToken,
      });
      if (res.data) {
        setSelected(res.data);
        fetchReports();
      }
    } catch (err: any) {
      alert(err.message || '반려 실패');
    }
  }

  // ── 삭제 ──

  async function handleDelete() {
    if (!accessToken || !selected) return;
    if (!confirm('이 소견서를 삭제하시겠습니까?')) return;
    try {
      await api(`/api/ai-reports/${selected.id}`, {
        method: 'DELETE',
        token: accessToken,
      });
      setSelected(null);
      fetchReports();
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  }

  // ── PDF 다운로드 ──

  async function handleDownloadPdf() {
    if (!accessToken || !selected) return;
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai-reports/${selected.id}/export-pdf`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message || 'PDF 다운로드 실패');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `소견서_${selected.patient.name}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'PDF 다운로드 실패');
    } finally {
      setDownloadingPdf(false);
    }
  }

  // ── 엑셀 다운로드 ──

  async function handleDownloadExcel() {
    if (!accessToken || !selected) return;
    setDownloadingExcel(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai-reports/${selected.id}/export-excel`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message || '엑셀 다운로드 실패');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `소견서_${selected.patient.name}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || '엑셀 다운로드 실패');
    } finally {
      setDownloadingExcel(false);
    }
  }

  // ── 상세 뷰 ──

  if (selected) {
    const displayText = selected.approvedText || selected.reviewedText || selected.draftText || '';
    const isEditable = hasWritePermission && !['APPROVED', 'SENT', 'ACKED'].includes(selected.status);
    const isApproved = ['APPROVED', 'SENT', 'ACKED'].includes(selected.status);
    const canApprove = hasWritePermission && ['AI_REVIEWED', 'DRAFT'].includes(selected.status);

    return (
      <div>
        <button
          onClick={() => { setSelected(null); fetchReports(); }}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
        >
          <ChevronLeft size={16} />
          목록으로
        </button>

        {detailLoading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : (
          <div className="space-y-4">
            {/* 헤더 */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {selected.patient.name} ({selected.patient.emrPatientId})
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    생성일: {new Date(selected.createdAt).toLocaleString('ko-KR')}
                    {selected.visit && ` | 방문: ${new Date(selected.visit.scheduledAt).toLocaleDateString('ko-KR')}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[selected.status] || 'bg-slate-100 text-slate-600'}`}>
                    {statusLabels[selected.status] || selected.status}
                  </span>
                  {selected.stampedAt && (
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      스탬프 완료
                    </span>
                  )}
                </div>
              </div>

              {/* 승인 정보 */}
              {selected.approvedBy && (
                <div className="text-sm text-slate-500">
                  승인자: {selected.approvedBy.name} | 승인일: {selected.approvedAt ? new Date(selected.approvedAt).toLocaleString('ko-KR') : '-'}
                </div>
              )}

              {/* 반려 사유 */}
              {selected.status === 'REJECTED' && selected.rejectionNote && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <strong>반려 사유:</strong> {selected.rejectionNote}
                </div>
              )}

              {/* 다운로드 버튼 (승인됨 이상) */}
              {isApproved && (
                <div className="mt-4 flex items-center gap-2">
                  <button
                    onClick={handleDownloadPdf}
                    disabled={downloadingPdf}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
                  >
                    {downloadingPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    스탬프 PDF 다운로드
                  </button>
                  <button
                    onClick={handleDownloadExcel}
                    disabled={downloadingExcel}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-50"
                  >
                    {downloadingExcel ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
                    엑셀 다운로드
                  </button>
                </div>
              )}
            </div>

            {/* 소견서 본문 */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 relative">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-slate-900">소견서 내용</h3>
                <div className="flex items-center gap-2">
                  {hasWritePermission && selected.status === 'DRAFT' && (
                    <button
                      onClick={handleGenerate}
                      disabled={generating}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-sm font-medium hover:from-blue-700 hover:to-purple-700 transition disabled:opacity-50"
                    >
                      {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      {generating ? 'AI 생성 중...' : 'AI 자동 생성'}
                    </button>
                  )}
                  {isEditable && displayText && (
                    <button
                      onClick={handleSave}
                      disabled={editing}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      {editing ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                      저장
                    </button>
                  )}
                </div>
              </div>

              {isEditable ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={20}
                  className="w-full border border-slate-300 rounded-lg p-4 text-sm leading-relaxed focus:ring-2 focus:ring-blue-500 outline-none resize-y"
                  placeholder="AI 자동 생성 버튼을 누르면 소견서가 자동으로 작성됩니다."
                />
              ) : (
                <div className="relative">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 border border-slate-200 rounded-lg p-4 bg-slate-50 min-h-[300px]">
                    {displayText || '(내용 없음)'}
                  </div>
                  {/* 승인된 소견서에 스탬프 오버레이 */}
                  {isApproved && selected.stampedAt && (
                    <StampOverlay
                      approvedBy={selected.approvedBy?.name}
                      stampedAt={selected.stampedAt}
                    />
                  )}
                </div>
              )}
            </div>

            {/* 검사결과 */}
            {selected.labResults && selected.labResults.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-3">최근 검사결과</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left">
                        <th className="pb-2 font-medium text-slate-500">검사항목</th>
                        <th className="pb-2 font-medium text-slate-500">분석물</th>
                        <th className="pb-2 font-medium text-slate-500 text-right">수치</th>
                        <th className="pb-2 font-medium text-slate-500">단위</th>
                        <th className="pb-2 font-medium text-slate-500">참고범위</th>
                        <th className="pb-2 font-medium text-slate-500">판정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.labResults.map((lab: any) => (
                        <tr key={lab.id} className="border-b border-slate-100">
                          <td className="py-2">{lab.testName}</td>
                          <td className="py-2">{lab.analyte}</td>
                          <td className="py-2 text-right font-medium">{lab.value}</td>
                          <td className="py-2 text-slate-500">{lab.unit || '-'}</td>
                          <td className="py-2 text-slate-500">
                            {lab.refLow != null && lab.refHigh != null ? `${lab.refLow}-${lab.refHigh}` : '-'}
                          </td>
                          <td className="py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              lab.flag === 'HIGH' ? 'bg-red-100 text-red-700' :
                              lab.flag === 'LOW' ? 'bg-blue-100 text-blue-700' :
                              lab.flag === 'CRITICAL' ? 'bg-red-200 text-red-800' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {lab.flag}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 액션 버튼 */}
            <div className="flex items-center gap-3">
              {canApprove && (
                <>
                  <button
                    onClick={handleApprove}
                    className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition"
                  >
                    <Stamp size={16} />
                    확인 (스탬프)
                  </button>
                  <button
                    onClick={handleReject}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition"
                  >
                    <XCircle size={16} />
                    반려
                  </button>
                </>
              )}
              {hasWritePermission && !['APPROVED', 'SENT', 'ACKED'].includes(selected.status) && (
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-2 px-5 py-2.5 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition"
                >
                  삭제
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 목록 뷰 ──

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI 소견서</h1>
          <p className="text-slate-500 mt-1">AI 기반 의료 소견서를 생성하고 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchReports}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
          >
            <RefreshCw size={16} />
            새로고침
          </button>
          {hasWritePermission && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
            >
              <Plus size={16} />
              소견서 생성
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        >
          {statusFilterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="text-sm text-slate-500">총 {total}건</span>
      </div>

      {/* Loading */}
      {loading && <div className="text-center py-12 text-slate-400">로딩 중...</div>}

      {/* List */}
      {!loading && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => {
            const reportIsApproved = ['APPROVED', 'SENT', 'ACKED'].includes(report.status);
            return (
              <div
                key={report.id}
                onClick={() => fetchDetail(report.id)}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200 hover:shadow-sm transition cursor-pointer"
              >
                <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                  reportIsApproved ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                }`}>
                  {reportIsApproved ? <CheckCircle size={18} /> : <FileText size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {report.patient.name} ({report.patient.emrPatientId})
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {new Date(report.createdAt).toLocaleString('ko-KR')}
                    {report.visit && ` | 방문: ${new Date(report.visit.scheduledAt).toLocaleDateString('ko-KR')}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[report.status] || 'bg-slate-100 text-slate-600'}`}>
                    {statusLabels[report.status] || report.status}
                  </span>
                  {report.stampedAt && (
                    <span className="text-red-500" title="스탬프 완료">
                      <Stamp size={14} />
                    </span>
                  )}
                  {report.approvedBy && (
                    <span className="text-xs text-slate-400">
                      {report.approvedBy.name}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > 20 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-50"
          >
            이전
          </button>
          <span className="text-sm text-slate-600">
            {page} / {Math.ceil(total / 20)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / 20)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-50"
          >
            다음
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && reports.length === 0 && (
        <div className="text-center py-12">
          <Sparkles size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">소견서가 없습니다.</p>
          {hasWritePermission && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm text-blue-600 hover:underline"
            >
              새 소견서 생성하기
            </button>
          )}
        </div>
      )}

      {/* 생성 모달 */}
      {showCreate && (
        <CreateReportModal
          onClose={() => setShowCreate(false)}
          onCreated={(report) => {
            setShowCreate(false);
            fetchDetail(report.id);
          }}
        />
      )}
    </div>
  );
}

// ── 생성 모달 ──

function CreateReportModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (report: AiReport) => void;
}) {
  const { accessToken } = useAuthStore();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  async function searchPatients() {
    if (!accessToken || search.length < 1) return;
    setLoading(true);
    try {
      const res = await api<{ items: Patient[] }>(`/api/admissions?search=${encodeURIComponent(search)}&limit=10`, {
        token: accessToken,
      });
      // 입원 목록에서 환자 추출 (중복 제거)
      const admissions = res.data?.items || [];
      const seen = new Set<string>();
      const pts: Patient[] = [];
      for (const a of admissions as any[]) {
        const p = a.patient;
        if (p && !seen.has(p.id)) {
          seen.add(p.id);
          pts.push({ id: p.id, name: p.name, emrPatientId: p.emrPatientId });
        }
      }
      setPatients(pts);
    } catch {
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!accessToken || !selectedPatient) return;
    setCreating(true);
    try {
      const res = await api<AiReport>('/api/ai-reports', {
        method: 'POST',
        body: { patientId: selectedPatient.id },
        token: accessToken,
      });
      if (res.data) onCreated(res.data);
    } catch (err: any) {
      alert(err.message || '생성 실패');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900 mb-4">새 소견서 생성</h3>

        {/* 환자 검색 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">환자 검색</label>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchPatients()}
              placeholder="환자명 또는 EMR ID"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              onClick={searchPatients}
              className="px-3 py-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition"
            >
              <Search size={16} />
            </button>
          </div>
        </div>

        {loading && <div className="text-sm text-slate-400 mb-3">검색 중...</div>}

        {patients.length > 0 && (
          <div className="mb-4 max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
            {patients.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPatient(p)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition ${
                  selectedPatient?.id === p.id ? 'bg-blue-50 text-blue-700' : ''
                }`}
              >
                {p.name} ({p.emrPatientId})
              </button>
            ))}
          </div>
        )}

        {selectedPatient && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
            선택: <strong>{selectedPatient.name}</strong> ({selectedPatient.emrPatientId})
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 transition"
          >
            취소
          </button>
          <button
            onClick={handleCreate}
            disabled={!selectedPatient || creating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50"
          >
            {creating ? '생성 중...' : '생성'}
          </button>
        </div>
      </div>
    </div>
  );
}
