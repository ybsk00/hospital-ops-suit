'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  LogIn,
  LogOut,
  ArrowRightLeft,
} from 'lucide-react';

/* ── 타입 ── */
interface AdmissionEventItem {
  id: string;
  eventType: string;
  eventDate: string;
  eventTime: string | null;
  notes: string | null;
  financialNote: string | null;
  isNewPatient: boolean;
  admission: {
    patient: { name: string; emrPatientId: string };
    currentBed: { room: { name: string } } | null;
    attendingDoctor: { name: string } | null;
  };
  fromBed: { label: string; room: { name: string } } | null;
  toBed: { label: string; room: { name: string } } | null;
  doctor: { name: string; doctorCode: string } | null;
}

/* ── 이벤트 타입 라벨/색상 ── */
const EVENT_CONFIG: Record<string, { label: string; color: string; bgColor: string; Icon: typeof LogIn }> = {
  ADMITTED: { label: '입원', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200', Icon: LogIn },
  DISCHARGED: { label: '퇴원', color: 'text-red-700', bgColor: 'bg-red-50 border-red-200', Icon: LogOut },
  ADMIN_DISCHARGE: { label: '관리퇴원', color: 'text-red-700', bgColor: 'bg-red-50 border-red-200', Icon: LogOut },
  TRANSFERRED: { label: '전실', color: 'text-orange-700', bgColor: 'bg-orange-50 border-orange-200', Icon: ArrowRightLeft },
  LEAVE_START: { label: '외출', color: 'text-gray-600', bgColor: 'bg-gray-50 border-gray-200', Icon: LogOut },
  LEAVE_END: { label: '복귀', color: 'text-green-700', bgColor: 'bg-green-50 border-green-200', Icon: LogIn },
};

/* ── 날짜 헬퍼 ── */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0).getDate();
  const startDow = firstDay.getDay();
  return { lastDate, startDow };
}

