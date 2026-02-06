'use client';

import { useState, useEffect, useCallback, Fragment, useRef } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  Upload,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  Users,
  FileText,
  Calendar,
  X,
  Save,
  Check,
  Trash2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DateSummary {
  date: string;
  totalFiles: number;
  pendingFiles: number;
  analyzedFiles: number;
  failedFiles: number;
  approvalStatus: string | null;
}

interface LabAnalysis {
  id: string;
  patientName: string;
  emrPatientId: string | null;
  abnormalCount: number;
  normalCount: number;
  status: string;
  aiComment: string | null;
  doctorComment: string | null;
  priority: string;
  stamp: string | null;
  approvedAt: string | null;
}

interface LabUploadFile {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  status: string;
  errorMessage: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  analyses: LabAnalysis[];
}

interface DateDetailResponse {
  date: string;
  files: LabUploadFile[];
  summary: {
    totalFiles: number;
    analyzedFiles: number;
    pendingFiles: number;
    failedFiles: number;
    totalPatients: number;
    abnormalPatients: number;
    normalPatients: number;
  };
  approval: {
    id: string;
    status: string;
    approvedBy: { id: string; name: string } | null;
    approvedAt: string | null;
    stampedAt: string | null;
  } | null;
}

interface AnalysisDetail {
  id: string;
  patientName: string;
  emrPatientId: string | null;
  abnormalCount: number;
  normalCount: number;
  aiComment: string | null;
  doctorComment: string | null;
  priority: string;
  stamp: string | null;
  status: string;
  parsedData: any;
  labResults: any[];
  upload: { fileName: string; fileType: string };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '대기',
  ANALYZING: '분석중',
  ANALYZED: '분석완료',
  APPROVED: '승인완료',
  FAILED: '실패',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  ANALYZING: 'bg-blue-100 text-blue-700',
  ANALYZED: 'bg-green-100 text-green-700',
  APPROVED: 'bg-purple-100 text-purple-700',
  FAILED: 'bg-red-100 text-red-700',
};

const PRIORITY_OPTIONS = [
  { value: 'EMERGENCY', label: '응급실 내원', stamp: '🔴 응급실 내원', color: 'bg-red-500 text-white' },
  { value: 'URGENT', label: '빠른 시일내 병원 내원', stamp: '🟠 빠른 시일내 병원 내원', color: 'bg-orange-500 text-white' },
  { value: 'RECHECK', label: '재검사 요망', stamp: '🟡 재검사 요망', color: 'bg-yellow-500 text-white' },
  { value: 'CAUTION', label: '건강유의', stamp: '🟢 건강유의', color: 'bg-green-500 text-white' },
  { value: 'NORMAL', label: '특이사항 없음', stamp: '⚪ 특이사항 없음', color: 'bg-slate-400 text-white' },
];

