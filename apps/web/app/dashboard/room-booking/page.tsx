'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

type ViewMode = 'daily' | 'weekly' | 'monthly';

interface RoomDailyData {
  roomName: string;
  bedCount: number;
  beds: Array<{
    id: string;
    name: string;
    status: string;
    patientName: string | null;
    admissionStatus: string | null;
  }>;
  treatments: Array<{
    type: string;
    patientName: string;
    time: string;
    duration?: number;
  }>;
}

interface AvailabilityData {
  roomName: string;
  totalBeds: number;
  emptyBeds: number;
  availableDate: string | null;
  beds: Array<{ name: string; status: string; patientName: string | null; plannedDischarge: string | null }>;
}

interface MonthlyDay {
  date: string;
  inHospital: number;
  admitted: number;
  discharged: number;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RoomBookingPage() {
  const { accessToken } = useAuthStore();
  const [view, setView] = useState<ViewMode>('daily');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);

  // Daily data
  const [dailyRooms, setDailyRooms] = useState<RoomDailyData[]>([]);
  // Weekly data
  const [weeklyData, setWeeklyData] = useState<any>(null);
  // Monthly data
  const [monthlyDays, setMonthlyDays] = useState<MonthlyDay[]>([]);
  // Availability
  const [availability, setAvailability] = useState<AvailabilityData[]>([]);

