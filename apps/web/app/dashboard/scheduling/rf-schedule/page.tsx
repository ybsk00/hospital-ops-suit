'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../../stores/auth';
import { api } from '../../../../lib/api';
import { useScheduleRefresh } from '../../../../hooks/useScheduleRefresh';
import SlotTooltip, { ClinicalInfo } from '../../../../components/scheduling/SlotTooltip';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Calendar,
  Clock,
  Search,
  Trash2,
  Check,
} from 'lucide-react';

// ─── Types ───
interface Room {
  id: string;
  name: string;
  displayOrder: number;
}

interface SlotData {
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
  clinicalInfo?: ClinicalInfo | null;
  bedInfo?: string | null;
}

interface DailyData {
  date: string;
  rooms: Room[];
  timeSlots: string[];
  grid: Record<string, Record<string, SlotData | 'OCCUPIED' | 'BUFFER'>>;
  staffNotes: { id: string; content: string; targetId: string | null }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
}

interface PatientSearchResult {
  id: string;
  name: string;
  emrPatientId: string;
  dob: string | null;
  sex: string | null;
  isAdmitted: boolean;
}

// ─── Constants ───
const DOCTOR_CODES = [
  { code: 'C', label: '이찬용', color: 'text-blue-700', borderColor: '#3b82f6' },
  { code: 'J', label: '이재일', color: 'text-green-700', borderColor: '#22c55e' },
];

const DURATION_OPTIONS = [
  { value: 60, label: '60분' },
  { value: 90, label: '90분' },
  { value: 120, label: '120분' },
  { value: 150, label: '150분' },
  { value: 180, label: '180분' },
];

// 구글시트 스타일: 입원=노랑, 외래=흰색
const PATIENT_TYPE_BG: Record<string, string> = {
  INPATIENT: 'bg-yellow-100 border-yellow-300',
  OUTPATIENT: 'bg-white border-slate-200',
};