export default function AdmissionLogPage() {
  const { accessToken } = useAuthStore();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [events, setEvents] = useState<AdmissionEventItem[]>([]);
  const [byDate, setByDate] = useState<Record<string, AdmissionEventItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ events: AdmissionEventItem[]; byDate: Record<string, AdmissionEventItem[]>; total: number }>(
        `/api/admissions/events?year=${year}&month=${month}`,
        { token: accessToken || undefined },
      );
      if (res.success && res.data) {
        setEvents(res.data.events);
        setByDate(res.data.byDate);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [year, month, accessToken]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const moveMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setYear(y);
    setMonth(m);
    setSelectedDate(null);
  };

  const { lastDate, startDow } = getMonthDays(year, month);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 달력 셀 생성
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // 통계
  const stats = {
    admitted: events.filter(e => e.eventType === 'ADMITTED').length,
    discharged: events.filter(e => e.eventType === 'DISCHARGED' || e.eventType === 'ADMIN_DISCHARGE').length,
    transferred: events.filter(e => e.eventType === 'TRANSFERRED').length,
  };

  const selectedEvents = selectedDate ? (byDate[selectedDate] || []) : [];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <BookOpen className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">입퇴원/전실 일지</h1>
            <p className="text-sm text-gray-500">월간 입원/퇴원/전실 이벤트 캘린더</p>
          </div>
        </div>

        {/* 월 네비게이션 */}
        <div className="flex items-center gap-2">
          <button onClick={() => moveMonth(-1)} className="p-2 rounded-lg hover:bg-gray-100">
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); }}
            className="px-3 py-1.5 text-sm bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 font-medium"
          >
            이번달
          </button>
          <span className="text-lg font-semibold text-gray-800 min-w-[120px] text-center">
            {year}년 {month}월
          </span>
          <button onClick={() => moveMonth(1)} className="p-2 rounded-lg hover:bg-gray-100">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.admitted}</div>
          <div className="text-sm text-blue-500">입원</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{stats.discharged}</div>
          <div className="text-sm text-red-500">퇴원</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">{stats.transferred}</div>
          <div className="text-sm text-orange-500">전실</div>
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}

      {!loading && (
        <div className="flex gap-5">
          {/* 캘린더 */}
          <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 bg-gray-50 border-b">
              {WEEKDAYS.map((d, i) => (
                <div key={d} className={`py-2 text-center text-sm font-semibold ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-600'}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7">
              {cells.map((day, idx) => {
                if (!day) {
                  return <div key={idx} className="min-h-[100px] border-b border-r border-gray-100 bg-gray-50/50" />;
                }

                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayEvents = byDate[dateStr] || [];
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;
                const dow = new Date(year, month - 1, day).getDay();

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                    className={`min-h-[100px] border-b border-r border-gray-100 p-1.5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-emerald-50 ring-2 ring-emerald-400 ring-inset' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className={`text-sm font-medium mb-1 ${
                      isToday ? 'w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs' :
                      dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'
                    }`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((ev) => {
                        const cfg = EVENT_CONFIG[ev.eventType] || EVENT_CONFIG.ADMITTED;
                        return (
                          <div key={ev.id} className={`text-xs px-1 py-0.5 rounded ${cfg.bgColor} border truncate`}>
                            <span className={`font-medium ${cfg.color}`}>[{cfg.label}]</span>
                            <span className="text-gray-600 ml-0.5">{ev.admission.patient.name}</span>
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div className="text-xs text-gray-400 text-center">+{dayEvents.length - 3}건</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 상세 패널 */}
          <div className="w-[360px] shrink-0">
            {selectedDate ? (
              <div className="bg-white border border-gray-200 rounded-xl">
                <div className="px-4 py-3 border-b bg-gray-50 rounded-t-xl">
                  <h3 className="font-semibold text-gray-800">
                    {new Date(selectedDate + 'T00:00:00').getMonth() + 1}/{new Date(selectedDate + 'T00:00:00').getDate()} ({WEEKDAYS[new Date(selectedDate + 'T00:00:00').getDay()]})
                    <span className="ml-2 text-sm font-normal text-gray-500">{selectedEvents.length}건</span>
                  </h3>
                </div>
                <div className="p-3 space-y-2 max-h-[600px] overflow-y-auto">
                  {selectedEvents.length === 0 && (
                    <div className="text-center text-gray-400 text-sm py-8">이벤트 없음</div>
                  )}
                  {selectedEvents.map((ev) => {
                    const cfg = EVENT_CONFIG[ev.eventType] || EVENT_CONFIG.ADMITTED;
                    const Icon = cfg.Icon;
                    return (
                      <div key={ev.id} className={`${cfg.bgColor} border rounded-lg p-3`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Icon size={14} className={cfg.color} />
                          <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                          {ev.eventTime && <span className="text-xs text-gray-500">{ev.eventTime}</span>}
                          {ev.isNewPatient && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">신환</span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-gray-800">
                          {ev.admission.patient.name}
                          <span className="text-xs text-gray-400 ml-1">{ev.admission.patient.emrPatientId}</span>
                        </div>
                        {ev.eventType === 'TRANSFERRED' && (
                          <div className="text-xs text-gray-600 mt-1">
                            {ev.fromBed ? `${ev.fromBed.room.name}-${ev.fromBed.label}` : '?'}
                            {' → '}
                            {ev.toBed ? `${ev.toBed.room.name}-${ev.toBed.label}` : '?'}
                          </div>
                        )}
                        {(ev.eventType === 'ADMITTED' && ev.toBed) && (
                          <div className="text-xs text-gray-600 mt-1">
                            배정: {ev.toBed.room.name}-{ev.toBed.label}
                          </div>
                        )}
                        {ev.doctor && (
                          <div className="text-xs text-gray-500 mt-1">
                            담당: {ev.doctor.name} ({ev.doctor.doctorCode})
                          </div>
                        )}
                        {ev.financialNote && (
                          <div className="text-xs text-purple-600 mt-1">{ev.financialNote}</div>
                        )}
                        {ev.notes && (
                          <div className="text-xs text-gray-500 mt-1">{ev.notes}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
                <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">날짜를 클릭하면<br />이벤트 상세를 볼 수 있습니다</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
