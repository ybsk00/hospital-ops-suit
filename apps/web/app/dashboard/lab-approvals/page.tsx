'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Download,
  X,
  User,
  FileText,
  Printer,
  CheckCircle2,
  AlertTriangle,
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

interface AnalysisItem {
  id: string;
  patientName: string;
  emrPatientId: string | null;
  patient: { id: string; name: string; emrPatientId: string } | null;
  abnormalCount: number;
  normalCount: number;
  priority: string;
  stamp: string | null;
  aiComment: string | null;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
}

interface DateResponse {
  date: string;
  count: number;
  analyses: AnalysisItem[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const PRIORITY_COLORS: Record<string, string> = {
  EMERGENCY: 'bg-red-100 text-red-700 border-red-300',
  URGENT: 'bg-orange-100 text-orange-700 border-orange-300',
  RECHECK: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  CAUTION: 'bg-green-100 text-green-700 border-green-300',
  NORMAL: 'bg-slate-100 text-slate-700 border-slate-300',
};

const PRIORITY_LABELS: Record<string, string> = {
  EMERGENCY: '응급실 방문',
  URGENT: '병원내원요망',
  RECHECK: '재검사요망',
  CAUTION: '건강유의',
  NORMAL: '정상',
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function LabApprovalsPage() {
  const { accessToken } = useAuthStore();

  // Calendar state
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [calendarData, setCalendarData] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);

  // View mode
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');

  // Selected date modal
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateAnalyses, setDateAnalyses] = useState<AnalysisItem[]>([]);
  const [dateLoading, setDateLoading] = useState(false);

  // PDF modal
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisItem | null>(null);

  /* ---------- Fetch calendar data --------------------------------- */

  const fetchCalendar = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<CalendarResponse>(`/api/lab-approvals/calendar?year=${year}&month=${month}`, {
        token: accessToken,
      });
      setCalendarData(res.data?.days || []);
    } catch (err) {
      console.error('Calendar fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, year, month]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  /* ---------- Fetch date analyses --------------------------------- */

  const fetchDateAnalyses = useCallback(async (date: string) => {
    if (!accessToken) return;
    setDateLoading(true);
    try {
      const res = await api<DateResponse>(`/api/lab-approvals/by-date/${date}`, {
        token: accessToken,
      });
      setDateAnalyses(res.data?.analyses || []);
    } catch (err) {
      console.error('Date analyses fetch error:', err);
    } finally {
      setDateLoading(false);
    }
  }, [accessToken]);

  /* ---------- Calendar helpers ------------------------------------ */

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

    // Empty slots for previous month
    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    // Days in current month
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
    fetchDateAnalyses(date);
  }

  function handlePatientClick(analysis: AnalysisItem) {
    setSelectedAnalysis(analysis);
  }

  function handleDownloadPdf(analysisId: string) {
    if (!accessToken) return;
    window.open(`${API_BASE}/api/lab-uploads/analyses/${analysisId}/export-pdf?token=${accessToken}`, '_blank');
  }

  function handlePrintPdf(analysisId: string) {
    if (!accessToken) return;
    const pdfUrl = `${API_BASE}/api/lab-uploads/analyses/${analysisId}/export-pdf?token=${accessToken}`;
    const printWindow = window.open(pdfUrl, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
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

  /* ---------- Render ---------------------------------------------- */

  const calendarDays = generateCalendarDays();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">검사결과 승인 현황</h1>
          <p className="text-slate-500 mt-1">승인된 검사결과를 달력으로 확인합니다.</p>
        </div>
        <button
          onClick={fetchCalendar}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {/* View Mode Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {(['day', 'week', 'month'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  viewMode === mode
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {mode === 'day' ? '일별' : mode === 'week' ? '주별' : '월별'}
              </button>
            ))}
          </div>

          {/* Month Navigation */}
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
        </div>

        {/* Calendar Grid */}
        <div className="p-4">
          {loading ? (
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
                    return <div key={`empty-${idx}`} className="min-h-24" />;
                  }

                  const isToday = dayData.date === today;
                  const hasData = dayData.count > 0;
                  const dayOfWeek = (getFirstDayOfMonth(year, month) + dayData.day - 1) % 7;

                  return (
                    <div
                      key={dayData.date}
                      onClick={() => handleDateClick(dayData.date, dayData.count)}
                      className={`min-h-24 border rounded-lg p-2 transition ${
                        hasData
                          ? 'cursor-pointer hover:bg-green-50 hover:border-green-300'
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
                        <div className="mt-2">
                          <div className="bg-green-100 text-green-700 rounded px-2 py-1 text-xs font-medium text-center">
                            {dayData.count}건
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Date Modal - Patient List */}
      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{formatDate(selectedDate)}</h3>
                <p className="text-sm text-slate-500">승인된 검사결과 {dateAnalyses.length}건</p>
              </div>
              <button
                onClick={() => { setSelectedDate(null); setDateAnalyses([]); }}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {dateLoading ? (
                <div className="text-center py-8 text-slate-400">로딩 중...</div>
              ) : dateAnalyses.length === 0 ? (
                <div className="text-center py-8 text-slate-400">승인된 검사결과가 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {dateAnalyses.map((analysis) => (
                    <div
                      key={analysis.id}
                      onClick={() => handlePatientClick(analysis)}
                      className="flex items-center justify-between p-4 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                          <User size={20} className="text-slate-400" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">
                            {analysis.patientName || '환자'}
                          </div>
                          <div className="text-sm text-slate-500">
                            {analysis.emrPatientId || analysis.patient?.emrPatientId || '-'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {analysis.priority && analysis.priority !== 'NORMAL' && (
                          <span className={`px-2 py-1 text-xs font-medium rounded border ${PRIORITY_COLORS[analysis.priority] || ''}`}>
                            {PRIORITY_LABELS[analysis.priority] || analysis.priority}
                          </span>
                        )}
                        <div className="text-xs text-slate-500">
                          {analysis.approvedBy?.name}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF Modal - Analysis Detail */}
      {selectedAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <FileText size={24} className="text-blue-500" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    검사결과 - {selectedAnalysis.patientName}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {selectedAnalysis.emrPatientId || '-'} |
                    승인: {selectedAnalysis.approvedBy?.name} ({selectedAnalysis.approvedAt ? formatDateTime(selectedAnalysis.approvedAt) : '-'})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedAnalysis(null)}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Priority Stamp at Top */}
            {selectedAnalysis.priority && selectedAnalysis.priority !== 'NORMAL' && (
              <div className={`mx-6 mt-4 p-4 rounded-lg border-2 text-center ${PRIORITY_COLORS[selectedAnalysis.priority]}`}>
                <div className="text-lg font-bold">
                  {selectedAnalysis.stamp || PRIORITY_LABELS[selectedAnalysis.priority]}
                </div>
              </div>
            )}

            {/* AI Comment */}
            {selectedAnalysis.aiComment && (
              <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2 text-amber-700 font-medium mb-2">
                  <AlertTriangle size={16} />
                  AI 분석 소견
                </div>
                <div className="text-sm text-amber-900 whitespace-pre-wrap">
                  {selectedAnalysis.aiComment}
                </div>
              </div>
            )}

            {/* PDF Preview Area */}
            <div className="flex-1 overflow-hidden p-6">
              <div className="bg-slate-100 rounded-lg h-full flex items-center justify-center">
                <iframe
                  src={`${API_BASE}/api/lab-uploads/analyses/${selectedAnalysis.id}/export-pdf?token=${accessToken}`}
                  className="w-full h-[400px] rounded-lg border border-slate-200"
                  title="PDF Preview"
                />
              </div>
            </div>

            {/* Approval Info */}
            <div className="px-6 py-3 bg-green-50 border-t border-green-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 size={18} />
                <span className="font-medium">{selectedAnalysis.approvedBy?.name}</span>님이 승인
              </div>
              <div className="text-sm text-green-600">
                {selectedAnalysis.approvedAt ? formatDateTime(selectedAnalysis.approvedAt) : ''}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <button
                onClick={() => handlePrintPdf(selectedAnalysis.id)}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                <Printer size={16} />
                출력
              </button>
              <button
                onClick={() => handleDownloadPdf(selectedAnalysis.id)}
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
