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

  // Selected date modal
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateAnalyses, setDateAnalyses] = useState<AnalysisItem[]>([]);
  const [dateLoading, setDateLoading] = useState(false);

  // PDF modal
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisItem | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

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
    fetchDateAnalyses(date);
  }

  function handlePatientClick(analysis: AnalysisItem) {
    handleSelectAnalysis(analysis);
  }

  // PDF blob URL 로드 (CORS 우회)
  async function loadPdfBlob(analysisId: string) {
    if (!accessToken) return;
    setPdfLoading(true);
    setPdfBlobUrl(null);

    try {
      const response = await fetch(`${API_BASE}/api/lab-uploads/analyses/${analysisId}/export-pdf?token=${accessToken}`, {
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
      alert('PDF를 불러올 수 없습니다.');
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
    setSelectedAnalysis(null);
  }

  // 분석 선택 시 PDF 로드
  function handleSelectAnalysis(analysis: AnalysisItem) {
    setSelectedAnalysis(analysis);
    loadPdfBlob(analysis.id);
  }

  function handleDownloadPdf(analysisId: string) {
    if (!accessToken) return;
    // download=true 파라미터로 강제 다운로드
    window.open(`${API_BASE}/api/lab-uploads/analyses/${analysisId}/export-pdf?token=${accessToken}&download=true`, '_blank');
  }

  function handlePrintPdf() {
    if (!pdfBlobUrl) return;
    const printWindow = window.open(pdfBlobUrl, '_blank');
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
  const totalApproved = calendarData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">검사결과 승인 현황</h1>
          <p className="text-slate-500 mt-1">승인된 검사결과를 월별로 확인합니다.</p>
        </div>
        <button
          onClick={fetchCalendar}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {/* Monthly Summary Card */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl p-6 mb-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-green-100 text-sm">{year}년 {month}월 승인 현황</p>
            <p className="text-4xl font-bold mt-1">{totalApproved}건</p>
          </div>
          <CheckCircle2 size={48} className="text-green-200" />
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-xl border border-slate-200">
        {/* Month Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
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
                          ? 'cursor-pointer hover:bg-green-50 hover:border-green-300 bg-green-50/30'
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
                          <span className="text-2xl font-bold text-green-600">{dayData.count}</span>
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
                          {analysis.stamp && (
                            <div className={`text-xs mt-0.5 px-2 py-0.5 rounded inline-block ${PRIORITY_COLORS[analysis.priority] || 'bg-slate-100'}`}>
                              {analysis.stamp}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500">
                        {analysis.approvedBy?.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF Modal */}
      {selectedAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <FileText size={24} className="text-blue-500" />
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {selectedAnalysis.patientName}
                  </h3>
                  <p className="text-sm text-slate-500">
                    승인: {selectedAnalysis.approvedBy?.name} ({selectedAnalysis.approvedAt ? formatDateTime(selectedAnalysis.approvedAt) : '-'})
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

            {/* PDF Preview */}
            <div className="flex-1 overflow-hidden p-4">
              {pdfLoading ? (
                <div className="flex items-center justify-center h-[500px] bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
                    <p className="text-slate-500">PDF 로딩 중...</p>
                  </div>
                </div>
              ) : pdfBlobUrl ? (
                <iframe
                  src={pdfBlobUrl}
                  className="w-full h-[500px] rounded-lg border border-slate-200"
                  title="PDF Preview"
                />
              ) : (
                <div className="flex items-center justify-center h-[500px] bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-slate-500">PDF를 불러올 수 없습니다.</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <button
                onClick={handlePrintPdf}
                disabled={!pdfBlobUrl}
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
              >
                <Printer size={16} />
                출력
              </button>
              <button
                onClick={() => handleDownloadPdf(selectedAnalysis.id)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                <Download size={16} />
                다운로드
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
