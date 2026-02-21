'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Table2,
  CalendarDays,
  CalendarRange,
  Calendar,
  Zap,
  Hand,
  ClipboardCheck,
  Stethoscope,
} from 'lucide-react';

/* ── 공통 헬퍼 ── */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateKR(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${weekday})`;
}

/* ── 타입 ── */
type ViewMode = 'table' | 'daily' | 'weekly' | 'monthly';

// Table 뷰
interface RoomBookingRow {
  roomName: string;
  bedLabel: string;
  bedId: string;
  bedStatus: string;
  patientName: string | null;
  patientId: string | null;
  admitDate: string | null;
  plannedDischargeDate: string | null;
  isFutureDischarge: boolean;
  doctorName: string | null;
  treatments: string[];
  admissionStatus: string | null;
}

// Daily 뷰
interface DailyBed {
  bedId: string;
  label: string;
  status: string;
  patient: {
    id: string;
    name: string;
    chartNumber: string;
    doctor: string;
    admitDate: string;
    plannedDischarge: string | null;
  } | null;
  schedules: {
    type: string;
    time: string;
    duration?: number;
    detail: string;
    codes?: string[];
  }[];
}

interface DailyRoom {
  roomId: string;
  roomName: string;
  ward: string;
  beds: DailyBed[];
}

// Weekly 뷰
interface WeeklyRoom {
  patientId: string;
  patientName: string;
  chartNumber: string;
  roomName: string;
  bedLabel: string;
  days: Record<string, { manual: number; rf: number; procedure: number; types: string[] }>;
}

// Monthly 뷰
interface MonthDay {
  date: string;
  admitted: number;
  discharged: number;
  inHospital: number;
}

/* ── 색상 ── */
const SCHEDULE_COLORS: Record<string, string> = {
  MANUAL: 'bg-purple-100 text-purple-700 border-purple-200',
  RF: 'bg-orange-100 text-orange-700 border-orange-200',
  PROCEDURE: 'bg-green-100 text-green-700 border-green-200',
  APPOINTMENT: 'bg-blue-100 text-blue-700 border-blue-200',
};

const SCHEDULE_ICONS: Record<string, typeof Zap> = {
  MANUAL: Hand,
  RF: Zap,
  PROCEDURE: ClipboardCheck,
  APPOINTMENT: Stethoscope,
};

/* ── 뷰 모드 탭 ── */
const VIEW_TABS: { key: ViewMode; label: string; icon: typeof Table2 }[] = [
  { key: 'table', label: '테이블', icon: Table2 },
  { key: 'daily', label: '일간', icon: CalendarDays },
  { key: 'weekly', label: '주간', icon: CalendarRange },
  { key: 'monthly', label: '월간', icon: Calendar },
];

export default function RoomBookingPage() {
  const { accessToken } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(() => toDateStr(new Date()));

  // Table 뷰 데이터
  const [rows, setRows] = useState<RoomBookingRow[]>([]);
  // Daily 뷰 데이터
  const [dailyRooms, setDailyRooms] = useState<DailyRoom[]>([]);
  // Weekly 뷰 데이터
  const [weeklyRooms, setWeeklyRooms] = useState<WeeklyRoom[]>([]);
  const [weekDates, setWeekDates] = useState<string[]>([]);
  // Monthly 뷰 데이터
  const [monthDays, setMonthDays] = useState<MonthDay[]>([]);
  const [monthYear, setMonthYear] = useState(() => new Date().getFullYear());
  const [monthMonth, setMonthMonth] = useState(() => new Date().getMonth() + 1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (viewMode === 'table') {
        const res = await api<{ rows: RoomBookingRow[] }>('/api/room-booking/table', { token: accessToken || undefined });
        if (res.success && res.data) setRows(res.data.rows || []);
      } else if (viewMode === 'daily') {
        const res = await api<{ date: string; rooms: DailyRoom[] }>(`/api/room-booking/daily?date=${date}`, { token: accessToken || undefined });
        if (res.success && res.data) setDailyRooms(res.data.rooms);
      } else if (viewMode === 'weekly') {
        const res = await api<{ weekDates: string[]; rooms: WeeklyRoom[] }>(`/api/room-booking/weekly?date=${date}`, { token: accessToken || undefined });
        if (res.success && res.data) {
          setWeeklyRooms(res.data.rooms);
          setWeekDates(res.data.weekDates);
        }
      } else if (viewMode === 'monthly') {
        const res = await api<{ year: number; month: number; days: MonthDay[] }>(`/api/room-booking/monthly?year=${monthYear}&month=${monthMonth}`, { token: accessToken || undefined });
        if (res.success && res.data) setMonthDays(res.data.days);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [viewMode, date, monthYear, monthMonth, accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const moveDate = (delta: number) => {
    if (viewMode === 'weekly') {
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() + delta * 7);
      setDate(toDateStr(d));
    } else {
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() + delta);
      setDate(toDateStr(d));
    }
  };

  const moveMonth = (delta: number) => {
    let y = monthYear;
    let m = monthMonth + delta;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonthYear(y);
    setMonthMonth(m);
  };

  // 테이블 뷰 통계
  const roomGroups: Record<string, RoomBookingRow[]> = {};
  for (const row of rows) {
    if (!roomGroups[row.roomName]) roomGroups[row.roomName] = [];
    roomGroups[row.roomName].push(row);
  }
  const totalBeds = rows.length;
  const occupied = rows.filter((r) => r.bedStatus === 'OCCUPIED').length;
  const empty = rows.filter((r) => r.bedStatus === 'EMPTY').length;
  const reserved = rows.filter((r) => r.bedStatus === 'RESERVED').length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-800">병실현황</h1>
        <div className="flex items-center gap-2">
          {/* 뷰 모드 탭 */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            {VIEW_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setViewMode(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${
                    viewMode === tab.key
                      ? 'bg-white text-indigo-600 shadow-sm font-medium'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 날짜 네비게이션 (daily/weekly/monthly) */}
      {viewMode !== 'table' && (
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => viewMode === 'monthly' ? moveMonth(-1) : moveDate(-1)} className="p-1.5 rounded hover:bg-gray-100">
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => {
              setDate(toDateStr(new Date()));
              setMonthYear(new Date().getFullYear());
              setMonthMonth(new Date().getMonth() + 1);
            }}
            className="px-3 py-1 text-sm bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium"
          >
            오늘
          </button>
          <span className="text-lg font-semibold text-gray-800">
            {viewMode === 'monthly'
              ? `${monthYear}년 ${monthMonth}월`
              : viewMode === 'weekly' && weekDates.length > 0
              ? `${formatDateKR(weekDates[0])} ~ ${formatDateKR(weekDates[weekDates.length - 1])}`
              : formatDateKR(date)}
          </span>
          <button onClick={() => viewMode === 'monthly' ? moveMonth(1) : moveDate(1)} className="p-1.5 rounded hover:bg-gray-100">
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}

      {/* ─── 테이블 뷰 ─── */}
      {!loading && viewMode === 'table' && (
        <>
          <div className="flex items-center gap-6 mb-4 bg-slate-50 rounded-lg px-4 py-3 text-sm">
            <span>전체 <strong className="text-slate-700">{totalBeds}</strong></span>
            <span>재원 <strong className="text-blue-600">{occupied}</strong></span>
            <span>빈 베드 <strong className="text-green-600">{empty}</strong></span>
            {reserved > 0 && <span>예약 <strong className="text-orange-500">{reserved}</strong></span>}
          </div>
          {rows.length === 0 ? (
            <div className="text-center py-12 text-slate-400">병실 데이터가 없습니다.</div>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-20">병실</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-14">베드</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-20">환자명</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-28">입원일</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-36">퇴원일(예정)</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-20">주치의</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-slate-600">치료내용</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(roomGroups).map(([roomName, beds]) =>
                    beds.map((row, idx) => {
                      const isOccupied = row.bedStatus === 'OCCUPIED';
                      const isEmpty = row.bedStatus === 'EMPTY';
                      const discharge = (() => {
                        if (!row.plannedDischargeDate) return { text: '-', className: 'text-slate-300' };
                        const planned = new Date(row.plannedDischargeDate + 'T00:00:00');
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        if (planned >= today) return { text: `${row.plannedDischargeDate} (예정)`, className: 'text-blue-600' };
                        return { text: `${row.plannedDischargeDate} (예정초과)`, className: 'text-red-500 font-medium' };
                      })();
                      return (
                        <tr key={row.bedId} className={`border-b ${isOccupied ? 'bg-white' : 'bg-slate-50/50'} hover:bg-blue-50/30`}>
                          {idx === 0 && (
                            <td rowSpan={beds.length} className="px-3 py-2 font-semibold text-slate-700 align-top border-r bg-slate-50/80">
                              {roomName}
                            </td>
                          )}
                          <td className="px-3 py-2 text-slate-500">{row.bedLabel}</td>
                          <td className="px-3 py-2">
                            {row.patientName ? (
                              <span className="font-medium text-slate-800">{row.patientName}</span>
                            ) : (
                              <span className={isEmpty ? 'text-green-500' : 'text-slate-300'}>
                                {isEmpty ? '(빈 베드)' : '-'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.admitDate || '-'}</td>
                          <td className={`px-3 py-2 ${discharge.className}`}>{discharge.text}</td>
                          <td className="px-3 py-2 text-slate-600">{row.doctorName || '-'}</td>
                          <td className="px-3 py-2">
                            {row.treatments.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {row.treatments.map((t, i) => (
                                  <span key={i} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{t}</span>
                                ))}
                              </div>
                            ) : <span className="text-slate-300">-</span>}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── 일간 뷰 ─── */}
      {!loading && viewMode === 'daily' && (
        <div className="space-y-4">
          {dailyRooms.map((room) => {
            const hasPatients = room.beds.some((b) => b.patient);
            if (!hasPatients) return null;
            return (
              <div key={room.roomId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b">
                  <span className="font-semibold text-gray-700">{room.roomName}</span>
                  <span className="text-xs text-gray-400 ml-2">{room.ward}</span>
                </div>
                <div className="divide-y">
                  {room.beds.map((bed) => {
                    if (!bed.patient) return null;
                    return (
                      <div key={bed.bedId} className="px-4 py-3">
                        <div className="flex items-center gap-4 mb-2">
                          <span className="text-xs text-gray-400 w-8">{bed.label}</span>
                          <span className="font-medium text-gray-800">{bed.patient.name}</span>
                          <span className="text-xs text-gray-400">{bed.patient.chartNumber}</span>
                          <span className="text-xs text-gray-500">주치의: {bed.patient.doctor || '-'}</span>
                          {bed.patient.plannedDischarge && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                              퇴원예정 {bed.patient.plannedDischarge}
                            </span>
                          )}
                        </div>
                        {bed.schedules.length > 0 ? (
                          <div className="flex flex-wrap gap-2 ml-12">
                            {bed.schedules.map((s, i) => {
                              const colorClass = SCHEDULE_COLORS[s.type] || SCHEDULE_COLORS.PROCEDURE;
                              const Icon = SCHEDULE_ICONS[s.type] || ClipboardCheck;
                              return (
                                <div key={i} className={`flex items-center gap-1.5 px-2.5 py-1 border rounded-lg text-xs ${colorClass}`}>
                                  <Icon size={12} />
                                  <span className="font-medium">{s.time}</span>
                                  <span>{s.detail}</span>
                                  {s.duration && <span className="opacity-60">({s.duration}분)</span>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="ml-12 text-xs text-gray-300">치료 스케줄 없음</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {dailyRooms.every((r) => r.beds.every((b) => !b.patient)) && (
            <div className="text-center py-12 text-gray-400">입원환자가 없습니다.</div>
          )}
        </div>
      )}

      {/* ─── 주간 뷰 ─── */}
      {!loading && viewMode === 'weekly' && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-16 sticky left-0 bg-gray-50 z-10">병실</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-20 sticky left-[64px] bg-gray-50 z-10">환자</th>
                {weekDates.map((d) => (
                  <th key={d} className="px-2 py-2.5 text-center font-semibold text-gray-600 min-w-[100px]">
                    {formatDateKR(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeklyRooms.length === 0 ? (
                <tr><td colSpan={2 + weekDates.length} className="text-center py-8 text-gray-400">데이터 없음</td></tr>
              ) : (
                weeklyRooms.map((room) => (
                  <tr key={room.patientId} className="border-b hover:bg-blue-50/30">
                    <td className="px-3 py-2 text-gray-500 text-xs sticky left-0 bg-white z-10">{room.roomName} {room.bedLabel}</td>
                    <td className="px-3 py-2 font-medium text-gray-800 sticky left-[64px] bg-white z-10">{room.patientName}</td>
                    {weekDates.map((d) => {
                      const day = room.days[d];
                      if (!day || (day.manual === 0 && day.rf === 0 && day.procedure === 0)) {
                        return <td key={d} className="px-2 py-2 text-center text-gray-200">-</td>;
                      }
                      return (
                        <td key={d} className="px-2 py-2">
                          <div className="flex flex-wrap gap-1 justify-center">
                            {day.manual > 0 && (
                              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                                도수 {day.manual}
                              </span>
                            )}
                            {day.rf > 0 && (
                              <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium">
                                RF {day.rf}
                              </span>
                            )}
                            {day.procedure > 0 && (
                              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                                처치 {day.procedure}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── 월간 뷰 ─── */}
      {!loading && viewMode === 'monthly' && (
        <div className="space-y-4">
          {/* 요약 */}
          {monthDays.length > 0 && (() => {
            const avgInHospital = Math.round(monthDays.reduce((s, d) => s + d.inHospital, 0) / monthDays.length);
            const totalAdmitted = monthDays.reduce((s, d) => s + d.admitted, 0);
            const totalDischarged = monthDays.reduce((s, d) => s + d.discharged, 0);
            return (
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{avgInHospital}</div>
                  <div className="text-sm text-blue-500">평균 재원환자</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{totalAdmitted}</div>
                  <div className="text-sm text-green-500">총 입원</div>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-orange-600">{totalDischarged}</div>
                  <div className="text-sm text-orange-500">총 퇴원</div>
                </div>
              </div>
            );
          })()}

          {/* 캘린더 히트맵 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['월', '화', '수', '목', '금', '토', '일'].map((d) => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {/* 첫 날 요일 오프셋 */}
              {(() => {
                const firstDay = new Date(monthYear, monthMonth - 1, 1).getDay();
                const offset = firstDay === 0 ? 6 : firstDay - 1;
                return Array.from({ length: offset }).map((_, i) => (
                  <div key={`off-${i}`} className="h-20" />
                ));
              })()}
              {monthDays.map((day) => {
                const d = new Date(day.date + 'T00:00:00');
                const isToday = day.date === toDateStr(new Date());
                const maxIn = Math.max(...monthDays.map((dd) => dd.inHospital), 1);
                const intensity = Math.round((day.inHospital / maxIn) * 4);
                const bgColor = intensity === 0 ? 'bg-gray-50' : intensity === 1 ? 'bg-blue-50' : intensity === 2 ? 'bg-blue-100' : intensity === 3 ? 'bg-blue-200' : 'bg-blue-300';

                return (
                  <div
                    key={day.date}
                    className={`${bgColor} rounded-lg p-2 h-20 ${isToday ? 'ring-2 ring-indigo-400' : 'border border-gray-100'}`}
                  >
                    <div className={`text-xs font-medium ${isToday ? 'text-indigo-600' : 'text-gray-600'}`}>
                      {d.getDate()}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      <div className="text-xs text-blue-600 font-medium">재원 {day.inHospital}</div>
                      {day.admitted > 0 && <div className="text-xs text-green-600">+{day.admitted} 입원</div>}
                      {day.discharged > 0 && <div className="text-xs text-orange-600">-{day.discharged} 퇴원</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
