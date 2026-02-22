'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  ChevronLeft,
  ChevronRight,
  Zap,
  Hand,
  Filter,
  CalendarDays,
  LayoutGrid,
  CalendarRange,
  AlertTriangle,
} from 'lucide-react';

// ─── Types ───

interface Room {
  id: string;
  name: string;
  displayOrder: number;
}

interface RfSlotData {
  id: string;
  patientId: string | null;
  patientName: string;
  emrPatientId: string;
  doctorCode: string;
  duration: number;
  patientType: string;
  status: string;
  notes: string | null;
  version: number;
  startMin: number;
  endMin: number;
  specialType?: string | null;
  isManualOverride?: boolean;
  patientNameRaw?: string | null;
}

interface Therapist {
  id: string;
  name: string;
}

interface ManualSlotData {
  id: string;
  patientId: string | null;
  patientName: string;
  emrPatientId: string;
  treatmentCodes: string[];
  sessionMarker: string | null;
  patientType: string;
  status: string;
  notes: string | null;
  version: number;
  treatmentSubtype?: string | null;
  statusNote?: string | null;
  isAdminWork?: boolean;
  adminWorkNote?: string | null;
  patientNameRaw?: string | null;
}

// RF Daily API response
interface RfDailyData {
  date: string;
  rooms: Room[];
  timeSlots: string[];
  grid: Record<string, Record<string, RfSlotData | 'OCCUPIED' | 'BUFFER'>>;
  staffNotes: { id: string; content: string; targetId: string | null }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
}

// Manual Weekly API response (used for daily extraction)
interface ManualWeeklyData {
  week: { start: string; end: string };
  therapists: (Therapist & { workSchedule: Record<string, boolean> | null })[];
  timeSlots: string[];
  grid: Record<string, Record<string, Record<string, ManualSlotData>>>;
  remarks: { id: string; date: string; content: string }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
}

// RF Weekly API response
interface RfWeeklyData {
  week: { start: string; end: string };
  rooms: Room[];
  days: Record<string, {
    total: number;
    byStatus: Record<string, number>;
    byRoom: Record<string, { count: number; slots: { startTime: string; duration: number; patientName: string; doctorCode: string; patientType: string; status: string }[] }>;
  }>;
  staffNotes: { id: string; date: string; content: string; targetId: string | null }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
}

// RF Monthly API response
interface RfMonthlyData {
  year: number;
  month: number;
  rooms: Room[];
  timeSlots: string[];
  weeks: { start: string; end: string; dates: string[] }[];
  grid: Record<string, Record<string, Record<string, RfSlotData | 'OCCUPIED' | 'BUFFER'>>>;
  staffNotes: { id: string; date: string; content: string }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
}

// Manual Monthly API response
interface ManualMonthlyData {
  year: number;
  month: number;
  therapists: (Therapist & { workSchedule: Record<string, boolean> | null })[];
  timeSlots: string[];
  weeks: { start: string; end: string; dates: string[] }[];
  grid: Record<string, Record<string, Record<string, ManualSlotData>>>;
  remarks: { id: string; date: string; content: string }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
}

// ─── Constants ───

type ViewMode = 'daily' | 'weekly' | 'monthly';
type RoomFilter = 'all' | '1-5' | '6-10' | '11-15';

const RF_TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30',
];

const MANUAL_TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30',
];

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const DOCTOR_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  'C': { border: 'border-l-blue-500', text: 'text-blue-700', bg: '#3b82f6' },
  'J': { border: 'border-l-green-500', text: 'text-green-700', bg: '#22c55e' },
};

const PATIENT_TYPE_BG: Record<string, string> = {
  INPATIENT: 'bg-yellow-100 border-yellow-300',
  OUTPATIENT: 'bg-white border-slate-200',
};

const STATUS_STYLES: Record<string, string> = {
  BOOKED: '',
  COMPLETED: 'bg-green-50 opacity-60',
  NO_SHOW: 'bg-red-50',
  CANCELLED: 'bg-red-100 line-through opacity-50',
  BLOCKED: 'bg-slate-100',
  WAITING: 'bg-blue-50',
  HOLD: 'bg-amber-50',
  LTU: 'bg-red-50',
};

const TREATMENT_SUBTYPE_ICONS: Record<string, string> = {
  '온': 'text-red-600',
  '림프': 'text-purple-600',
  '페인': 'text-blue-600',
  '도수': 'text-green-600',
  'SC': 'text-amber-600',
};

const ROOM_FILTER_RANGES: Record<RoomFilter, [number, number] | null> = {
  'all': null,
  '1-5': [1, 5],
  '6-10': [6, 10],
  '11-15': [11, 15],
};

// ─── Helpers ───

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(dateStr: string, offset: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offset);
  return toDateStr(d);
}