const STATUS_OVERRIDE: Record<string, string> = {
  BOOKED: '',
  COMPLETED: 'bg-green-50 border-green-200 opacity-60',
  NO_SHOW: 'bg-red-50 border-red-200',
  CANCELLED: 'bg-red-100 border-red-300 line-through opacity-50',
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

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${dayLabels[d.getDay()]})`;
}

function shiftWeek(dateStr: string, offset: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offset * 7);
  return toDateStr(d);
}

function getWeekLabel(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const weekNum = Math.ceil(s.getDate() / 7);
  return `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${weekNum}주차 (${start.slice(5).replace('-', '/')}~${end.slice(5).replace('-', '/')})`;
}

function getSlotStyle(slot: { patientType: string; status: string; doctorCode: string }) {
  const base = slot.status === 'CANCELLED' || slot.status === 'NO_SHOW'
    ? STATUS_OVERRIDE[slot.status]
    : `${PATIENT_TYPE_BG[slot.patientType] || 'bg-white border-slate-200'} ${STATUS_OVERRIDE[slot.status] || ''}`;
  const dc = DOCTOR_CODES.find(d => d.code === slot.doctorCode);
  return { className: base, borderColor: dc?.borderColor || '#3b82f6' };
}

// ─── RfSlotModal ───
function RfSlotModal({
  open, onClose, onSave, room, date, startTime, existingSlot, accessToken,
}: {
  open: boolean; onClose: () => void; onSave: () => void;
  room: Room; date: string; startTime: string; existingSlot: SlotData | null; accessToken: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [patientName, setPatientName] = useState('');
  const [doctorCode, setDoctorCode] = useState('C');
  const [duration, setDuration] = useState(120);
  const [patientType, setPatientType] = useState<'INPATIENT' | 'OUTPATIENT'>('INPATIENT');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (existingSlot) {
      setPatientName(existingSlot.patientName || '');
      setDoctorCode(existingSlot.doctorCode || 'C');
      setDuration(existingSlot.duration || 120);
      setPatientType(existingSlot.patientType as 'INPATIENT' | 'OUTPATIENT');
      setNotes(existingSlot.notes || '');
    } else {
      setPatientName(''); setDoctorCode('C'); setDuration(120);
      setPatientType('INPATIENT'); setNotes(''); setSelectedPatient(null);
    }
    setSearchQuery(''); setSearchResults([]);
  }, [existingSlot, open]);

  const searchPatients = useCallback(async (q: string) => {
    if (q.length < 1) { setSearchResults([]); return; }
    try {
      const res = await api<PatientSearchResult[]>(`/api/rf-schedule/patient-search?q=${encodeURIComponent(q)}`, { token: accessToken });
      setSearchResults(res.data || []);
    } catch { setSearchResults([]); }
  }, [accessToken]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchPatients(val), 300);
  };

  const selectPatient = (p: PatientSearchResult) => {
    setSelectedPatient(p);
    setPatientName(p.name);
    setPatientType(p.isAdmitted ? 'INPATIENT' : 'OUTPATIENT');
    setSearchResults([]); setSearchQuery('');
  };

  const handleSave = async () => {
    if (!patientName.trim()) return;
    setSaving(true);
    try {
      if (existingSlot) {
        await api(`/api/rf-schedule/slots/${existingSlot.id}`, {
          method: 'PATCH', token: accessToken,
          body: {
            patientId: selectedPatient?.id || existingSlot.patientId || undefined,
            doctorCode, duration, patientType, notes: notes || null,
            version: existingSlot.version,
          },
        });
      } else {
        await api('/api/rf-schedule/slots', {
          method: 'POST', token: accessToken,
          body: {
            roomId: room.id,
            patientId: selectedPatient?.id || undefined,
            doctorCode, date, startTime, duration, patientType,
            notes: notes || undefined,
          },
        });
      }
      onSave();
    } catch (err: any) { alert(err.message || '저장 실패'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!existingSlot || !confirm('이 예약을 취소하시겠습니까?')) return;
    try {
      await api(`/api/rf-schedule/slots/${existingSlot.id}`, { method: 'DELETE', token: accessToken });
      onSave();
    } catch (err: any) { alert(err.message || '삭제 실패'); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-lg">{existingSlot ? '고주파 예약 수정' : '고주파 예약 추가'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex gap-4 text-sm text-slate-600">
            <span className="flex items-center gap-1"><Calendar size={14} /> {formatDateFull(date)}</span>
            <span className="flex items-center gap-1"><Clock size={14} /> {startTime}</span>
            <span className="font-medium text-slate-800">기계 {room.name}번</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">환자</label>
            {!existingSlot && (
              <div className="relative mb-2">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)} placeholder="환자 이름 검색..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button key={p.id} onClick={() => selectPatient(p)} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-slate-400">{p.emrPatientId} {p.isAdmitted ? '(입원)' : '(외래)'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <input type="text" value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="환자 이름"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">담당의</label>
              <select value={doctorCode} onChange={(e) => setDoctorCode(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                {DOCTOR_CODES.map((d) => (<option key={d.code} value={d.code}>{d.code} ({d.label})</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">소요시간</label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                {DURATION_OPTIONS.map((d) => (<option key={d.value} value={d.value}>{d.label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">환자구분</label>
              <select value={patientType} onChange={(e) => setPatientType(e.target.value as any)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                <option value="INPATIENT">입원</option>
                <option value="OUTPATIENT">외래</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">비고</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="메모"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t bg-slate-50 rounded-b-xl">
          <div>
            {existingSlot && (<button onClick={handleDelete} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"><Trash2 size={14} /> 취소</button>)}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">닫기</button>
            <button onClick={handleSave} disabled={!patientName.trim() || saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? '저장 중...' : existingSlot ? '수정' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── StaffNoteBar ───
function StaffNoteBar({
  staffNotes, date, accessToken, onUpdate,
}: {
  staffNotes: { id: string; content: string }[]; date: string; accessToken: string; onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');

  const startEdit = () => { setContent(staffNotes.map((n) => n.content).join(', ')); setEditing(true); };
  const save = async () => {
    try {
      if (content.trim()) {
        await api('/api/staff-notes', { method: 'POST', token: accessToken, body: { noteType: 'RF_STAFF_NOTE', date, content: content.trim() } });
      }
      setEditing(false); onUpdate();
    } catch (err: any) { alert(err.message || '저장 실패'); }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500 font-medium whitespace-nowrap">직원메모:</span>
      {editing ? (
        <div className="flex items-center gap-1 flex-1">
          <input type="text" value={content} onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus className="flex-1 px-2 py-1 border rounded text-sm" placeholder="직원 메모 입력..." />
          <button onClick={save} className="text-blue-600 hover:text-blue-700"><Check size={16} /></button>
          <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
      ) : (
        <div onClick={startEdit} className="cursor-pointer text-slate-600 hover:text-slate-900 flex-1">
          {staffNotes.length > 0 ? staffNotes.map((n) => n.content).join(', ') : <span className="text-slate-300">클릭하여 입력</span>}
        </div>
      )}
    </div>
  );
}

// ─── Types for weekly/monthly ───
interface WeeklyRfData {
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

interface MonthlyRfData {
  year: number;
  month: number;
  rooms: Room[];
  timeSlots: string[];
  weeks: { start: string; end: string; dates: string[] }[];
  grid: Record<string, Record<string, Record<string, SlotData | 'OCCUPIED' | 'BUFFER'>>>;
  staffNotes: { id: string; date: string; content: string }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
}

type ViewMode = 'daily' | 'weekly' | 'monthly';
const DAY_LABELS = ['월', '화', '수', '목', '금', '토'];

// ─── Main Page ───
export default function RfSchedulePage() {
  const { accessToken } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [dateStr, setDateStr] = useState(() => toDateStr(new Date()));
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);

  const [weekDate, setWeekDate] = useState(() => toDateStr(new Date()));
  const [weeklyData, setWeeklyData] = useState<WeeklyRfData | null>(null);
  const [monthYear, setMonthYear] = useState(() => new Date().getFullYear());
  const [monthNum, setMonthNum] = useState(() => new Date().getMonth() + 1);
  const [monthlyData, setMonthlyData] = useState<MonthlyRfData | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalRoom, setModalRoom] = useState<Room | null>(null);
  const [modalTime, setModalTime] = useState('');
  const [modalExisting, setModalExisting] = useState<SlotData | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<DailyData>(`/api/rf-schedule/daily?date=${dateStr}`, { token: accessToken });
      setData(res.data || null);
    } catch (err: any) { console.error('Failed to load RF schedule:', err); }
    finally { setLoading(false); }
  }, [accessToken, dateStr]);

  const fetchWeeklyData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<WeeklyRfData>(`/api/rf-schedule/weekly?date=${weekDate}`, { token: accessToken });
      setWeeklyData(res.data || null);
    } catch (err: any) { console.error('Failed to load weekly RF schedule:', err); }
    finally { setLoading(false); }
  }, [accessToken, weekDate]);

  const fetchMonthlyData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<MonthlyRfData>(`/api/rf-schedule/monthly?year=${monthYear}&month=${monthNum}`, { token: accessToken });
      setMonthlyData(res.data || null);
    } catch (err: any) { console.error('Failed to load monthly RF schedule:', err); }
    finally { setLoading(false); }
  }, [accessToken, monthYear, monthNum]);

  useEffect(() => {
    if (viewMode === 'daily') fetchData();
    else if (viewMode === 'weekly') fetchWeeklyData();
    else fetchMonthlyData();
  }, [viewMode, fetchData, fetchWeeklyData, fetchMonthlyData]);

  // WebSocket 실시간 갱신
  const refreshActive = useCallback(() => {
    if (viewMode === 'daily') fetchData();
    else if (viewMode === 'weekly') fetchWeeklyData();
    else fetchMonthlyData();
  }, [viewMode, fetchData, fetchWeeklyData, fetchMonthlyData]);
  useScheduleRefresh(refreshActive);

  const openModal = (room: Room, time: string, slot: SlotData | null) => {
    setModalRoom(room); setModalTime(time); setModalExisting(slot); setModalOpen(true);
  };

  const handleModalSave = () => {
    setModalOpen(false);
    if (viewMode === 'daily') fetchData();
    else if (viewMode === 'weekly') fetchWeeklyData();
    else fetchMonthlyData();
  };

  const goToday = () => setDateStr(toDateStr(new Date()));
  const shiftMonth = (offset: number) => {
    let y = monthYear, m = monthNum + offset;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonthYear(y); setMonthNum(m);
  };

  const navigateToDay = (d: string) => { setDateStr(d); setViewMode('daily'); };

  const getWeekDatesFromStart = (start: string): string[] => {
    const dates: string[] = [];
    const s = new Date(start + 'T00:00:00');
    for (let i = 0; i < 6; i++) { const dd = new Date(s); dd.setDate(s.getDate() + i); dates.push(toDateStr(dd)); }
    return dates;
  };

  const getMonthCalendarDays = (year: number, month: number): (string | null)[] => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: (string | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    return days;
  };

  const currentStats = viewMode === 'daily' ? data?.stats : viewMode === 'weekly' ? weeklyData?.stats : monthlyData?.stats;
  const { rooms, timeSlots, grid, staffNotes } = data || {
    rooms: [] as Room[], timeSlots: [] as string[],
    grid: {} as Record<string, Record<string, any>>,
    staffNotes: [] as { id: string; content: string; targetId: string | null }[],
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">고주파예약 현황</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {viewMode === 'daily' ? '일간' : viewMode === 'weekly' ? '주간' : '월간'} 고주파(RF) 치료 예약 관리
            </p>
          </div>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(['daily', 'weekly', 'monthly'] as ViewMode[]).map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-3 py-1 text-sm rounded-md transition ${viewMode === m ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
                {m === 'daily' ? '일간' : m === 'weekly' ? '주간' : '월간'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded bg-yellow-100 border border-yellow-300" /> 입원
            <span className="inline-block w-3 h-3 rounded bg-white border border-slate-300 ml-1" /> 외래
            <span className="inline-block w-2 h-3 rounded-sm bg-blue-500 ml-2" /> C
            <span className="inline-block w-2 h-3 rounded-sm bg-green-500 ml-0.5" /> J
            <span className="inline-block w-3 h-3 rounded bg-red-50 border border-red-200 ml-2" /> 노쇼
            <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300 ml-0.5" /> 취소
          </div>
          {currentStats && (
            <div className="flex items-center gap-1 text-xs bg-slate-100 rounded-lg px-3 py-1.5">
              <span>예약 {currentStats.totalBooked}</span>
              <span className="text-slate-300 mx-1">|</span>
              <span className="text-green-600">완료 {currentStats.totalCompleted}</span>
              <span className="text-slate-300 mx-1">|</span>
              <span className="text-yellow-600">노쇼 {currentStats.noShows}</span>
              <span className="text-slate-300 mx-1">|</span>
              <span className="text-red-600">취소 {currentStats.cancelled}</span>
            </div>
          )}
        </div>
      </div>

      {/* ═══ DAILY VIEW ═══ */}
      {viewMode === 'daily' && (
        <>
          <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
            <button onClick={() => setDateStr(shiftDay(dateStr, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronLeft size={20} /></button>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-800">{formatDateFull(dateStr)}</span>
              <button onClick={goToday} className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">오늘</button>
            </div>
            <button onClick={() => setDateStr(shiftDay(dateStr, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronRight size={20} /></button>
          </div>

          {loading && !data && (
            <div className="flex items-center justify-center h-32"><div className="text-slate-400 text-sm">로딩 중...</div></div>
          )}
        </>
      )}

      {viewMode === 'daily' && data && (
        <>
          <div className="bg-white rounded-lg border px-4 py-2.5">
            <StaffNoteBar staffNotes={staffNotes} date={dateStr} accessToken={accessToken || ''} onUpdate={fetchData} />
          </div>

          <div className="bg-white rounded-lg border overflow-x-auto">
            <div style={{ minWidth: `${70 + rooms.length * 90}px` }}>
              {/* Header */}
              <div className="grid border-b-2 border-slate-300" style={{ gridTemplateColumns: `70px repeat(${rooms.length}, minmax(80px, 1fr))` }}>
                <div className="px-2 py-2.5 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">시간</div>
                {rooms.map((room) => (
                  <div key={room.id} className="px-1 py-2.5 text-center text-xs font-bold text-slate-700 border-r border-slate-200 last:border-r-0">{room.name}번</div>
                ))}
              </div>

              {/* Time Rows */}
              {timeSlots.map((ts) => (
                <div key={ts} className="grid border-b border-slate-100" style={{ gridTemplateColumns: `70px repeat(${rooms.length}, minmax(80px, 1fr))` }}>
                  <div className="px-2 py-1 text-xs font-mono text-slate-500 border-r border-slate-200 flex items-center justify-center min-h-[34px]">{ts}</div>
                  {rooms.map((room) => {
                    const cell = grid[room.id]?.[ts];

                    if (cell === 'OCCUPIED') {
                      return <div key={room.id} className="border-r border-slate-100 last:border-r-0 bg-blue-50/60 min-h-[34px]" />;
                    }
                    if (cell === 'BUFFER') {
                      return <div key={room.id} className="border-r border-slate-100 last:border-r-0 min-h-[34px]"
                        style={{ background: 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 3px, transparent 3px, transparent 8px)' }} />;
                    }

                    if (cell && typeof cell === 'object') {
                      const slot = cell as SlotData;
                      const style = getSlotStyle(slot);
                      return (
                        <div key={room.id} className={`border-r border-slate-100 last:border-r-0 cursor-pointer px-1 py-0.5 min-h-[34px] border-l-2 border ${style.className}`}
                          style={{ borderLeftColor: style.borderColor }}
                          onClick={() => openModal(room, ts, slot)}>
                          <SlotTooltip
                            patientName={slot.patientName} emrPatientId={slot.emrPatientId}
                            patientType={slot.patientType} bedInfo={slot.bedInfo}
                            clinicalInfo={slot.clinicalInfo} doctorCode={slot.doctorCode}
                            duration={slot.duration} slotNotes={slot.notes}>
                            <div className="text-[11px] leading-tight">
                              <div className="flex items-center gap-1">
                                <span className={`font-bold ${DOCTOR_CODES.find(d => d.code === slot.doctorCode)?.color || ''}`}>{slot.doctorCode}</span>
                                <span className="font-semibold text-slate-900 truncate">{slot.patientName}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{slot.duration}분</div>
                            </div>
                          </SlotTooltip>
                        </div>
                      );
                    }

                    return (
                      <div key={room.id} onClick={() => openModal(room, ts, null)}
                        className="border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-blue-50/40 min-h-[34px] transition-colors" />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ═══ WEEKLY VIEW ═══ */}
      {viewMode === 'weekly' && (() => {
        const wkDates = weeklyData ? getWeekDatesFromStart(weeklyData.week.start) : getWeekDatesFromStart(weekDate);
        const wkLabel = weeklyData ? getWeekLabel(weeklyData.week.start, weeklyData.week.end) : '';
        const wkRooms = weeklyData?.rooms || [];

        return (
          <>
            <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
              <button onClick={() => setWeekDate(shiftWeek(weekDate, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronLeft size={20} /></button>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-800">{wkLabel}</span>
                <button onClick={() => setWeekDate(toDateStr(new Date()))} className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">이번주</button>
              </div>
              <button onClick={() => setWeekDate(shiftWeek(weekDate, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronRight size={20} /></button>
            </div>

            {loading && !weeklyData && (
              <div className="flex items-center justify-center h-32"><div className="text-slate-400 text-sm">로딩 중...</div></div>
            )}

            {weeklyData && (
              <div className="bg-white rounded-lg border overflow-x-auto">
                <div style={{ minWidth: '700px' }}>
                  <div className="grid border-b-2 border-slate-300" style={{ gridTemplateColumns: '60px repeat(6, 1fr)' }}>
                    <div className="px-2 py-2 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">기계</div>
                    {wkDates.map((d, i) => {
                      const dayData = weeklyData.days?.[d];
                      const isToday = d === toDateStr(new Date());
                      return (
                        <div key={d} onClick={() => navigateToDay(d)}
                          className={`px-1 py-2 text-center border-r border-slate-200 last:border-r-0 cursor-pointer hover:bg-blue-50 transition ${isToday ? 'bg-blue-50' : ''}`}>
                          <div className="text-xs font-bold text-slate-700">{DAY_LABELS[i]} ({d.slice(8)}일)</div>
                          {dayData && <div className="text-[10px] text-slate-400 mt-0.5">총 {dayData.total}건</div>}
                        </div>
                      );
                    })}
                  </div>

                  {wkRooms.map((room) => (
                    <div key={room.id} className="grid border-b border-slate-100" style={{ gridTemplateColumns: '60px repeat(6, 1fr)' }}>
                      <div className="px-1 py-1 text-xs font-bold text-slate-700 border-r border-slate-200 flex items-center justify-center bg-slate-50">{room.name}번</div>
                      {wkDates.map((d) => {
                        const roomDay = weeklyData.days?.[d]?.byRoom?.[room.id];
                        if (!roomDay || roomDay.count === 0) {
                          return <div key={d} onClick={() => navigateToDay(d)} className="px-1 py-1 border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-blue-50/40 min-h-[36px]" />;
                        }
                        return (
                          <div key={d} onClick={() => navigateToDay(d)} className="px-1 py-1 border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-blue-50/40 min-h-[36px]">
                            {roomDay.slots?.slice(0, 3).map((s: any, si: number) => (
                              <div key={si} className={`text-[10px] leading-tight truncate px-0.5 rounded ${
                                s.patientType === 'INPATIENT' ? 'bg-yellow-50' : ''
                              } ${s.status === 'CANCELLED' ? 'line-through text-red-400' : 'text-slate-600'}`}>
                                <span className={`font-bold ${s.doctorCode === 'C' ? 'text-blue-600' : 'text-green-600'}`}>{s.doctorCode}</span>
                                {' '}{s.patientName}
                              </div>
                            ))}
                            {(roomDay.slots?.length || 0) > 3 && (
                              <div className="text-[10px] text-slate-400">+{roomDay.slots.length - 3}건</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* ═══ MONTHLY VIEW — 하이브리드 (달력 + 날짜 클릭 시 일간 확장) ═══ */}
      {viewMode === 'monthly' && (
        <>
          <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronLeft size={20} /></button>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-800">{monthYear}년 {monthNum}월</span>
              <button onClick={() => { setMonthYear(new Date().getFullYear()); setMonthNum(new Date().getMonth() + 1); }}
                className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">이번달</button>
            </div>
            <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronRight size={20} /></button>
          </div>

          {loading && !monthlyData && (
            <div className="flex items-center justify-center h-32"><div className="text-slate-400 text-sm">로딩 중...</div></div>
          )}

          {monthlyData && (() => {
            const dayCounts: Record<string, number> = {};
            for (const roomId of Object.keys(monthlyData.grid || {})) {
              for (const ds of Object.keys(monthlyData.grid[roomId] || {})) {
                for (const ts of Object.keys(monthlyData.grid[roomId][ds] || {})) {
                  const cell = monthlyData.grid[roomId][ds][ts];
                  if (cell && typeof cell === 'object') dayCounts[ds] = (dayCounts[ds] || 0) + 1;
                }
              }
            }
            const calDays = getMonthCalendarDays(monthYear, monthNum);
            const today = toDateStr(new Date());

            return (
              <>
                <div className="bg-white rounded-lg border">
                  <div className="grid grid-cols-7 border-b">
                    {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                      <div key={d} className={`py-2 text-center text-xs font-semibold ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'}`}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {calDays.map((day, i) => {
                      if (!day) return <div key={`e-${i}`} className="p-2 min-h-[64px] border-b border-r border-slate-100 bg-slate-50/50" />;
                      const dd = new Date(day + 'T00:00:00');
                      const isToday = day === today;
                      const count = dayCounts[day] || 0;
                      const isExpanded = expandedDay === day;
                      const isSun = dd.getDay() === 0;
                      const isSat = dd.getDay() === 6;

                      return (
                        <div key={day} onClick={() => setExpandedDay(isExpanded ? null : day)}
                          className={`p-2 min-h-[64px] border-b border-r border-slate-100 cursor-pointer hover:bg-blue-50/50 transition ${isToday ? 'bg-blue-50' : ''} ${isExpanded ? 'ring-2 ring-blue-400' : ''}`}>
                          <div className={`text-xs font-semibold ${isToday ? 'text-blue-600' : isSun ? 'text-red-500' : isSat ? 'text-blue-500' : 'text-slate-700'}`}>{dd.getDate()}</div>
                          {count > 0 && (
                            <div className="mt-1 text-center">
                              <span className="inline-block bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{count}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Expanded Day Detail */}
                {expandedDay && monthlyData && (
                  <div className="bg-white rounded-lg border">
                    <div className="px-4 py-2.5 bg-slate-50 border-b flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-700">{formatDateFull(expandedDay)} 상세</span>
                      <button onClick={() => navigateToDay(expandedDay)} className="text-xs text-blue-600 hover:underline">일간 보기로 이동</button>
                    </div>
                    <div className="overflow-x-auto">
                      <div style={{ minWidth: `${70 + (monthlyData.rooms?.length || 15) * 80}px` }}>
                        <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: `60px repeat(${monthlyData.rooms.length}, minmax(70px, 1fr))` }}>
                          <div className="px-1 py-1.5 text-[10px] font-semibold text-slate-500 border-r border-slate-200 text-center">시간</div>
                          {monthlyData.rooms.map((r) => (
                            <div key={r.id} className="px-1 py-1.5 text-[10px] font-bold text-slate-700 border-r border-slate-200 last:border-r-0 text-center">{r.name}번</div>
                          ))}
                        </div>
                        {monthlyData.timeSlots.map((ts) => {
                          const hasAny = monthlyData.rooms.some(r => monthlyData.grid[r.id]?.[expandedDay]?.[ts]);
                          if (!hasAny) return null;
                          return (
                            <div key={ts} className="grid border-b border-slate-100" style={{ gridTemplateColumns: `60px repeat(${monthlyData.rooms.length}, minmax(70px, 1fr))` }}>
                              <div className="px-1 py-0.5 text-[10px] font-mono text-slate-500 border-r border-slate-200 text-center min-h-[28px] flex items-center justify-center">{ts}</div>
                              {monthlyData.rooms.map((r) => {
                                const cell = monthlyData.grid[r.id]?.[expandedDay]?.[ts];
                                if (cell === 'OCCUPIED') return <div key={r.id} className="border-r border-slate-100 bg-blue-50/60 min-h-[28px]" />;
                                if (cell === 'BUFFER') return <div key={r.id} className="border-r border-slate-100 min-h-[28px]"
                                  style={{ background: 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 2px, transparent 2px, transparent 6px)' }} />;
                                if (cell && typeof cell === 'object') {
                                  const slot = cell as SlotData;
                                  const st = getSlotStyle(slot);
                                  return (
                                    <div key={r.id} className={`border-r border-slate-100 px-0.5 py-0.5 min-h-[28px] border-l-2 border ${st.className}`}
                                      style={{ borderLeftColor: st.borderColor }}>
                                      <div className="text-[10px] leading-tight truncate">
                                        <span className={`font-bold ${DOCTOR_CODES.find(d => d.code === slot.doctorCode)?.color || ''}`}>{slot.doctorCode}</span>
                                        {' '}<span className="font-medium text-slate-800">{slot.patientName}</span>
                                      </div>
                                    </div>
                                  );
                                }
                                return <div key={r.id} className="border-r border-slate-100 min-h-[28px]" />;
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* Modal */}
      {modalRoom && (
        <RfSlotModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleModalSave}
          room={modalRoom} date={dateStr} startTime={modalTime} existingSlot={modalExisting} accessToken={accessToken || ''} />
      )}
    </div>
  );
}
