'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  Inbox,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  FlaskConical,
  FileText,
  GitCompare,
  Flag,
  ServerCrash,
  Clock,
  CheckCircle,
  Eye,
  Download,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Calendar,
  X,
  User,
  Printer,
  CheckCircle2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CalendarDay {
  date: string;
  count: number;
}

interface CalendarResponse {
  year: number;
  month: number;
  days: CalendarDay[];
}

interface InboxItem {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  entityType: string | null;
  entityId: string | null;
  priority: number;
  comment: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface DateResponse {
  date: string;
  count: number;
  items: InboxItem[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const statusLabels: Record<string, string> = {
  UNREAD: '미확인',
  IN_REVIEW: '검토중',
  RESOLVED: '처리완료',
};

const statusColors: Record<string, string> = {
  UNREAD: 'bg-red-100 text-red-700',
  IN_REVIEW: 'bg-yellow-100 text-yellow-700',
  RESOLVED: 'bg-green-100 text-green-700',
};

const typeLabels: Record<string, string> = {
  RED_ALERT: 'RED 알림',
  ORANGE_ALERT: 'ORANGE 알림',
  LAB_ABNORMAL: '비정상 검사',
  LAB_APPROVED: '검사결과 승인',
  REPORT_PENDING: '의견서 대기',
  SYNC_CONFLICT: '동기화 충돌',
  MANUAL_FLAG: '수동 플래그',
  BATCH_FAILURE: '배치 오류',
};

const typeIconColors: Record<string, string> = {
  RED_ALERT: 'text-red-500 bg-red-50',
  ORANGE_ALERT: 'text-orange-500 bg-orange-50',
  LAB_ABNORMAL: 'text-purple-500 bg-purple-50',
  LAB_APPROVED: 'text-green-600 bg-green-50',
  REPORT_PENDING: 'text-blue-500 bg-blue-50',
  SYNC_CONFLICT: 'text-yellow-600 bg-yellow-50',
  MANUAL_FLAG: 'text-teal-500 bg-teal-50',
  BATCH_FAILURE: 'text-slate-600 bg-slate-100',
};

const typeFilterOptions = [
  { value: '', label: '전체' },
  { value: 'LAB_APPROVED', label: '검사결과 승인' },
  { value: 'RED_ALERT', label: 'RED 알림' },
  { value: 'ORANGE_ALERT', label: 'ORANGE 알림' },
  { value: 'LAB_ABNORMAL', label: '비정상 검사결과' },
  { value: 'REPORT_PENDING', label: '의견서 승인대기' },
  { value: 'SYNC_CONFLICT', label: '동기화 충돌' },
  { value: 'MANUAL_FLAG', label: '수동 플래그' },
  { value: 'BATCH_FAILURE', label: '배치 오류' },
];

function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  switch (type) {
    case 'RED_ALERT':
      return <AlertCircle size={size} />;
    case 'ORANGE_ALERT':
      return <AlertTriangle size={size} />;
    case 'LAB_ABNORMAL':
      return <FlaskConical size={size} />;
    case 'LAB_APPROVED':
      return <ClipboardCheck size={size} />;
    case 'REPORT_PENDING':
      return <FileText size={size} />;
    case 'SYNC_CONFLICT':
      return <GitCompare size={size} />;
    case 'MANUAL_FLAG':
      return <Flag size={size} />;
    case 'BATCH_FAILURE':
      return <ServerCrash size={size} />;
    default:
      return <AlertCircle size={size} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function InboxPage() {
  const { accessToken } = useAuthStore();

  // View mode: 'today' or 'month'
  const [viewMode, setViewMode] = useState<'today' | 'month'>('today');

  // Type filter - default empty to show ALL items
  const [typeFilter, setTypeFilter] = useState('');

  // Selected items for bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Today items
  const [todayItems, setTodayItems] = useState<InboxItem[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);

  // Calendar state (for month view)
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [calendarData, setCalendarData] = useState<CalendarDay[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Selected date modal (for month view)
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateItems, setDateItems] = useState<InboxItem[]>([]);
  const [dateLoading, setDateLoading] = useState(false);

  // PDF modal
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Bulk download state
  const [bulkDownloading, setBulkDownloading] = useState(false);

  /* ---------- Fetch today items ------------------------------------- */

  const fetchTodayItems = useCallback(async () => {
    if (!accessToken) return;
    setTodayLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const typeParam = typeFilter ? `?type=${typeFilter}` : '';
      const res = await api<DateResponse>(`/api/inbox/by-date/${today}${typeParam}`, {
        token: accessToken,
      });
      setTodayItems(res.data?.items || []);
    } catch (err) {
      console.error('Today items fetch error:', err);
    } finally {
      setTodayLoading(false);
    }
  }, [accessToken, typeFilter]);

  useEffect(() => {
    if (viewMode === 'today') {
      fetchTodayItems();
    }
  }, [viewMode, fetchTodayItems]);

  /* ---------- Fetch calendar data ----------------------------------- */

  const fetchCalendar = useCallback(async () => {
    if (!accessToken) return;
    setCalendarLoading(true);
    try {
      const typeParam = typeFilter ? `&type=${typeFilter}` : '';
      const res = await api<CalendarResponse>(`/api/inbox/calendar?year=${year}&month=${month}${typeParam}`, {
        token: accessToken,
      });
      setCalendarData(res.data?.days || []);
    } catch (err) {
      console.error('Calendar fetch error:', err);
    } finally {
      setCalendarLoading(false);
    }
  }, [accessToken, year, month, typeFilter]);

  useEffect(() => {
    if (viewMode === 'month') {
      fetchCalendar();
    }
  }, [viewMode, fetchCalendar]);

  /* ---------- Fetch date items -------------------------------------- */

  const fetchDateItems = useCallback(async (date: string) => {
    if (!accessToken) return;
    setDateLoading(true);
    try {
      const typeParam = typeFilter ? `?type=${typeFilter}` : '';
      const res = await api<DateResponse>(`/api/inbox/by-date/${date}${typeParam}`, {
        token: accessToken,
      });
      setDateItems(res.data?.items || []);
    } catch (err) {
      console.error('Date items fetch error:', err);
    } finally {
      setDateLoading(false);
    }
  }, [accessToken, typeFilter]);

  /* ---------- Calendar helpers -------------------------------------- */

  function getDaysInMonth(y: number, m: number): number {
    return new Date(y, m, 0).getDate();
  }

  function getFirstDayOfMonth(y: number, m: number): number {
    return new Date(y, m - 1, 1).getDay();
  }

  function generateCalendarDays() {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days: Array<{ day: number; date: string; count: number } | null> = [];

    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = calendarData.find((c) => c.date === dateStr);
      days.push({
        day: d,
        date: dateStr,
        count: dayData?.count || 0,
      });
    }

    return days;
  }

  function handlePrevMonth() {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  }

  function handleNextMonth() {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  }

  function handleDateClick(date: string, count: number) {
    if (count === 0) return;
    setSelectedDate(date);
    fetchDateItems(date);
  }

  // PDF blob URL 로드 (CORS 우회)
  async function loadPdfBlob(entityId: string) {
    if (!accessToken) return;
    setPdfLoading(true);
    setPdfBlobUrl(null);

    try {
      const response = await fetch(`${API_BASE}/api/lab-uploads/analyses/${entityId}/export-pdf?token=${accessToken}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('PDF 로드 실패');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
    } catch (err) {
      console.error('PDF load error:', err);
    } finally {
      setPdfLoading(false);
    }
  }

  // 모달 닫을 때 blob URL 정리
  function closePdfModal() {
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
    }
    setPdfBlobUrl(null);
    setSelectedItem(null);
  }

  function handleItemClick(item: InboxItem) {
    setSelectedItem(item);
    if (item.entityType === 'LabAnalysis' && item.entityId) {
      loadPdfBlob(item.entityId);
    }
  }

  async function handleStatusChange(item: InboxItem, newStatus: string) {
    if (!accessToken) return;
    try {
      await api(`/api/inbox/${item.id}/status`, {
        method: 'PATCH',
        body: { status: newStatus },
        token: accessToken,
      });
      // Refresh items
      if (viewMode === 'today') {
        fetchTodayItems();
      } else if (selectedDate) {
        fetchDateItems(selectedDate);
      }
      fetchCalendar();
    } catch (err: any) {
      alert(err.message || '상태 변경에 실패했습니다.');
    }
  }

  function handleDownloadPdf(entityId: string) {
    if (!accessToken || !entityId) return;
    // download=true 파라미터로 강제 다운로드
    window.open(`${API_BASE}/api/lab-uploads/analyses/${entityId}/export-pdf?token=${accessToken}&download=true`, '_blank');
  }

  function handlePrintPdf(entityId: string) {
    if (!accessToken || !entityId) return;
    const pdfUrl = `${API_BASE}/api/lab-uploads/analyses/${entityId}/export-pdf?token=${accessToken}`;
    const printWindow = window.open(pdfUrl, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  }

  // Toggle single item selection
  function toggleSelectItem(itemId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  // Toggle select all
  function toggleSelectAll() {
    const downloadableItems = todayItems.filter(item => item.entityType === 'LabAnalysis' && item.entityId);
    if (selectedIds.size === downloadableItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(downloadableItems.map(item => item.id)));
    }
  }

  async function handleBulkDownload() {
    if (!accessToken || bulkDownloading) return;

    // Get selected items that can be downloaded
    const downloadableItems = todayItems.filter(
      item => selectedIds.has(item.id) && item.entityType === 'LabAnalysis' && item.entityId
    );

    if (downloadableItems.length === 0) {
      alert('다운로드할 항목을 선택해주세요.');
      return;
    }

    setBulkDownloading(true);

    // Download each PDF sequentially with a small delay
    for (const item of downloadableItems) {
      if (item.entityId) {
        window.open(`${API_BASE}/api/lab-uploads/analyses/${item.entityId}/export-pdf?token=${accessToken}&download=true`, '_blank');
        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setBulkDownloading(false);
    setSelectedIds(new Set()); // Clear selection after download
  }

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
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /* ---------- Render ------------------------------------------------ */

  const calendarDays = generateCalendarDays();
  const today = new Date().toISOString().slice(0, 10);
  const totalMonthCount = calendarData.reduce((sum, d) => sum + d.count, 0);

  // Filter downloadable items for count (any item with LabAnalysis entity)
  const downloadableItems = todayItems.filter(
    item => item.entityType === 'LabAnalysis' && item.entityId
  );
  const downloadableCount = downloadableItems.length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">업무함</h1>
          <p className="text-slate-500 mt-1">업무 알림과 승인된 검사결과를 확인합니다.</p>
        </div>
        <button
          onClick={() => viewMode === 'today' ? fetchTodayItems() : fetchCalendar()}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {/* View Mode Toggle & Filters */}
      <div className="bg-white rounded-xl border border-slate-200 mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-4">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('today')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  viewMode === 'today'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                오늘
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  viewMode === 'month'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                월간
              </button>
            </div>

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              {typeFilterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Month Navigation (only for month view) */}
          {viewMode === 'month' && (
            <div className="flex items-center gap-4">
              <button
                onClick={handlePrevMonth}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Calendar size={20} className="text-slate-400" />
                {year}년 {month}월
              </div>
              <button
                onClick={handleNextMonth}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          {viewMode === 'today' ? (
            /* ============ Today View ============ */
            <>
              {/* Today Summary Card */}
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl p-6 mb-6 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm">{formatDate(today)}</p>
                    <p className="text-4xl font-bold mt-1">{todayItems.length}건</p>
                    <p className="text-blue-100 text-sm mt-1">오늘 업무함 항목</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {downloadableCount > 0 && (
                      <button
                        onClick={handleBulkDownload}
                        disabled={bulkDownloading || selectedIds.size === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition text-white font-medium disabled:opacity-50"
                      >
                        <Download size={18} />
                        {bulkDownloading ? '다운로드 중...' : `선택 다운로드 (${selectedIds.size}건)`}
                      </button>
                    )}
                    <CheckCircle2 size={48} className="text-blue-200" />
                  </div>
                </div>
              </div>

              {/* Select All Header */}
              {downloadableCount > 0 && !todayLoading && (
                <div className="flex items-center gap-3 mb-3 px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === downloadableCount && downloadableCount > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-slate-600">
                    전체 선택 ({selectedIds.size} / {downloadableCount}건)
                  </span>
                </div>
              )}

              {/* Today Items List */}
              {todayLoading ? (
                <div className="text-center py-12 text-slate-400">로딩 중...</div>
              ) : todayItems.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Inbox size={48} className="mx-auto mb-3 text-slate-300" />
                  오늘 업무함 항목이 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {todayItems.map((item) => {
                    const iconColor = typeIconColors[item.type] || 'text-slate-500 bg-slate-100';
                    const canDownload = item.entityType === 'LabAnalysis' && item.entityId;
                    const isSelected = selectedIds.has(item.id);

                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between p-4 border rounded-lg bg-white hover:bg-slate-50 transition ${
                          isSelected ? 'border-blue-300 bg-blue-50/30' : 'border-slate-200'
                        }`}
                      >
                        {/* Checkbox for downloadable items */}
                        {canDownload && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectItem(item.id)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mr-3 flex-shrink-0"
                          />
                        )}

                        <div
                          onClick={() => canDownload && handleItemClick(item)}
                          className={`flex items-center gap-3 flex-1 ${canDownload ? 'cursor-pointer' : ''}`}
                        >
                          <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${iconColor}`}>
                            <TypeIcon type={item.type} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-900 truncate">
                                {item.title}
                              </span>
                              <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                {typeLabels[item.type] || item.type}
                              </span>
                            </div>
                            {item.summary && (
                              <div className="text-sm text-slate-500 truncate">
                                {item.summary}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[item.status]}`}>
                                {statusLabels[item.status]}
                              </span>
                              <span className="text-xs text-slate-400">
                                {formatDateTime(item.createdAt)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Individual Download Button */}
                        {canDownload && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadPdf(item.entityId!);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition ml-3"
                          >
                            <Download size={14} />
                            다운로드
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* ============ Month View ============ */
            <>
              {/* Month Stats */}
              <div className="mb-4 text-sm text-slate-600">
                이번 달 총: <span className="font-bold text-blue-600">{totalMonthCount}</span>건
              </div>

              {calendarLoading ? (
                <div className="text-center py-12 text-slate-400">로딩 중...</div>
              ) : (
                <>
                  {/* Weekday Headers */}
                  <div className="grid grid-cols-7 gap-1 mb-2">
                    {WEEKDAYS.map((day, idx) => (
                      <div
                        key={day}
                        className={`text-center text-sm font-medium py-2 ${
                          idx === 0 ? 'text-red-500' : idx === 6 ? 'text-blue-500' : 'text-slate-600'
                        }`}
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Day Cells */}
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((dayData, idx) => {
                      if (!dayData) {
                        return <div key={`empty-${idx}`} className="min-h-20" />;
                      }

                      const isToday = dayData.date === today;
                      const hasData = dayData.count > 0;
                      const dayOfWeek = (getFirstDayOfMonth(year, month) + dayData.day - 1) % 7;

                      return (
                        <div
                          key={dayData.date}
                          onClick={() => handleDateClick(dayData.date, dayData.count)}
                          className={`min-h-20 border rounded-lg p-2 transition ${
                            hasData
                              ? 'cursor-pointer hover:bg-blue-50 hover:border-blue-300 bg-blue-50/30'
                              : 'bg-slate-50/50'
                          } ${isToday ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-200'}`}
                        >
                          <div className="flex items-start justify-between">
                            <span
                              className={`text-sm font-medium ${
                                dayOfWeek === 0
                                  ? 'text-red-500'
                                  : dayOfWeek === 6
                                  ? 'text-blue-500'
                                  : 'text-slate-700'
                              } ${isToday ? 'bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center' : ''}`}
                            >
                              {dayData.day}
                            </span>
                          </div>

                          {hasData && (
                            <div className="mt-1 text-center">
                              <span className="text-2xl font-bold text-blue-600">{dayData.count}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Date Modal - Item List (for month view) */}
      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{formatDate(selectedDate)}</h3>
                <p className="text-sm text-slate-500">업무함 항목 {dateItems.length}건</p>
              </div>
              <button
                onClick={() => { setSelectedDate(null); setDateItems([]); }}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {dateLoading ? (
                <div className="text-center py-8 text-slate-400">로딩 중...</div>
              ) : dateItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400">업무함 항목이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {dateItems.map((item) => {
                    const iconColor = typeIconColors[item.type] || 'text-slate-500 bg-slate-100';
                    const canDownload = item.entityType === 'LabAnalysis' && item.entityId;

                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
                      >
                        <div
                          onClick={() => canDownload && handleItemClick(item)}
                          className={`flex items-center gap-3 flex-1 ${canDownload ? 'cursor-pointer' : ''}`}
                        >
                          <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${iconColor}`}>
                            <TypeIcon type={item.type} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-900 truncate">
                                {item.title}
                              </span>
                              <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                                {typeLabels[item.type] || item.type}
                              </span>
                            </div>
                            {item.summary && (
                              <div className="text-sm text-slate-500 truncate">
                                {item.summary}
                              </div>
                            )}
                          </div>
                        </div>
                        {canDownload && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadPdf(item.entityId!);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition ml-2"
                          >
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF Modal - Item Detail */}
      {selectedItem && selectedItem.entityType === 'LabAnalysis' && selectedItem.entityId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <FileText size={24} className="text-blue-500" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {selectedItem.title}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {selectedItem.summary}
                  </p>
                </div>
              </div>
              <button
                onClick={closePdfModal}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Status Change Buttons */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
              <span className="text-sm text-slate-600">상태:</span>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[selectedItem.status]}`}>
                {statusLabels[selectedItem.status]}
              </span>
              {selectedItem.status === 'UNREAD' && (
                <button
                  onClick={() => handleStatusChange(selectedItem, 'IN_REVIEW')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition"
                >
                  <Eye size={12} />
                  검토 시작
                </button>
              )}
              {selectedItem.status === 'IN_REVIEW' && (
                <button
                  onClick={() => handleStatusChange(selectedItem, 'RESOLVED')}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 transition"
                >
                  <CheckCircle size={12} />
                  처리 완료
                </button>
              )}
            </div>

            {/* PDF Preview Area */}
            <div className="flex-1 overflow-hidden p-6">
              <div className="bg-slate-100 rounded-lg h-full">
                {pdfLoading ? (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
                      <p className="text-slate-500">PDF 로딩 중...</p>
                    </div>
                  </div>
                ) : pdfBlobUrl ? (
                  <iframe
                    src={pdfBlobUrl}
                    className="w-full h-[400px] rounded-lg border border-slate-200"
                    title="PDF Preview"
                  />
                ) : (
                  <div className="flex items-center justify-center h-[400px]">
                    <p className="text-slate-500">PDF를 불러올 수 없습니다.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Created Time */}
            <div className="px-6 py-3 bg-blue-50 border-t border-blue-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-700">
                <Clock size={18} />
                <span className="text-sm">등록일시: {formatDateTime(selectedItem.createdAt)}</span>
              </div>
              {selectedItem.resolvedAt && (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 size={18} />
                  <span className="text-sm">처리일시: {formatDateTime(selectedItem.resolvedAt)}</span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <button
                onClick={() => {
                  if (pdfBlobUrl) {
                    const printWindow = window.open(pdfBlobUrl, '_blank');
                    if (printWindow) {
                      printWindow.onload = () => printWindow.print();
                    }
                  }
                }}
                disabled={!pdfBlobUrl}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
              >
                <Printer size={16} />
                출력
              </button>
              <button
                onClick={() => handleDownloadPdf(selectedItem.entityId!)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                <Download size={16} />
                PDF 다운로드
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