  const fetchDaily = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/room-booking/daily?date=${date}`, { token: accessToken || undefined });
      if (res.success) setDailyRooms(res.data.rooms || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [date, accessToken]);

  const fetchWeekly = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/room-booking/weekly?date=${date}`, { token: accessToken || undefined });
      if (res.success) setWeeklyData(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [date, accessToken]);

  const fetchMonthly = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/room-booking/monthly?year=${year}&month=${month}`, { token: accessToken || undefined });
      if (res.success) setMonthlyDays(res.data.days || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [year, month, accessToken]);

  const fetchAvailability = useCallback(async () => {
    try {
      const res = await api('/api/room-booking/availability', { token: accessToken || undefined });
      if (res.success) setAvailability(res.data.rooms || []);
    } catch { /* ignore */ }
  }, [accessToken]);

  useEffect(() => {
    if (view === 'daily') { fetchDaily(); fetchAvailability(); }
    else if (view === 'weekly') fetchWeekly();
    else fetchMonthly();
  }, [view, fetchDaily, fetchWeekly, fetchMonthly, fetchAvailability]);

  const navigateDate = (delta: number) => {
    const d = new Date(date);
    if (view === 'weekly') d.setDate(d.getDate() + delta * 7);
    else d.setDate(d.getDate() + delta);
    setDate(toDateStr(d));
  };

  const navigateMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m);
    setYear(y);
  };

  const dayLabel = (() => {
    const d = new Date(date + 'T00:00:00');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${date} (${days[d.getDay()]})`;
  })();

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">병실예약현황</h1>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['daily', 'weekly', 'monthly'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                view === v ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {v === 'daily' ? '일간' : v === 'weekly' ? '주간' : '월간'}
            </button>
          ))}
        </div>
      </div>

      {/* 날짜 네비게이션 */}
      <div className="flex items-center gap-3 mb-4">
        {view !== 'monthly' ? (
          <>
            <button onClick={() => navigateDate(-1)} className="p-1.5 rounded hover:bg-slate-100"><ChevronLeft size={20} /></button>
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-slate-400" />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-3 py-1.5 text-sm" />
              <span className="text-sm text-slate-500">{dayLabel}</span>
            </div>
            <button onClick={() => navigateDate(1)} className="p-1.5 rounded hover:bg-slate-100"><ChevronRight size={20} /></button>
          </>
        ) : (
          <>
            <button onClick={() => navigateMonth(-1)} className="p-1.5 rounded hover:bg-slate-100"><ChevronLeft size={20} /></button>
            <span className="text-lg font-semibold">{year}년 {month}월</span>
            <button onClick={() => navigateMonth(1)} className="p-1.5 rounded hover:bg-slate-100"><ChevronRight size={20} /></button>
          </>
        )}
        <button onClick={() => { setDate(toDateStr(new Date())); setYear(new Date().getFullYear()); setMonth(new Date().getMonth() + 1); }}
          className="ml-2 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
          오늘
        </button>
      </div>

      {loading && <div className="text-center py-8 text-slate-400">불러오는 중...</div>}

      {/* ────── 일간 뷰 ────── */}
      {view === 'daily' && !loading && (
        <div className="space-y-6">
          {/* 병실 가용성 요약 */}
          {availability.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {availability.map((room) => (
                <div key={room.roomName} className={`rounded-lg border p-3 ${room.emptyBeds > 0 ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="font-semibold text-sm">{room.roomName}</div>
                  <div className={`text-lg font-bold ${room.emptyBeds > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                    {room.emptyBeds}/{room.totalBeds} 가용
                  </div>
                  {room.availableDate && room.emptyBeds === 0 && (
                    <div className="text-xs text-slate-500">{room.availableDate} 예정</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 병실별 현황 */}
          {dailyRooms.length === 0 && <div className="text-center py-12 text-slate-400">데이터가 없습니다.</div>}
          {dailyRooms.map((room) => (
            <div key={room.roomName} className="border rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b">
                <span className="font-semibold">{room.roomName}</span>
                <span className="text-sm text-slate-500">베드 {room.bedCount}개</span>
              </div>
              <div className="p-4">
                {/* 베드 현황 */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-3">
                  {room.beds.map((bed) => (
                    <div key={bed.id} className={`text-sm px-3 py-2 rounded border ${
                      bed.status === 'EMPTY' ? 'bg-green-50 border-green-200 text-green-700' :
                      bed.status === 'OCCUPIED' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                      'bg-slate-50 border-slate-200 text-slate-500'
                    }`}>
                      <div className="font-medium">{bed.name}</div>
                      {bed.patientName && <div className="text-xs">{bed.patientName}</div>}
                    </div>
                  ))}
                </div>
                {/* 치료 스케줄 */}
                {room.treatments.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-400 mb-1">오늘 치료</div>
                    <div className="flex flex-wrap gap-1">
                      {room.treatments.map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs">
                          <span className="font-medium">{t.patientName}</span>
                          <span className="text-slate-400">{t.type} {t.time}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ────── 주간 뷰 ────── */}
      {view === 'weekly' && !loading && weeklyData && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2 text-left font-medium text-slate-500 w-24">병실</th>
                {weeklyData.dates?.map((d: string) => {
                  const dt = new Date(d + 'T00:00:00');
                  const days = ['일', '월', '화', '수', '목', '금', '토'];
                  const isToday = d === toDateStr(new Date());
                  return (
                    <th key={d} className={`px-3 py-2 text-center font-medium ${isToday ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}>
                      {d.slice(5)} ({days[dt.getDay()]})
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {weeklyData.rooms?.map((room: any) => (
                <tr key={room.roomName} className="border-b hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium">{room.roomName}</td>
                  {weeklyData.dates?.map((d: string) => {
                    const cell = room.days?.[d];
                    return (
                      <td key={d} className="px-3 py-2 text-center">
                        {cell?.patients?.length > 0 ? (
                          <div className="space-y-0.5">
                            {cell.patients.slice(0, 3).map((p: any, i: number) => (
                              <div key={i} className="text-xs truncate">{p.name}</div>
                            ))}
                            {cell.treatmentCount > 0 && (
                              <span className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">{cell.treatmentCount}건</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ────── 월간 뷰 ────── */}
      {view === 'monthly' && !loading && (
        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 bg-slate-50 border-b">
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <div key={d} className="px-2 py-2 text-center text-sm font-medium text-slate-500">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {(() => {
              const firstDay = new Date(year, month - 1, 1).getDay();
              const daysInMonth = new Date(year, month, 0).getDate();
              const cells = [];

              for (let i = 0; i < firstDay; i++) {
                cells.push(<div key={`e-${i}`} className="p-2 border-b border-r min-h-[80px]" />);
              }

              for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dayData = monthlyDays.find((md) => md.date === dateStr);
                const isToday = dateStr === toDateStr(new Date());

                cells.push(
                  <div key={d} className={`p-2 border-b border-r min-h-[80px] ${isToday ? 'bg-blue-50' : ''}`}>
                    <div className={`text-sm font-medium mb-1 ${isToday ? 'text-blue-600' : ''}`}>{d}</div>
                    {dayData && (
                      <div className="space-y-0.5 text-xs">
                        <div className="text-blue-600">재원 {dayData.inHospital}</div>
                        {dayData.admitted > 0 && <div className="text-green-600">+입원 {dayData.admitted}</div>}
                        {dayData.discharged > 0 && <div className="text-red-500">-퇴원 {dayData.discharged}</div>}
                      </div>
                    )}
                  </div>,
                );
              }

              return cells;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