function shiftWeek(dateStr: string, offset: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offset * 7);
  return toDateStr(d);
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${DAY_NAMES[d.getDay()]})`;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getWeekLabel(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const weekNum = Math.ceil(s.getDate() / 7);
  return `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${weekNum}주차 (${start.slice(5).replace('-', '/')}~${end.slice(5).replace('-', '/')})`;
}

function getWeekDatesFromStart(start: string): string[] {
  const dates: string[] = [];
  const s = new Date(start + 'T00:00:00');
  for (let i = 0; i < 6; i++) {
    const dd = new Date(s);
    dd.setDate(s.getDate() + i);
    dates.push(toDateStr(dd));
  }
  return dates;
}

function getMonthCalendarDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

function getRfSlotStyle(slot: { patientType: string; status: string; doctorCode: string }) {
  const base = slot.status === 'CANCELLED' || slot.status === 'NO_SHOW'
    ? STATUS_STYLES[slot.status] || ''
    : `${PATIENT_TYPE_BG[slot.patientType] || 'bg-white border-slate-200'} ${STATUS_STYLES[slot.status] || ''}`;
  const dc = DOCTOR_COLORS[slot.doctorCode];
  return { className: base, borderColor: dc?.bg || '#94a3b8' };
}

function filterRooms(rooms: Room[], filter: RoomFilter): Room[] {
  const range = ROOM_FILTER_RANGES[filter];
  if (!range) return rooms;
  return rooms.filter(r => {
    const num = parseInt(r.name, 10);
    return !isNaN(num) && num >= range[0] && num <= range[1];
  });
}

function getFillRateColor(rate: number): string {
  if (rate >= 80) return 'bg-red-100 text-red-800';
  if (rate >= 50) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}

// ─── Main Page ───

export default function UnifiedSchedulingPage() {
  const { accessToken } = useAuthStore();
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL-driven state
  const initialView = (searchParams.get('view') as ViewMode) || 'daily';
  const initialDate = searchParams.get('date') || toDateStr(new Date());

  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [dateStr, setDateStr] = useState(initialDate);
  const [showRf, setShowRf] = useState(true);
  const [showManual, setShowManual] = useState(true);
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('all');
  const [loading, setLoading] = useState(true);

  // Daily data
  const [rfDaily, setRfDaily] = useState<RfDailyData | null>(null);
  const [manualWeekly, setManualWeekly] = useState<ManualWeeklyData | null>(null);

  // Weekly data
  const [rfWeekly, setRfWeekly] = useState<RfWeeklyData | null>(null);
  const [manualWeeklyFull, setManualWeeklyFull] = useState<ManualWeeklyData | null>(null);

  // Monthly data
  const [rfMonthly, setRfMonthly] = useState<RfMonthlyData | null>(null);
  const [manualMonthly, setManualMonthly] = useState<ManualMonthlyData | null>(null);

  // Month navigation
  const [monthYear, setMonthYear] = useState(() => {
    const d = initialDate ? new Date(initialDate + 'T00:00:00') : new Date();
    return d.getFullYear();
  });
  const [monthNum, setMonthNum] = useState(() => {
    const d = initialDate ? new Date(initialDate + 'T00:00:00') : new Date();
    return d.getMonth() + 1;
  });

  // Update URL when view/date changes
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('view', viewMode);
    if (viewMode === 'monthly') {
      params.set('date', `${monthYear}-${String(monthNum).padStart(2, '0')}-01`);
    } else {
      params.set('date', dateStr);
    }
    const newUrl = `?${params.toString()}`;
    if (newUrl !== `?${searchParams.toString()}`) {
      router.replace(`/dashboard/scheduling${newUrl}`, { scroll: false });
    }
  }, [viewMode, dateStr, monthYear, monthNum]);

  // ─── Fetch Daily ───
  const fetchDaily = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [rfRes, manualRes] = await Promise.all([
        showRf ? api<RfDailyData>(`/api/rf-schedule/daily?date=${dateStr}`, { token: accessToken }) : Promise.resolve(null),
        showManual ? api<ManualWeeklyData>(`/api/manual-therapy/weekly?date=${dateStr}`, { token: accessToken }) : Promise.resolve(null),
      ]);
      if (rfRes) setRfDaily(rfRes.data || null);
      else setRfDaily(null);
      if (manualRes) setManualWeekly(manualRes.data || null);
      else setManualWeekly(null);
    } catch (err: any) {
      console.error('Failed to load daily schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, dateStr, showRf, showManual]);

  // ─── Fetch Weekly ───
  const fetchWeekly = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [rfRes, manualRes] = await Promise.all([
        showRf ? api<RfWeeklyData>(`/api/rf-schedule/weekly?date=${dateStr}`, { token: accessToken }) : Promise.resolve(null),
        showManual ? api<ManualWeeklyData>(`/api/manual-therapy/weekly?date=${dateStr}`, { token: accessToken }) : Promise.resolve(null),
      ]);
      if (rfRes) setRfWeekly(rfRes.data || null);
      else setRfWeekly(null);
      if (manualRes) setManualWeeklyFull(manualRes.data || null);
      else setManualWeeklyFull(null);
    } catch (err: any) {
      console.error('Failed to load weekly schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, dateStr, showRf, showManual]);

  // ─── Fetch Monthly ───
  const fetchMonthly = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [rfRes, manualRes] = await Promise.all([
        showRf ? api<RfMonthlyData>(`/api/rf-schedule/monthly?year=${monthYear}&month=${monthNum}`, { token: accessToken }) : Promise.resolve(null),
        showManual ? api<ManualMonthlyData>(`/api/manual-therapy/monthly?year=${monthYear}&month=${monthNum}`, { token: accessToken }) : Promise.resolve(null),
      ]);
      if (rfRes) setRfMonthly(rfRes.data || null);
      else setRfMonthly(null);
      if (manualRes) setManualMonthly(manualRes.data || null);
      else setManualMonthly(null);
    } catch (err: any) {
      console.error('Failed to load monthly schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, monthYear, monthNum, showRf, showManual]);

  useEffect(() => {
    if (viewMode === 'daily') fetchDaily();
    else if (viewMode === 'weekly') fetchWeekly();
    else fetchMonthly();
  }, [viewMode, fetchDaily, fetchWeekly, fetchMonthly]);

  // ─── Navigation ───
  const goToday = () => setDateStr(toDateStr(new Date()));

  const shiftMonth = (offset: number) => {
    let y = monthYear, m = monthNum + offset;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonthYear(y);
    setMonthNum(m);
  };

  const navigateToDay = (d: string) => {
    setDateStr(d);
    setViewMode('daily');
  };

  const changeView = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'monthly') {
      const d = new Date(dateStr + 'T00:00:00');
      setMonthYear(d.getFullYear());
      setMonthNum(d.getMonth() + 1);
    }
  };

  // ─── Derived data for daily manual (extract single day from weekly response) ───
  const manualDailyTherapists = manualWeekly?.therapists || [];
  const manualDailyGrid: Record<string, Record<string, ManualSlotData>> = {};
  if (manualWeekly) {
    for (const t of manualDailyTherapists) {
      manualDailyGrid[t.id] = manualWeekly.grid[t.id]?.[dateStr] || {};
    }
  }

  // ─── Weekly data derivations ───
  const weekDates = rfWeekly
    ? getWeekDatesFromStart(rfWeekly.week.start)
    : manualWeeklyFull
      ? getWeekDatesFromStart(manualWeeklyFull.week.start)
      : [];

  // ─── Monthly calendar data ───
  const monthlyCalData = getMonthlyCalendarData(rfMonthly, manualMonthly);

  // ─── Filtered RF rooms ───
  const filteredRfRooms = rfDaily ? filterRooms(rfDaily.rooms, roomFilter) : [];

  return (
    <div className="space-y-4">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">통합 스케줄</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              고주파(RF) + 도수치료 통합 현황
            </p>
          </div>
          {/* View Tabs */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {([
              { mode: 'daily' as ViewMode, label: '일간', icon: CalendarDays },
              { mode: 'weekly' as ViewMode, label: '주간', icon: LayoutGrid },
              { mode: 'monthly' as ViewMode, label: '월간', icon: CalendarRange },
            ]).map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                onClick={() => changeView(mode)}
                className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition ${
                  viewMode === mode
                    ? 'bg-white text-blue-600 shadow-sm font-medium'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* RF / Manual toggles */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowRf(!showRf)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                showRf
                  ? 'bg-orange-100 border-orange-300 text-orange-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}
            >
              <Zap size={12} />
              RF 고주파
            </button>
            <button
              onClick={() => setShowManual(!showManual)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                showManual
                  ? 'bg-teal-100 border-teal-300 text-teal-700'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}
            >
              <Hand size={12} />
              도수치료
            </button>
          </div>

          {/* Room filter (daily RF only) */}
          {viewMode === 'daily' && showRf && (
            <div className="flex items-center gap-1">
              <Filter size={12} className="text-slate-400" />
              {(['all', '1-5', '6-10', '11-15'] as RoomFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setRoomFilter(f)}
                  className={`px-2 py-0.5 rounded text-xs transition ${
                    roomFilter === f
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {f === 'all' ? '전체' : `${f}번`}
                </button>
              ))}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="inline-block w-2.5 h-2.5 rounded bg-yellow-100 border border-yellow-300" /> 입원
            <span className="inline-block w-2.5 h-2.5 rounded bg-white border border-slate-300 ml-0.5" /> 외래
            <span className="inline-block w-1.5 h-2.5 rounded-sm ml-1" style={{ background: '#3b82f6' }} /> C
            <span className="inline-block w-1.5 h-2.5 rounded-sm ml-0.5" style={{ background: '#22c55e' }} /> J
          </div>
        </div>
      </div>

      {/* ═══ DATE NAVIGATION ═══ */}
      {viewMode === 'daily' && (
        <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
          <button onClick={() => setDateStr(shiftDay(dateStr, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-800">{formatDateFull(dateStr)}</span>
          </div>
          <button onClick={() => setDateStr(shiftDay(dateStr, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {viewMode === 'weekly' && (
        <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
          <button onClick={() => setDateStr(shiftWeek(dateStr, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-800">
              {rfWeekly ? getWeekLabel(rfWeekly.week.start, rfWeekly.week.end)
                : manualWeeklyFull ? getWeekLabel(manualWeeklyFull.week.start, manualWeeklyFull.week.end)
                : `${dateStr} 주간`}
            </span>
          </div>
          <button onClick={() => setDateStr(shiftWeek(dateStr, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {viewMode === 'monthly' && (
        <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
          <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-800">{monthYear}년 {monthNum}월</span>
          </div>
          <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="text-slate-400 text-sm">로딩 중...</div>
        </div>
      )}

      {/* ═══ DAILY VIEW ═══ */}
      {viewMode === 'daily' && !loading && (
        <>
          {/* RF Daily Grid */}
          {showRf && rfDaily && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Zap size={16} className="text-orange-500" />
                <h2 className="text-sm font-bold text-slate-800">고주파(RF) 스케줄</h2>
                <span className="text-xs text-slate-400">
                  예약 {rfDaily.stats.totalBooked} / 완료 {rfDaily.stats.totalCompleted} / 노쇼 {rfDaily.stats.noShows} / 취소 {rfDaily.stats.cancelled}
                </span>
              </div>
              <div className="bg-white rounded-lg border overflow-x-auto">
                <div style={{ minWidth: `${70 + filteredRfRooms.length * 90}px` }}>
                  {/* Header */}
                  <div
                    className="grid border-b-2 border-slate-300"
                    style={{ gridTemplateColumns: `70px repeat(${filteredRfRooms.length}, minmax(80px, 1fr))` }}
                  >
                    <div className="px-2 py-2 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">시간</div>
                    {filteredRfRooms.map((room) => (
                      <div key={room.id} className="px-1 py-2 text-center text-xs font-bold text-slate-700 border-r border-slate-200 last:border-r-0">
                        {room.name}번
                      </div>
                    ))}
                  </div>

                  {/* Time Rows */}
                  {RF_TIME_SLOTS.map((ts) => (
                    <div
                      key={ts}
                      className="grid border-b border-slate-100"
                      style={{ gridTemplateColumns: `70px repeat(${filteredRfRooms.length}, minmax(80px, 1fr))` }}
                    >
                      <div className="px-2 py-1 text-xs font-mono text-slate-500 border-r border-slate-200 flex items-center justify-center min-h-[34px]">
                        {ts}
                      </div>
                      {filteredRfRooms.map((room) => {
                        const cell = rfDaily.grid[room.id]?.[ts];

                        if (cell === 'OCCUPIED') {
                          return <div key={room.id} className="border-r border-slate-100 last:border-r-0 bg-orange-50/40 min-h-[34px]" />;
                        }
                        if (cell === 'BUFFER') {
                          return (
                            <div
                              key={room.id}
                              className="border-r border-slate-100 last:border-r-0 min-h-[34px]"
                              style={{ background: 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 3px, transparent 3px, transparent 8px)' }}
                            />
                          );
                        }

                        if (cell && typeof cell === 'object') {
                          const slot = cell as RfSlotData;
                          const isUnmatched = !slot.patientId && slot.patientNameRaw;
                          const style = getRfSlotStyle(slot);

                          if (slot.specialType === 'BLOCKED') {
                            return (
                              <div key={room.id} className="border-r border-slate-100 last:border-r-0 px-1 py-0.5 min-h-[34px] bg-slate-200 border">
                                <div className="text-[10px] text-slate-500 font-medium">BLOCKED</div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={room.id}
                              className={`border-r border-slate-100 last:border-r-0 cursor-pointer px-1 py-0.5 min-h-[34px] border-l-2 border ${style.className} ${
                                isUnmatched ? 'bg-orange-100 border-orange-300' : ''
                              }`}
                              style={{ borderLeftColor: style.borderColor }}
                              onClick={() => {
                                router.push(`/dashboard/scheduling/rf-schedule`);
                              }}
                            >
                              <div className="text-[11px] leading-tight">
                                <div className="flex items-center gap-1">
                                  <span className={`font-bold ${DOCTOR_COLORS[slot.doctorCode]?.text || 'text-slate-500'}`}>
                                    {slot.doctorCode}
                                  </span>
                                  <span className="font-semibold text-slate-900 truncate">
                                    {slot.patientName}
                                  </span>
                                  {isUnmatched && (
                                    <AlertTriangle size={10} className="text-orange-500 shrink-0" />
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">{slot.duration}분</div>
                              </div>
                            </div>
                          );
                        }

                        // Empty cell
                        return (
                          <div
                            key={room.id}
                            className="border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-orange-50/40 min-h-[34px] transition-colors border border-dashed border-transparent hover:border-orange-200"
                            onClick={() => {
                              router.push(`/dashboard/scheduling/rf-schedule`);
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Manual Daily Grid */}
          {showManual && manualWeekly && manualDailyTherapists.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Hand size={16} className="text-teal-500" />
                <h2 className="text-sm font-bold text-slate-800">도수치료 스케줄</h2>
                {manualWeekly.stats && (
                  <span className="text-xs text-slate-400">
                    예약 {manualWeekly.stats.totalBooked} / 완료 {manualWeekly.stats.totalCompleted} / 노쇼 {manualWeekly.stats.noShows} / 취소 {manualWeekly.stats.cancelled}
                  </span>
                )}
              </div>
              <div className="bg-white rounded-lg border overflow-x-auto">
                <div style={{ minWidth: `${70 + manualDailyTherapists.length * 120}px` }}>
                  {/* Header */}
                  <div
                    className="grid border-b-2 border-slate-300"
                    style={{ gridTemplateColumns: `70px repeat(${manualDailyTherapists.length}, minmax(100px, 1fr))` }}
                  >
                    <div className="px-2 py-2 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">시간</div>
                    {manualDailyTherapists.map((t) => (
                      <div key={t.id} className="px-1 py-2 text-center text-xs font-bold text-slate-700 border-r border-slate-200 last:border-r-0">
                        {t.name}
                      </div>
                    ))}
                  </div>

                  {/* Time Rows */}
                  {MANUAL_TIME_SLOTS.map((ts) => (
                    <div
                      key={ts}
                      className="grid border-b border-slate-100"
                      style={{ gridTemplateColumns: `70px repeat(${manualDailyTherapists.length}, minmax(100px, 1fr))` }}
                    >
                      <div className="px-2 py-1 text-xs font-mono text-slate-500 border-r border-slate-200 flex items-center justify-center min-h-[34px]">
                        {ts}
                      </div>
                      {manualDailyTherapists.map((t) => {
                        const slot = manualDailyGrid[t.id]?.[ts];

                        if (slot) {
                          const isUnmatched = !slot.patientId && slot.patientNameRaw;
                          const baseStyle = slot.status === 'CANCELLED' || slot.status === 'NO_SHOW'
                            ? STATUS_STYLES[slot.status] || ''
                            : `${PATIENT_TYPE_BG[slot.patientType] || 'bg-white border-slate-200'} ${STATUS_STYLES[slot.status] || ''}`;

                          if (slot.isAdminWork) {
                            return (
                              <div key={t.id} className="border-r border-slate-100 last:border-r-0 px-1 py-0.5 min-h-[34px] bg-slate-100 border cursor-pointer"
                                onClick={() => router.push('/dashboard/scheduling/manual-therapy')}>
                                <div className="text-[10px] text-slate-500 font-medium">{slot.adminWorkNote || '업무'}</div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={t.id}
                              className={`border-r border-slate-100 last:border-r-0 cursor-pointer px-1 py-0.5 min-h-[34px] border ${baseStyle} ${
                                isUnmatched ? 'bg-orange-100 border-orange-300' : ''
                              }`}
                              onClick={() => router.push('/dashboard/scheduling/manual-therapy')}
                            >
                              <div className="text-[11px] leading-tight">
                                <div className="flex items-center gap-0.5">
                                  <span className="font-semibold text-slate-900 truncate">{slot.patientName}</span>
                                  {slot.sessionMarker && (
                                    <span className={`text-[9px] font-bold shrink-0 ${
                                      slot.sessionMarker === 'IN' || slot.sessionMarker === 'IN20' ? 'text-emerald-600'
                                        : slot.sessionMarker === 'W1' || slot.sessionMarker === 'W2' ? 'text-blue-600'
                                        : slot.sessionMarker === 'LTU' ? 'text-red-600'
                                        : 'text-slate-500'
                                    }`}>
                                      {slot.sessionMarker}
                                    </span>
                                  )}
                                  {isUnmatched && <AlertTriangle size={10} className="text-orange-500 shrink-0" />}
                                </div>
                                {slot.treatmentCodes && slot.treatmentCodes.length > 0 && (
                                  <div className="flex gap-0.5 mt-0.5">
                                    {slot.treatmentCodes.map((code) => (
                                      <span
                                        key={code}
                                        className={`text-[9px] font-medium ${TREATMENT_SUBTYPE_ICONS[code] || 'text-slate-400'}`}
                                      >
                                        {code}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }

                        // Empty cell
                        return (
                          <div
                            key={t.id}
                            className="border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-teal-50/40 min-h-[34px] transition-colors border border-dashed border-transparent hover:border-teal-200"
                            onClick={() => router.push('/dashboard/scheduling/manual-therapy')}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* No data states */}
          {!loading && !showRf && !showManual && (
            <div className="text-center py-16 text-slate-400 text-sm">
              표시할 항목을 선택해주세요 (RF 고주파 또는 도수치료)
            </div>
          )}
        </>
      )}

      {/* ═══ WEEKLY VIEW ═══ */}
      {viewMode === 'weekly' && !loading && (
        <>
          {/* RF Weekly Summary */}
          {showRf && rfWeekly && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Zap size={16} className="text-orange-500" />
                <h2 className="text-sm font-bold text-slate-800">고주파(RF) 주간 현황</h2>
                {rfWeekly.stats && (
                  <span className="text-xs text-slate-400">
                    예약 {rfWeekly.stats.totalBooked} / 완료 {rfWeekly.stats.totalCompleted} / 노쇼 {rfWeekly.stats.noShows} / 취소 {rfWeekly.stats.cancelled}
                  </span>
                )}
              </div>
              <div className="bg-white rounded-lg border overflow-x-auto">
                <div style={{ minWidth: '700px' }}>
                  {/* Header */}
                  <div className="grid border-b-2 border-slate-300" style={{ gridTemplateColumns: '60px repeat(6, 1fr)' }}>
                    <div className="px-2 py-2 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">기계</div>
                    {weekDates.map((d, i) => {
                      const dayData = rfWeekly.days?.[d];
                      const isToday = d === toDateStr(new Date());
                      const dayName = DAY_NAMES[new Date(d + 'T00:00:00').getDay()];
                      return (
                        <div
                          key={d}
                          onClick={() => navigateToDay(d)}
                          className={`px-1 py-2 text-center border-r border-slate-200 last:border-r-0 cursor-pointer hover:bg-blue-50 transition ${isToday ? 'bg-blue-50' : ''}`}
                        >
                          <div className="text-xs font-bold text-slate-700">{dayName} ({d.slice(8)}일)</div>
                          {dayData && <div className="text-[10px] text-slate-400 mt-0.5">총 {dayData.total}건</div>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Room rows */}
                  {rfWeekly.rooms.map((room) => (
                    <div key={room.id} className="grid border-b border-slate-100" style={{ gridTemplateColumns: '60px repeat(6, 1fr)' }}>
                      <div className="px-1 py-1 text-xs font-bold text-slate-700 border-r border-slate-200 flex items-center justify-center bg-slate-50">
                        {room.name}번
                      </div>
                      {weekDates.map((d) => {
                        const roomDay = rfWeekly.days?.[d]?.byRoom?.[room.id];
                        if (!roomDay || roomDay.count === 0) {
                          return (
                            <div key={d} onClick={() => navigateToDay(d)}
                              className="px-1 py-1 border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-blue-50/40 min-h-[36px]" />
                          );
                        }
                        const unmatchedCount = roomDay.slots?.filter((s: any) => s.patientName === '(미매칭)').length || 0;
                        return (
                          <div key={d} onClick={() => navigateToDay(d)}
                            className="px-1 py-1 border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-blue-50/40 min-h-[36px]">
                            {roomDay.slots?.slice(0, 3).map((s: any, si: number) => (
                              <div
                                key={si}
                                className={`text-[10px] leading-tight truncate px-0.5 rounded ${
                                  s.patientType === 'INPATIENT' ? 'bg-yellow-50' : ''
                                } ${s.status === 'CANCELLED' ? 'line-through text-red-400' : 'text-slate-600'}`}
                              >
                                <span className={`font-bold ${s.doctorCode === 'C' ? 'text-blue-600' : s.doctorCode === 'J' ? 'text-green-600' : ''}`}>
                                  {s.doctorCode}
                                </span>{' '}
                                {s.patientName}
                              </div>
                            ))}
                            {(roomDay.slots?.length || 0) > 3 && (
                              <div className="text-[10px] text-slate-400">+{roomDay.slots.length - 3}건</div>
                            )}
                            {unmatchedCount > 0 && (
                              <div className="text-[9px] text-orange-500 font-medium mt-0.5">
                                <AlertTriangle size={8} className="inline" /> {unmatchedCount}미매칭
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Manual Weekly Summary */}
          {showManual && manualWeeklyFull && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Hand size={16} className="text-teal-500" />
                <h2 className="text-sm font-bold text-slate-800">도수치료 주간 현황</h2>
                {manualWeeklyFull.stats && (
                  <span className="text-xs text-slate-400">
                    예약 {manualWeeklyFull.stats.totalBooked} / 완료 {manualWeeklyFull.stats.totalCompleted} / 노쇼 {manualWeeklyFull.stats.noShows} / 취소 {manualWeeklyFull.stats.cancelled}
                  </span>
                )}
              </div>
              <div className="bg-white rounded-lg border overflow-x-auto">
                <div style={{ minWidth: '700px' }}>
                  {/* Header */}
                  <div className="grid border-b-2 border-slate-300" style={{ gridTemplateColumns: '80px repeat(6, 1fr)' }}>
                    <div className="px-2 py-2 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">치료사</div>
                    {weekDates.map((d) => {
                      const isToday = d === toDateStr(new Date());
                      const dayName = DAY_NAMES[new Date(d + 'T00:00:00').getDay()];
                      return (
                        <div
                          key={d}
                          onClick={() => navigateToDay(d)}
                          className={`px-1 py-2 text-center border-r border-slate-200 last:border-r-0 cursor-pointer hover:bg-teal-50 transition ${isToday ? 'bg-teal-50' : ''}`}
                        >
                          <div className="text-xs font-bold text-slate-700">{dayName} ({d.slice(8)}일)</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Therapist rows */}
                  {manualWeeklyFull.therapists.map((therapist) => (
                    <div key={therapist.id} className="grid border-b border-slate-100" style={{ gridTemplateColumns: '80px repeat(6, 1fr)' }}>
                      <div className="px-1 py-1 text-xs font-bold text-slate-700 border-r border-slate-200 flex items-center justify-center bg-slate-50">
                        {therapist.name}
                      </div>
                      {weekDates.map((d) => {
                        const daySlots = manualWeeklyFull.grid[therapist.id]?.[d] || {};
                        const slotEntries = Object.values(daySlots);
                        const bookedCount = slotEntries.filter((s: any) => s.status !== 'CANCELLED').length;
                        const unmatchedCount = slotEntries.filter((s: any) => !s.patientId && s.patientNameRaw).length;

                        if (bookedCount === 0) {
                          return (
                            <div key={d} onClick={() => navigateToDay(d)}
                              className="px-1 py-1 border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-teal-50/40 min-h-[36px]" />
                          );
                        }
                        return (
                          <div key={d} onClick={() => navigateToDay(d)}
                            className="px-1 py-1 border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-teal-50/40 min-h-[36px]">
                            {slotEntries.slice(0, 3).map((s: any, si: number) => (
                              <div
                                key={si}
                                className={`text-[10px] leading-tight truncate px-0.5 rounded ${
                                  s.patientType === 'INPATIENT' ? 'bg-yellow-50' : ''
                                } ${s.status === 'CANCELLED' ? 'line-through text-red-400' : 'text-slate-600'}`}
                              >
                                <span className="font-medium">{s.patientName}</span>
                                {s.sessionMarker && <span className="text-[9px] text-blue-500 ml-0.5">{s.sessionMarker}</span>}
                              </div>
                            ))}
                            {slotEntries.length > 3 && (
                              <div className="text-[10px] text-slate-400">+{slotEntries.length - 3}건</div>
                            )}
                            {unmatchedCount > 0 && (
                              <div className="text-[9px] text-orange-500 font-medium mt-0.5">
                                <AlertTriangle size={8} className="inline" /> {unmatchedCount}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ MONTHLY VIEW ═══ */}
      {viewMode === 'monthly' && !loading && (
        <div className="bg-white rounded-lg border">
          {/* Calendar header */}
          <div className="grid grid-cols-7 border-b">
            {DAY_NAMES.map((d, i) => (
              <div
                key={d}
                className={`py-2 text-center text-xs font-semibold ${
                  i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar body */}
          <div className="grid grid-cols-7">
            {getMonthCalendarDays(monthYear, monthNum).map((day, i) => {
              if (!day) {
                return <div key={`e-${i}`} className="p-2 min-h-[90px] border-b border-r border-slate-100 bg-slate-50/50" />;
              }

              const dd = new Date(day + 'T00:00:00');
              const isToday = day === toDateStr(new Date());
              const isSun = dd.getDay() === 0;
              const isSat = dd.getDay() === 6;
              const dayData = monthlyCalData[day];

              const rfCount = dayData?.rfBooked || 0;
              const manualCount = dayData?.manualBooked || 0;
              const rfUnmatched = dayData?.rfUnmatched || 0;
              const manualUnmatched = dayData?.manualUnmatched || 0;
              const totalUnmatched = rfUnmatched + manualUnmatched;
              const rfTotal = dayData?.rfTotal || 0;
              const manualTotal = dayData?.manualTotal || 0;

              // Fill rate for color coding
              const totalBooked = rfCount + manualCount;
              const totalSlots = rfTotal + manualTotal;
              const fillRate = totalSlots > 0 ? Math.round((totalBooked / totalSlots) * 100) : 0;

              return (
                <div
                  key={day}
                  onClick={() => navigateToDay(day)}
                  className={`p-1.5 min-h-[90px] border-b border-r border-slate-100 cursor-pointer hover:bg-blue-50/50 transition ${
                    isToday ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className={`text-xs font-semibold mb-1 ${
                    isToday ? 'text-blue-600' : isSun ? 'text-red-500' : isSat ? 'text-blue-500' : 'text-slate-700'
                  }`}>
                    {dd.getDate()}
                  </div>

                  {(rfCount > 0 || manualCount > 0) && (
                    <div className="space-y-0.5">
                      {showRf && rfCount > 0 && (
                        <div className="flex items-center gap-1">
                          <Zap size={10} className="text-orange-400 shrink-0" />
                          <span className="text-[10px] text-slate-600">
                            <span className="font-bold text-orange-600">{rfCount}</span>
                            {rfTotal > 0 && <span className="text-slate-400">/{rfTotal}</span>}
                          </span>
                        </div>
                      )}
                      {showManual && manualCount > 0 && (
                        <div className="flex items-center gap-1">
                          <Hand size={10} className="text-teal-400 shrink-0" />
                          <span className="text-[10px] text-slate-600">
                            <span className="font-bold text-teal-600">{manualCount}</span>
                            {manualTotal > 0 && <span className="text-slate-400">/{manualTotal}</span>}
                          </span>
                        </div>
                      )}
                      {totalUnmatched > 0 && (
                        <div className="flex items-center gap-0.5">
                          <AlertTriangle size={9} className="text-orange-400 shrink-0" />
                          <span className="text-[9px] text-orange-500 font-medium">{totalUnmatched}</span>
                        </div>
                      )}
                      {totalSlots > 0 && (
                        <div className={`text-[9px] font-bold px-1 py-0.5 rounded text-center mt-0.5 ${getFillRateColor(fillRate)}`}>
                          {fillRate}%
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Monthly Legend */}
          <div className="px-4 py-2 border-t bg-slate-50 flex items-center gap-4 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><Zap size={10} className="text-orange-400" /> RF 예약수/슬롯</span>
            <span className="flex items-center gap-1"><Hand size={10} className="text-teal-400" /> 도수 예약수/슬롯</span>
            <span className="flex items-center gap-1"><AlertTriangle size={10} className="text-orange-400" /> 미매칭</span>
            <span className="flex items-center gap-2 ml-2">
              점유율:
              <span className="px-1 rounded bg-green-100 text-green-800">~50%</span>
              <span className="px-1 rounded bg-yellow-100 text-yellow-800">50~80%</span>
              <span className="px-1 rounded bg-red-100 text-red-800">80%+</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Monthly Calendar Data Extraction ───

function getMonthlyCalendarData(
  rfMonthly: RfMonthlyData | null,
  manualMonthly: ManualMonthlyData | null,
): Record<string, {
  rfBooked: number;
  rfCompleted: number;
  rfBlocked: number;
  rfUnmatched: number;
  rfTotal: number;
  manualBooked: number;
  manualCompleted: number;
  manualLtu: number;
  manualUnmatched: number;
  manualAdminWork: number;
  manualTotal: number;
}> {
  const result: Record<string, any> = {};

  const ensureDay = (d: string) => {
    if (!result[d]) {
      result[d] = {
        rfBooked: 0, rfCompleted: 0, rfBlocked: 0, rfUnmatched: 0, rfTotal: 0,
        manualBooked: 0, manualCompleted: 0, manualLtu: 0, manualUnmatched: 0, manualAdminWork: 0, manualTotal: 0,
      };
    }
  };

  // Extract RF counts from monthly grid
  if (rfMonthly) {
    for (const roomId of Object.keys(rfMonthly.grid || {})) {
      for (const dateStr of Object.keys(rfMonthly.grid[roomId] || {})) {
        for (const ts of Object.keys(rfMonthly.grid[roomId][dateStr] || {})) {
          const cell = rfMonthly.grid[roomId][dateStr][ts];
          if (cell && typeof cell === 'object') {
            ensureDay(dateStr);
            const slot = cell as RfSlotData;
            result[dateStr].rfTotal++;
            if (slot.status === 'BOOKED') result[dateStr].rfBooked++;
            else if (slot.status === 'COMPLETED') { result[dateStr].rfBooked++; result[dateStr].rfCompleted++; }
            else if (slot.specialType === 'BLOCKED') result[dateStr].rfBlocked++;
            if (!slot.patientId && slot.patientNameRaw) result[dateStr].rfUnmatched++;
          }
        }
      }
    }
  }

  // Extract Manual counts from monthly grid
  if (manualMonthly) {
    for (const therapistId of Object.keys(manualMonthly.grid || {})) {
      for (const dateStr of Object.keys(manualMonthly.grid[therapistId] || {})) {
        for (const ts of Object.keys(manualMonthly.grid[therapistId][dateStr] || {})) {
          const slot = manualMonthly.grid[therapistId][dateStr][ts] as ManualSlotData;
          if (slot) {
            ensureDay(dateStr);
            result[dateStr].manualTotal++;
            if (slot.status === 'BOOKED') result[dateStr].manualBooked++;
            else if (slot.status === 'COMPLETED') { result[dateStr].manualBooked++; result[dateStr].manualCompleted++; }
            if (slot.sessionMarker === 'LTU') result[dateStr].manualLtu++;
            if (slot.isAdminWork) result[dateStr].manualAdminWork++;
            if (!slot.patientId && slot.patientNameRaw) result[dateStr].manualUnmatched++;
          }
        }
      }
    }
  }

  return result;
}