const STAMP_COLORS: Record<string, string> = {
  EMERGENCY: 'bg-red-100 text-red-700 border-red-300',
  URGENT: 'bg-orange-100 text-orange-700 border-orange-300',
  RECHECK: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  CAUTION: 'bg-green-100 text-green-700 border-green-300',
  NORMAL: 'bg-slate-100 text-slate-600 border-slate-300',
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMonthDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Date[] = [];

  // 이전 달의 날짜들 (빈칸 채우기)
  const startDayOfWeek = firstDay.getDay();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push(d);
  }

  // 이번 달
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }

  // 다음 달 (6주 채우기)
  while (days.length < 42) {
    days.push(new Date(year, month + 1, days.length - lastDay.getDate() - startDayOfWeek + 1));
  }

  return days;
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function LabUploadsPage() {
  const { accessToken } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Date state
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [showCalendar, setShowCalendar] = useState(false);

  // List state
  const [items, setItems] = useState<DateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Detail state
  const [detail, setDetail] = useState<DateDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Analyzing state
  const [analyzingDate, setAnalyzingDate] = useState<string | null>(null);

  // Selection state
  const [selectedAnalyses, setSelectedAnalyses] = useState<Set<string>>(new Set());

  // Modal state
  const [modalAnalysis, setModalAnalysis] = useState<AnalysisDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [editComment, setEditComment] = useState('');
  const [editPriority, setEditPriority] = useState('');
  const [editStamp, setEditStamp] = useState('');
  const [saving, setSaving] = useState(false);

  // Polling state
  const [isPolling, setIsPolling] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Approving state
  const [approving, setApproving] = useState(false);

  // Filter state
  const [filter, setFilter] = useState<'all' | 'abnormal' | 'normal'>('all');

  /* ---------- Fetch list ------------------------------------------ */

  const fetchList = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<{ items: DateSummary[] }>('/api/lab-uploads', {
        token: accessToken,
      });
      setItems(res.data!.items);
    } catch {
      // handle error silently
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  /* ---------- Fetch detail ---------------------------------------- */

  const fetchDetail = useCallback(
    async (date: string) => {
      if (!accessToken) return;
      setDetailLoading(true);
      setDetail(null);
      try {
        const res = await api<DateDetailResponse>(`/api/lab-uploads/${date}`, {
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

  useEffect(() => {
    if (selectedDate) {
      fetchDetail(selectedDate);
      setSelectedAnalyses(new Set());
    }
  }, [selectedDate, fetchDetail]);

  // 분석 중인 파일이 있으면 자동 폴링 시작
  useEffect(() => {
    const hasAnalyzing = detail?.files.some(f => f.status === 'ANALYZING');

    if (hasAnalyzing && !isPolling) {
      setIsPolling(true);
      pollingRef.current = setInterval(() => {
        fetchList();
        if (selectedDate) {
          fetchDetail(selectedDate);
        }
      }, 3000);
    } else if (!hasAnalyzing && isPolling) {
      setIsPolling(false);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [detail, isPolling, selectedDate, fetchList, fetchDetail]);

  /* ---------- Upload files ---------------------------------------- */

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !accessToken) return;

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      const res = await fetch(`${API_BASE}/api/lab-uploads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error?.message || '업로드 실패');
      }

      setUploadSuccess(`${json.data.uploaded}개 파일이 업로드되었습니다.`);
      fetchList();

      // 오늘 날짜로 선택
      const today = new Date().toISOString().slice(0, 10);
      setSelectedDate(today);
    } catch (err: any) {
      setUploadError(err.message || '업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  /* ---------- Start analysis -------------------------------------- */

  async function handleStartAnalysis() {
    if (!accessToken || !selectedDate) return;

    setAnalyzingDate(selectedDate);
    try {
      await api(`/api/lab-uploads/${selectedDate}/analyze`, {
        method: 'POST',
        token: accessToken,
      });

      // 폴링 시작
      setIsPolling(true);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      pollingRef.current = setInterval(() => {
        fetchList();
        fetchDetail(selectedDate);
      }, 3000);

      // 즉시 새로고침
      fetchList();
      fetchDetail(selectedDate);
    } catch (err: any) {
      alert(err.message || '분석 시작 실패');
    } finally {
      setAnalyzingDate(null);
    }
  }

  /* ---------- Open analysis modal --------------------------------- */

  async function openAnalysisModal(analysisId: string) {
    if (!accessToken) return;

    setModalLoading(true);
    setModalAnalysis(null);

    try {
      const res = await api<AnalysisDetail>(`/api/lab-uploads/analyses/${analysisId}`, {
        token: accessToken,
      });
      const data = res.data!;
      setModalAnalysis(data);
      setEditComment(data.doctorComment || data.aiComment || '');
      setEditPriority(data.priority);
      setEditStamp(data.stamp || '');
    } catch {
      alert('분석 결과를 불러올 수 없습니다.');
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setModalAnalysis(null);
  }

  /* ---------- Save analysis changes ------------------------------- */

  async function handleSaveAnalysis() {
    if (!modalAnalysis || !accessToken) return;

    setSaving(true);
    try {
      await api(`/api/lab-uploads/analyses/${modalAnalysis.id}`, {
        method: 'PUT',
        token: accessToken,
        body: {
          doctorComment: editComment,
          priority: editPriority,
          stamp: editStamp,
        },
      });

      // 모달 닫고 목록 새로고침
      closeModal();
      fetchDetail(selectedDate);
    } catch (err: any) {
      alert(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  /* ---------- Toggle selection ------------------------------------ */

  function toggleSelection(analysisId: string) {
    setSelectedAnalyses((prev) => {
      const next = new Set(prev);
      if (next.has(analysisId)) {
        next.delete(analysisId);
      } else {
        next.add(analysisId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (!detail) return;

    const allAnalyses = detail.files.flatMap((f) => f.analyses.filter((a) => a.status === 'ANALYZED'));
    if (selectedAnalyses.size === allAnalyses.length) {
      setSelectedAnalyses(new Set());
    } else {
      setSelectedAnalyses(new Set(allAnalyses.map((a) => a.id)));
    }
  }

  /* ---------- Approve selected ------------------------------------ */

  async function handleApprove() {
    if (!accessToken || selectedAnalyses.size === 0) return;

    if (!confirm(`${selectedAnalyses.size}건의 분석결과를 승인하시겠습니까?`)) return;

    setApproving(true);
    try {
      await api('/api/lab-uploads/analyses/approve', {
        method: 'POST',
        token: accessToken,
        body: {
          analysisIds: Array.from(selectedAnalyses),
        },
      });

      alert('승인이 완료되었습니다.');
      setSelectedAnalyses(new Set());
      fetchList();
      fetchDetail(selectedDate);
    } catch (err: any) {
      alert(err.message || '승인 실패');
    } finally {
      setApproving(false);
    }
  }

  /* ---------- Delete analysis ------------------------------------ */

  async function handleDeleteAnalysis(analysisId: string, patientName: string) {
    if (!accessToken) return;

    if (!confirm(`"${patientName}" 환자의 분석결과를 삭제하시겠습니까?\n\n삭제 시 검사결과 승인 페이지와 업무함에서도 함께 삭제됩니다.`)) return;

    try {
      await api(`/api/lab-uploads/analyses/${analysisId}`, {
        method: 'DELETE',
        token: accessToken,
      });

      alert('분석결과가 삭제되었습니다.');
      fetchList();
      fetchDetail(selectedDate);
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  }

  /* ---------- Delete upload file --------------------------------- */

  async function handleDeleteFile(fileId: string, fileName: string, analysisCount: number) {
    if (!accessToken) return;

    const message = analysisCount > 0
      ? `"${fileName}" 파일을 삭제하시겠습니까?\n\n이 파일에 포함된 ${analysisCount}건의 분석결과도 함께 삭제되며,\n검사결과 승인 페이지와 업무함에서도 삭제됩니다.`
      : `"${fileName}" 파일을 삭제하시겠습니까?`;

    if (!confirm(message)) return;

    try {
      await api(`/api/lab-uploads/${fileId}`, {
        method: 'DELETE',
        token: accessToken,
      });

      alert('파일이 삭제되었습니다.');
      fetchList();
      fetchDetail(selectedDate);
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  }

  /* ---------- Calendar navigation --------------------------------- */

  function prevMonth() {
    if (calendarMonth === 0) {
      setCalendarYear((y) => y - 1);
      setCalendarMonth(11);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (calendarMonth === 11) {
      setCalendarYear((y) => y + 1);
      setCalendarMonth(0);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  }

  function selectCalendarDate(date: Date) {
    setSelectedDate(date.toISOString().slice(0, 10));
    setShowCalendar(false);
  }

  /* ---------- Render ---------------------------------------------- */

  const allAnalyses = detail?.files.flatMap((f) => f.analyses.filter((a) => a.status === 'ANALYZED')) || [];
  const hasPendingFiles = detail?.summary.pendingFiles && detail.summary.pendingFiles > 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">검사결과 등록 <span className="text-xs text-blue-500 font-normal">(v2.0)</span></h1>
          <p className="text-slate-500 mt-1">혈액/소변 검사결과 파일을 업로드하고 AI 분석을 실행합니다.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchList(); fetchDetail(selectedDate); }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
          >
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">파일 업로드</h2>
            <p className="text-sm text-slate-500">
              지원 형식: Excel (.xlsx, .xls), CSV (.csv), PDF (.pdf), 이미지 (.jpg, .png)
            </p>
          </div>
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.gif,.webp"
              onChange={(e) => handleUpload(e.target.files)}
              className="hidden"
              id="lab-file-upload"
            />
            <label
              htmlFor="lab-file-upload"
              className={`flex items-center gap-2 px-6 py-3 rounded-lg cursor-pointer transition text-sm font-medium ${
                uploading
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  업로드 중...
                </>
              ) : (
                <>
                  <Upload size={18} />
                  파일 선택 및 업로드
                </>
              )}
            </label>
          </div>
        </div>

        {/* Upload feedback */}
        {uploadError && (
          <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 px-4 py-3 rounded-lg">
            <XCircle size={16} />
            {uploadError}
          </div>
        )}
        {uploadSuccess && (
          <div className="mt-4 flex items-center gap-2 text-green-600 text-sm bg-green-50 px-4 py-3 rounded-lg">
            <CheckCircle2 size={16} />
            {uploadSuccess}
          </div>
        )}
      </div>

      {/* Date Selector + Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Date Picker */}
        <div className="col-span-12 lg:col-span-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="p-1 hover:bg-slate-100 rounded">
                <ChevronLeft size={20} />
              </button>
              <span className="font-medium text-slate-700">
                {calendarYear}년 {calendarMonth + 1}월
              </span>
              <button onClick={nextMonth} className="p-1 hover:bg-slate-100 rounded">
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
                <div key={d} className="py-1 text-slate-500 font-medium">
                  {d}
                </div>
              ))}
              {getMonthDays(calendarYear, calendarMonth).map((date, i) => {
                const dateStr = date.toISOString().slice(0, 10);
                const isCurrentMonth = date.getMonth() === calendarMonth;
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === new Date().toISOString().slice(0, 10);
                const hasData = items.some((item) => item.date === dateStr);

                return (
                  <button
                    key={i}
                    onClick={() => selectCalendarDate(date)}
                    className={`py-2 rounded text-sm transition relative ${
                      !isCurrentMonth
                        ? 'text-slate-300'
                        : isSelected
                        ? 'bg-blue-600 text-white'
                        : isToday
                        ? 'bg-blue-100 text-blue-700'
                        : 'hover:bg-slate-100'
                    }`}
                  >
                    {date.getDate()}
                    {hasData && isCurrentMonth && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-500 rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Recent dates with data */}
            <div className="mt-4 pt-4 border-t border-slate-100">
              <h4 className="text-xs font-medium text-slate-500 mb-2">최근 업로드</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {items.slice(0, 10).map((item) => (
                  <button
                    key={item.date}
                    onClick={() => setSelectedDate(item.date)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                      item.date === selectedDate
                        ? 'bg-blue-50 text-blue-700'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{formatDate(item.date).replace(/^\d{4}년 /, '')}</span>
                      <span className="text-xs text-slate-400">{item.totalFiles}개</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Detail */}
        <div className="col-span-12 lg:col-span-9">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar size={18} className="text-slate-500" />
                <h3 className="font-medium text-slate-700">{formatDate(selectedDate)}</h3>
                {isPolling && (
                  <span className="flex items-center gap-2 text-sm text-blue-600">
                    <Loader2 size={14} className="animate-spin" />
                    분석 진행 중...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hasPendingFiles && (
                  <button
                    onClick={handleStartAnalysis}
                    disabled={analyzingDate === selectedDate}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {analyzingDate === selectedDate ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        분석중...
                      </>
                    ) : (
                      <>
                        <Play size={14} />
                        분석시작
                      </>
                    )}
                  </button>
                )}
                {selectedAnalyses.size > 0 && (
                  <button
                    onClick={handleApprove}
                    disabled={approving}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                  >
                    {approving ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        승인중...
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        승인 ({selectedAnalyses.size}건)
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            {detailLoading ? (
              <div className="text-center py-12 text-slate-400">로딩 중...</div>
            ) : !detail || detail.files.length === 0 ? (
              <div className="text-center py-12">
                <FileSpreadsheet size={48} className="mx-auto text-slate-300 mb-4" />
                <p className="text-slate-500">이 날짜에 업로드된 파일이 없습니다.</p>
              </div>
            ) : (
              <div className="p-4 space-y-6">
                {/* Summary Cards (clickable for filtering) */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <button
                    onClick={() => setFilter('all')}
                    className={`text-left rounded-lg border p-3 transition ${
                      filter === 'all'
                        ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                      <FileText size={14} />
                      총 파일
                    </div>
                    <div className="text-xl font-bold text-slate-900">{detail.summary.totalFiles}</div>
                  </button>
                  <div className="text-left rounded-lg border p-3 bg-purple-50 border-purple-200">
                    <div className="flex items-center gap-2 text-purple-500 text-xs mb-1">
                      <CheckCircle2 size={14} />
                      분석완료
                    </div>
                    <div className="text-xl font-bold text-purple-600">{detail.summary.analyzedFiles}</div>
                  </div>
                  <div className="text-left rounded-lg border p-3 bg-yellow-50 border-yellow-200">
                    <div className="flex items-center gap-2 text-yellow-600 text-xs mb-1">
                      <Clock size={14} />
                      미분석
                    </div>
                    <div className="text-xl font-bold text-yellow-600">{detail.summary.pendingFiles}</div>
                  </div>
                  <button
                    onClick={() => setFilter('abnormal')}
                    className={`text-left rounded-lg border p-3 transition ${
                      filter === 'abnormal'
                        ? 'bg-red-100 border-red-400 ring-2 ring-red-500'
                        : 'bg-red-50 border-red-200 hover:bg-red-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-red-500 text-xs mb-1">
                      <AlertTriangle size={14} />
                      이상소견
                    </div>
                    <div className="text-xl font-bold text-red-600">{detail.summary.abnormalPatients}</div>
                  </button>
                  <button
                    onClick={() => setFilter('normal')}
                    className={`text-left rounded-lg border p-3 transition ${
                      filter === 'normal'
                        ? 'bg-green-100 border-green-400 ring-2 ring-green-500'
                        : 'bg-green-50 border-green-200 hover:bg-green-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-green-500 text-xs mb-1">
                      <CheckCircle2 size={14} />
                      정상
                    </div>
                    <div className="text-xl font-bold text-green-600">{detail.summary.normalPatients}</div>
                  </button>
                </div>

                {/* Filter indicator */}
                {filter !== 'all' && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-600">필터:</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      filter === 'abnormal' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {filter === 'abnormal' ? '이상소견만' : '정상만'}
                    </span>
                    <button
                      onClick={() => setFilter('all')}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Analysis Results Table */}
                {detail.files.some((f) => f.analyses.length > 0) && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-slate-700">환자별 분석 결과</h4>
                      {allAnalyses.length > 0 && (
                        <button
                          onClick={toggleSelectAll}
                          className="text-sm text-blue-600 hover:text-blue-700"
                        >
                          {selectedAnalyses.size === allAnalyses.length ? '전체 해제' : '전체 선택'}
                        </button>
                      )}
                    </div>
                    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-4 py-2 font-medium text-slate-600 w-10">
                              <input
                                type="checkbox"
                                checked={allAnalyses.length > 0 && selectedAnalyses.size === allAnalyses.length}
                                onChange={toggleSelectAll}
                                className="rounded border-slate-300"
                              />
                            </th>
                            <th className="text-left px-4 py-2 font-medium text-slate-600">파일/환자</th>
                            <th className="text-left px-4 py-2 font-medium text-slate-600">스탬프</th>
                            <th className="text-left px-4 py-2 font-medium text-slate-600">정상/이상</th>
                            <th className="text-left px-4 py-2 font-medium text-slate-600">상태</th>
                            <th className="text-left px-4 py-2 font-medium text-slate-600 w-16">삭제</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.files.flatMap((file) =>
                            file.analyses
                              .filter((analysis) => {
                                if (filter === 'abnormal') return analysis.abnormalCount > 0;
                                if (filter === 'normal') return analysis.abnormalCount === 0;
                                return true;
                              })
                              .map((analysis) => (
                              <tr
                                key={analysis.id}
                                className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer"
                                onClick={() => openAnalysisModal(analysis.id)}
                              >
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                  {analysis.status === 'ANALYZED' && (
                                    <input
                                      type="checkbox"
                                      checked={selectedAnalyses.has(analysis.id)}
                                      onChange={() => toggleSelection(analysis.id)}
                                      className="rounded border-slate-300"
                                    />
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="font-medium text-slate-900">{analysis.patientName}</div>
                                  <div className="text-xs text-slate-500">
                                    {file.fileName} {analysis.emrPatientId && `(${analysis.emrPatientId})`}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  {analysis.stamp && (
                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${STAMP_COLORS[analysis.priority] || ''}`}>
                                      {analysis.stamp}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-green-600 font-medium">{analysis.normalCount}</span>
                                  <span className="text-slate-400 mx-1">/</span>
                                  <span className={`font-medium ${analysis.abnormalCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                    {analysis.abnormalCount}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[analysis.status] || ''}`}>
                                    {STATUS_LABELS[analysis.status] || analysis.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => handleDeleteAnalysis(analysis.id, analysis.patientName)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                    title="삭제"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* File List */}
                <div>
                  <h4 className="font-medium text-slate-700 mb-3">업로드 파일 목록</h4>
                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left px-4 py-2 font-medium text-slate-600">파일명</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600">크기</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600">형식</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600">상태</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600">환자수</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600 w-16">삭제</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.files.map((file) => (
                          <tr key={file.id} className="border-b border-slate-100 last:border-b-0">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <FileSpreadsheet size={16} className="text-slate-400" />
                                <span className="text-slate-700 font-medium">{file.fileName}</span>
                              </div>
                              {file.errorMessage && (
                                <div className="text-xs text-red-500 mt-1">{file.errorMessage}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-500">{formatFileSize(file.fileSize)}</td>
                            <td className="px-4 py-3 text-slate-500 uppercase">{file.fileType}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[file.status] || ''}`}>
                                {STATUS_LABELS[file.status] || file.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{file.analyses.length}</td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => handleDeleteFile(file.id, file.fileName, file.analyses.length)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                                title="파일 삭제"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Analysis Detail Modal */}
      {(modalAnalysis || modalLoading) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            {modalLoading ? (
              <div className="p-8 text-center">
                <Loader2 size={32} className="animate-spin mx-auto text-blue-600" />
                <p className="mt-4 text-slate-500">로딩 중...</p>
              </div>
            ) : modalAnalysis && (
              <>
                {/* Modal Header */}
                <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{modalAnalysis.patientName}</h2>
                    <p className="text-sm text-slate-500">
                      {modalAnalysis.upload.fileName}
                      {modalAnalysis.emrPatientId && ` | EMR: ${modalAnalysis.emrPatientId}`}
                    </p>
                  </div>
                  <button onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-lg">
                    <X size={20} />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 space-y-6">
                  {/* Stamp & Priority */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">우선순위</label>
                      <select
                        value={editPriority}
                        onChange={(e) => {
                          setEditPriority(e.target.value);
                          const opt = PRIORITY_OPTIONS.find((o) => o.value === e.target.value);
                          if (opt) setEditStamp(opt.stamp);
                        }}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={modalAnalysis.status === 'APPROVED'}
                      >
                        {PRIORITY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">스탬프</label>
                      <div className={`px-4 py-3 rounded-lg border-2 text-center font-bold ${STAMP_COLORS[editPriority] || ''}`}>
                        {editStamp || '스탬프 없음'}
                      </div>
                    </div>
                  </div>

                  {/* AI Comment (read-only) */}
                  {modalAnalysis.aiComment && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">AI 자동 분석 결과</label>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-slate-700 whitespace-pre-wrap">
                        {modalAnalysis.aiComment}
                      </div>
                    </div>
                  )}

                  {/* Doctor Comment (editable) */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">의사 소견 (수정 가능)</label>
                    <textarea
                      value={editComment}
                      onChange={(e) => setEditComment(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      placeholder="소견을 입력하세요..."
                      disabled={modalAnalysis.status === 'APPROVED'}
                    />
                  </div>

                  {/* Lab Results */}
                  {modalAnalysis.labResults && modalAnalysis.labResults.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">검사 항목</label>
                      <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-100 border-b border-slate-200">
                              <th className="text-left px-3 py-2 font-medium text-slate-600">항목</th>
                              <th className="text-left px-3 py-2 font-medium text-slate-600">결과</th>
                              <th className="text-left px-3 py-2 font-medium text-slate-600">참고치</th>
                              <th className="text-left px-3 py-2 font-medium text-slate-600">판정</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modalAnalysis.labResults.map((r: any, i: number) => (
                              <tr key={i} className="border-b border-slate-100 last:border-b-0">
                                <td className="px-3 py-2 text-slate-700">{r.analyte}</td>
                                <td className="px-3 py-2 font-medium">
                                  <span className={r.flag !== 'NORMAL' ? 'text-red-600' : 'text-slate-900'}>
                                    {r.value} {r.unit}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-500">
                                  {r.refLow !== null && r.refHigh !== null ? `${r.refLow} - ${r.refHigh}` : '-'}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                    r.flag === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                                    r.flag === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                    r.flag === 'LOW' ? 'bg-blue-100 text-blue-700' :
                                    'bg-green-100 text-green-700'
                                  }`}>
                                    {r.flag}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                {modalAnalysis.status !== 'APPROVED' && (
                  <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3">
                    <button
                      onClick={closeModal}
                      className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSaveAnalysis}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          저장 중...
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          저장
                        </>
                      )}
                    </button>
                  </div>
                )}

                {modalAnalysis.status === 'APPROVED' && (
                  <div className="sticky bottom-0 bg-purple-50 border-t border-purple-200 px-6 py-4 text-center text-purple-700">
                    이미 승인된 분석결과입니다. 수정할 수 없습니다.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
