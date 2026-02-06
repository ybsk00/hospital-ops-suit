'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  CalendarClock,
  Search,
  UserCheck,
  CheckCircle,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  XCircle,
  AlertTriangle,
  LayoutGrid,
  List,
  Eye,
} from 'lucide-react';
import AppointmentModal from './AppointmentModal';
import AppointmentDetailModal from './AppointmentDetailModal';
import ConflictResolver from './ConflictResolver';

// ============================================================
// Types
// ============================================================

interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
}

interface ClinicRoom {
  id: string;
  name: string;
  doctorId: string | null;
}

interface Patient {
  id: string;
  name: string;
  emrPatientId: string;
  dob: string | null;
  sex: string | null;
}

interface Appointment {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  conflictFlag: boolean;
  notes: string | null;
  version: number;
  patient: { id: string; name: string; emrPatientId: string; dob?: string; sex?: string };
  doctor: { id: string; name: string; specialty: string | null };
  clinicRoom: { id: string; name: string } | null;
}

// ============================================================
// Constants
// ============================================================

const statusLabels: Record<string, string> = {
  BOOKED: '예약됨',
  CHECKED_IN: '접수완료',
  COMPLETED: '진료완료',
  CANCELLED: '취소',
  NO_SHOW: '미방문',
  CHANGED: '변경됨',
};

const statusColors: Record<string, string> = {
  BOOKED: 'bg-blue-100 text-blue-700 border-blue-200',
  CHECKED_IN: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  COMPLETED: 'bg-slate-100 text-slate-500 border-slate-200',
  CANCELLED: 'bg-red-50 text-red-500 border-red-200',
  NO_SHOW: 'bg-orange-100 text-orange-600 border-orange-200',
  CHANGED: 'bg-purple-100 text-purple-600 border-purple-200',
};

const statusCalendarColors: Record<string, string> = {
  BOOKED: 'bg-blue-500 border-blue-600 text-white',
  CHECKED_IN: 'bg-emerald-500 border-emerald-600 text-white',
  COMPLETED: 'bg-slate-300 border-slate-400 text-slate-700',
  CANCELLED: 'bg-red-200 border-red-300 text-red-700 line-through opacity-50',
  NO_SHOW: 'bg-orange-300 border-orange-400 text-orange-800',
  CHANGED: 'bg-purple-400 border-purple-500 text-white',
};

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 08:00 ~ 19:00

// ============================================================
// Helper functions
// ============================================================

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatKoreanDate(date: Date): string {
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getWeekDates(baseDate: Date): Date[] {
  const day = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ============================================================
// Main Component
// ============================================================

export default function AppointmentsPage() {
  const { accessToken } = useAuthStore();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [clinicRooms, setClinicRooms] = useState<ClinicRoom[]>([]);
  const [loading, setLoading] = useState(true);

  // View controls
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'list'>('day');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editAppointment, setEditAppointment] = useState<Appointment | null>(null);
  const [detailAppointment, setDetailAppointment] = useState<Appointment | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);

  // Summary
  const [summary, setSummary] = useState<Record<string, number>>({});

  // ── Fetch doctors & clinic rooms ──
  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      api<Doctor[]>('/api/appointments/doctors', { token: accessToken }),
      api<ClinicRoom[]>('/api/appointments/clinic-rooms', { token: accessToken }),
    ]).then(([docRes, roomRes]) => {
      setDoctors(docRes.data || []);
      setClinicRooms(roomRes.data || []);
    });
  }, [accessToken]);

  // ── Fetch appointments ──
  const fetchAppointments = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });

      if (viewMode === 'week') {
        const weekDates = getWeekDates(currentDate);
        params.set('startDate', formatDate(weekDates[0]));
        params.set('endDate', formatDate(weekDates[6]));
      } else {
        params.set('date', formatDate(currentDate));
      }

      if (selectedDoctorId !== 'all') params.set('doctorId', selectedDoctorId);
      if (searchQuery) params.set('search', searchQuery);

      const res = await api<{ appointments: Appointment[] }>(`/api/appointments?${params}`, { token: accessToken });
      setAppointments(res.data?.appointments || []);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, currentDate, viewMode, selectedDoctorId, searchQuery]);

  // ── Fetch summary ──
  const fetchSummary = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await api<{ summary: Record<string, number> }>(`/api/appointments/summary?date=${formatDate(currentDate)}`, { token: accessToken });
      setSummary(res.data?.summary || {});
    } catch { /* ignore */ }
  }, [accessToken, currentDate]);

  // ── Fetch conflict count ──
  const fetchConflictCount = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await api<Appointment[]>('/api/appointments/conflicts', { token: accessToken });
      setConflictCount((res.data || []).length);
    } catch { setConflictCount(0); }
  }, [accessToken]);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchConflictCount(); }, [fetchConflictCount]);

  // ── Actions ──
  async function handleStatusAction(apt: Appointment, action: 'check-in' | 'complete' | 'cancel' | 'no-show') {
    if (!accessToken) return;
    try {
      await api(`/api/appointments/${apt.id}/${action}`, {
        method: 'PATCH',
        token: accessToken,
      });
      await fetchAppointments();
      await fetchSummary();
    } catch (err: any) {
      alert(err.message || '처리에 실패했습니다.');
    }
  }

  // ── Navigation ──
  function navigate(dir: -1 | 1) {
    const next = new Date(currentDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() + dir * 7);
    } else {
      next.setDate(next.getDate() + dir);
    }
    setCurrentDate(next);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  // ── Filter appointments for display ──
  const displayDoctors = selectedDoctorId === 'all' ? doctors : doctors.filter((d) => d.id === selectedDoctorId);

  const totalToday = Object.values(summary).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">외래 예약</h1>
          <p className="text-slate-500 text-sm mt-1">외래 진료 예약을 관리하고 일정을 확인합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          {conflictCount > 0 && (
            <button
              onClick={() => setShowConflicts(!showConflicts)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                showConflicts
                  ? 'bg-yellow-500 text-white shadow-sm shadow-yellow-200'
                  : 'bg-yellow-50 text-yellow-700 border border-yellow-300 hover:bg-yellow-100'
              }`}
            >
              <AlertTriangle size={16} />
              <span>충돌 {conflictCount}건</span>
            </button>
          )}
          <button
            onClick={() => { setEditAppointment(null); setShowCreateModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-sm shadow-blue-200 transition-colors"
          >
            <Plus size={16} />
            <span>새 예약</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <SummaryCard label="전체" value={totalToday} color="bg-slate-50 border-slate-200 text-slate-700" />
        <SummaryCard label="예약됨" value={summary.BOOKED || 0} color="bg-blue-50 border-blue-200 text-blue-700" />
        <SummaryCard label="접수완료" value={summary.CHECKED_IN || 0} color="bg-emerald-50 border-emerald-200 text-emerald-700" />
        <SummaryCard label="진료완료" value={summary.COMPLETED || 0} color="bg-slate-50 border-slate-200 text-slate-500" />
        <SummaryCard label="미방문" value={summary.NO_SHOW || 0} color="bg-orange-50 border-orange-200 text-orange-600" />
        <SummaryCard label="취소" value={summary.CANCELLED || 0} color="bg-red-50 border-red-200 text-red-500" />
      </div>

      {/* Conflict Resolver Panel */}
      {showConflicts && (
        <div className="mb-6">
          <ConflictResolver
            onResolved={() => {
              fetchConflictCount();
              fetchAppointments();
              fetchSummary();
            }}
          />
        </div>
      )}

      {/* Controls Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronLeft size={18} className="text-slate-600" />
            </button>
            <button
              onClick={goToday}
              className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              오늘
            </button>
            <button onClick={() => navigate(1)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronRight size={18} className="text-slate-600" />
            </button>
          </div>

          <h2 className="text-lg font-bold text-slate-800 min-w-[200px]">
            {viewMode === 'week'
              ? (() => {
                  const wk = getWeekDates(currentDate);
                  return `${wk[0].getMonth() + 1}/${wk[0].getDate()} - ${wk[6].getMonth() + 1}/${wk[6].getDate()}`;
                })()
              : formatKoreanDate(currentDate)}
          </h2>

          <div className="flex-1" />

          {/* View Mode Toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(['day', 'week', 'list'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {mode === 'day' && <CalendarClock size={14} />}
                {mode === 'week' && <LayoutGrid size={14} />}
                {mode === 'list' && <List size={14} />}
                {mode === 'day' ? '일간' : mode === 'week' ? '주간' : '목록'}
              </button>
            ))}
          </div>

          {/* Doctor Filter */}
          <select
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">전체 의사</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` (${d.specialty})` : ''}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="환자명 검색..."
              className="pl-8 pr-3 py-2 w-44 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-20 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-slate-400 text-sm">로딩 중...</p>
        </div>
      ) : viewMode === 'day' ? (
        <DayView
          appointments={appointments}
          doctors={displayDoctors}
          currentDate={currentDate}
          onAction={handleStatusAction}
          onClickAppointment={(apt) => setDetailAppointment(apt)}
        />
      ) : viewMode === 'week' ? (
        <WeekView
          appointments={appointments}
          currentDate={currentDate}
          onClickAppointment={(apt) => setDetailAppointment(apt)}
        />
      ) : (
        <ListView
          appointments={appointments}
          onAction={handleStatusAction}
          onClickAppointment={(apt) => setDetailAppointment(apt)}
        />
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <AppointmentModal
          appointment={editAppointment}
          doctors={doctors}
          clinicRooms={clinicRooms}
          onClose={() => { setShowCreateModal(false); setEditAppointment(null); }}
          onSaved={() => { setShowCreateModal(false); setEditAppointment(null); fetchAppointments(); fetchSummary(); }}
        />
      )}

      {/* Detail Modal */}
      {detailAppointment && (
        <AppointmentDetailModal
          appointment={detailAppointment}
          onClose={() => setDetailAppointment(null)}
          onAction={async (apt, action) => {
            await handleStatusAction(apt, action);
            setDetailAppointment(null);
          }}
          onEdit={(apt) => {
            setDetailAppointment(null);
            setEditAppointment(apt);
            setShowCreateModal(true);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Summary Card
// ============================================================

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${color}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
    </div>
  );
}

// ============================================================
// Day View - Doctor Column Calendar
// ============================================================

function DayView({
  appointments,
  doctors,
  currentDate,
  onAction,
  onClickAppointment,
}: {
  appointments: Appointment[];
  doctors: Doctor[];
  currentDate: Date;
  onAction: (apt: Appointment, action: 'check-in' | 'complete' | 'cancel' | 'no-show') => void;
  onClickAppointment: (apt: Appointment) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll to 9AM on mount
    if (scrollRef.current) {
      const now = new Date();
      const targetHour = isSameDay(now, currentDate) ? Math.max(now.getHours() - 1, 8) : 9;
      scrollRef.current.scrollTop = (targetHour - 8) * 80;
    }
  }, [currentDate]);

  if (doctors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
        <User size={40} className="mx-auto text-slate-300 mb-3" />
        <p className="text-slate-500">등록된 의사가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Doctor columns header */}
      <div className="flex border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
        <div className="w-16 shrink-0 border-r border-slate-200 p-2 text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase">시간</span>
        </div>
        {doctors.map((doc) => (
          <div key={doc.id} className="flex-1 min-w-[180px] px-3 py-2.5 border-r border-slate-100 last:border-r-0">
            <p className="text-sm font-bold text-slate-800">{doc.name}</p>
            <p className="text-[11px] text-slate-400">{doc.specialty || '전문과목 미지정'}</p>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
        {HOURS.map((hour) => (
          <div key={hour} className="flex border-b border-slate-100 min-h-[80px]">
            {/* Time label */}
            <div className="w-16 shrink-0 border-r border-slate-200 px-2 py-1 text-right">
              <span className="text-xs font-bold text-slate-400">{String(hour).padStart(2, '0')}:00</span>
            </div>

            {/* Doctor columns */}
            {doctors.map((doc) => {
              const hourAppts = appointments.filter((apt) => {
                const aptHour = new Date(apt.startAt).getHours();
                return apt.doctor.id === doc.id && aptHour === hour;
              });

              return (
                <div key={doc.id} className="flex-1 min-w-[180px] border-r border-slate-50 last:border-r-0 p-1 relative">
                  {hourAppts.map((apt) => {
                    const start = new Date(apt.startAt);
                    const end = new Date(apt.endAt);
                    const durationMin = (end.getTime() - start.getTime()) / 60000;
                    const topOffset = (start.getMinutes() / 60) * 100;
                    const heightPct = Math.max((durationMin / 60) * 100, 30);

                    return (
                      <div
                        key={apt.id}
                        onClick={() => onClickAppointment(apt)}
                        className={`absolute left-1 right-1 rounded-lg px-2 py-1 cursor-pointer border-l-[3px] transition-all hover:shadow-md hover:-translate-y-px ${statusCalendarColors[apt.status]}`}
                        style={{
                          top: `${topOffset}%`,
                          minHeight: `${heightPct}%`,
                          zIndex: 1,
                        }}
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] font-bold truncate">{apt.patient.name}</span>
                          {apt.conflictFlag && <AlertTriangle size={10} className="text-yellow-300 shrink-0" />}
                        </div>
                        <p className="text-[10px] opacity-80">
                          {formatTime(apt.startAt)} - {formatTime(apt.endAt)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Week View
// ============================================================

function WeekView({
  appointments,
  currentDate,
  onClickAppointment,
}: {
  appointments: Appointment[];
  currentDate: Date;
  onClickAppointment: (apt: Appointment) => void;
}) {
  const weekDates = getWeekDates(currentDate);
  const today = new Date();

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Week header */}
      <div className="flex border-b border-slate-200 bg-slate-50">
        <div className="w-16 shrink-0 border-r border-slate-200" />
        {weekDates.map((date, i) => {
          const isToday = isSameDay(date, today);
          const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
          return (
            <div key={i} className={`flex-1 min-w-[120px] text-center py-2.5 border-r border-slate-100 last:border-r-0 ${isToday ? 'bg-blue-50' : ''}`}>
              <p className={`text-xs font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400'}`}>
                {dayNames[date.getDay()]}
              </p>
              <p className={`text-lg font-bold ${isToday ? 'text-blue-600' : 'text-slate-700'}`}>{date.getDate()}</p>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
        {HOURS.map((hour) => (
          <div key={hour} className="flex border-b border-slate-100 min-h-[60px]">
            <div className="w-16 shrink-0 border-r border-slate-200 px-2 py-1 text-right">
              <span className="text-xs font-bold text-slate-400">{String(hour).padStart(2, '0')}:00</span>
            </div>
            {weekDates.map((date, dayIdx) => {
              const dayAppts = appointments.filter((apt) => {
                const aptDate = new Date(apt.startAt);
                return isSameDay(aptDate, date) && aptDate.getHours() === hour;
              });
              const isToday = isSameDay(date, today);

              return (
                <div key={dayIdx} className={`flex-1 min-w-[120px] border-r border-slate-50 last:border-r-0 p-0.5 ${isToday ? 'bg-blue-50/30' : ''}`}>
                  {dayAppts.map((apt) => (
                    <div
                      key={apt.id}
                      onClick={() => onClickAppointment(apt)}
                      className={`rounded px-1.5 py-0.5 mb-0.5 cursor-pointer text-[10px] leading-tight border-l-2 transition-all hover:shadow-sm ${statusCalendarColors[apt.status]}`}
                    >
                      <span className="font-bold">{apt.patient.name}</span>
                      <span className="opacity-70 ml-1">{formatTime(apt.startAt)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// List View
// ============================================================

function ListView({
  appointments,
  onAction,
  onClickAppointment,
}: {
  appointments: Appointment[];
  onAction: (apt: Appointment, action: 'check-in' | 'complete' | 'cancel' | 'no-show') => void;
  onClickAppointment: (apt: Appointment) => void;
}) {
  if (appointments.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
        <CalendarClock size={40} className="mx-auto text-slate-300 mb-3" />
        <p className="text-slate-500">예약이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase">시간</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase">환자</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase">담당의</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase">진료실</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase">상태</th>
            <th className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase">액션</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((apt) => (
            <tr key={apt.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  <span className="font-medium text-slate-700">
                    {formatTime(apt.startAt)} - {formatTime(apt.endAt)}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <button onClick={() => onClickAppointment(apt)} className="text-left hover:text-blue-600 transition-colors">
                  <p className="font-bold text-slate-800">{apt.patient.name}</p>
                  <p className="text-xs text-slate-400">{apt.patient.emrPatientId}</p>
                </button>
              </td>
              <td className="px-4 py-3 text-slate-600">{apt.doctor.name}</td>
              <td className="px-4 py-3 text-slate-500">{apt.clinicRoom?.name || '-'}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${statusColors[apt.status]}`}>
                    {statusLabels[apt.status]}
                  </span>
                  {apt.conflictFlag && (
                    <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-[10px] font-bold border border-yellow-200">충돌</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {apt.status === 'BOOKED' && (
                    <>
                      <button
                        onClick={() => onAction(apt, 'check-in')}
                        className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition border border-emerald-200"
                      >
                        <UserCheck size={12} /> 접수
                      </button>
                      <button
                        onClick={() => onAction(apt, 'no-show')}
                        className="flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-600 rounded-lg text-xs font-medium hover:bg-orange-100 transition border border-orange-200"
                      >
                        <XCircle size={12} /> 미방문
                      </button>
                    </>
                  )}
                  {apt.status === 'CHECKED_IN' && (
                    <button
                      onClick={() => onAction(apt, 'complete')}
                      className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition border border-blue-200"
                    >
                      <CheckCircle size={12} /> 완료
                    </button>
                  )}
                  {!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status) && (
                    <button
                      onClick={() => onAction(apt, 'cancel')}
                      className="flex items-center gap-1 px-2 py-1 bg-red-50 text-red-500 rounded-lg text-xs font-medium hover:bg-red-100 transition border border-red-200"
                    >
                      <XCircle size={12} /> 취소
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
