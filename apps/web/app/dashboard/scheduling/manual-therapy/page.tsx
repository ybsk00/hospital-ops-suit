'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../../stores/auth';
import { api } from '../../../../lib/api';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  X,
  Calendar,
  Clock,
  User,
  Check,
  Trash2,
} from 'lucide-react';

// ─── Types ───
interface Therapist {
  id: string;
  name: string;
  workSchedule: Record<string, boolean> | null;
}

interface SlotData {
  id: string;
  patientId: string | null;
  patientName: string;
  emrPatientId: string;
  treatmentCodes: string[];
  sessionMarker: string | null;
  patientType: string;
  status: string;
  notes: string | null;
  duration: number;
  version: number;
}

interface WeeklyData {
  week: { start: string; end: string };
  therapists: Therapist[];
  timeSlots: string[];
  grid: Record<string, Record<string, Record<string, SlotData>>>;
  remarks: { id: string; date: string; content: string }[];
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
const DAY_LABELS = ['월', '화', '수', '목', '금', '토'];

const TREATMENT_CODES = [
  { code: '온', label: '온열', color: 'bg-red-100 text-red-700' },
  { code: '림프', label: '림프', color: 'bg-purple-100 text-purple-700' },
  { code: '페인', label: '페인', color: 'bg-blue-100 text-blue-700' },
  { code: '도수', label: '도수', color: 'bg-green-100 text-green-700' },
  { code: 'SC', label: 'SC', color: 'bg-amber-100 text-amber-700' },
];

const SESSION_MARKERS = ['IN', 'IN20', 'W1', 'W2', 'LTU', '신환', '재진'];

const PATIENT_TYPE_STYLES: Record<string, string> = {
  INPATIENT: 'bg-pink-50 border-pink-200',
  OUTPATIENT: 'bg-green-50 border-green-200',
};

const STATUS_STYLES: Record<string, string> = {
  BOOKED: '',
  COMPLETED: 'opacity-60',
  NO_SHOW: 'bg-yellow-50 border-yellow-300',
  CANCELLED: 'opacity-30 line-through',
};

// ─── Helper ───
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getWeekLabel(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const y = s.getFullYear();
  const weekNum = Math.ceil(s.getDate() / 7);
  return `${y}년 ${s.getMonth() + 1}월 ${weekNum}주차 (${s.getMonth() + 1}/${s.getDate()}~${e.getMonth() + 1}/${e.getDate()})`;
}

function shiftWeek(dateStr: string, offset: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offset * 7);
  return d.toISOString().slice(0, 10);
}

// ─── SlotModal ───
function SlotModal({
  open,
  onClose,
  onSave,
  onDelete,
  therapist,
  date,
  timeSlot,
  existingSlot,
  accessToken,
}: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  therapist: Therapist;
  date: string;
  timeSlot: string;
  existingSlot: SlotData | null;
  accessToken: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [patientName, setPatientName] = useState('');
  const [treatmentCodes, setTreatmentCodes] = useState<string[]>([]);
  const [sessionMarker, setSessionMarker] = useState('');
  const [patientType, setPatientType] = useState<'INPATIENT' | 'OUTPATIENT'>('INPATIENT');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (existingSlot) {
      setPatientName(existingSlot.patientName || '');
      setTreatmentCodes(existingSlot.treatmentCodes || []);
      setSessionMarker(existingSlot.sessionMarker || '');
      setPatientType(existingSlot.patientType as 'INPATIENT' | 'OUTPATIENT');
      setNotes(existingSlot.notes || '');
    } else {
      setPatientName('');
      setTreatmentCodes([]);
      setSessionMarker('');
      setPatientType('INPATIENT');
      setNotes('');
      setSelectedPatient(null);
    }
    setSearchQuery('');
    setSearchResults([]);
  }, [existingSlot, open]);

  const searchPatients = useCallback(
    async (q: string) => {
      if (q.length < 1) {
        setSearchResults([]);
        return;
      }
      setSearching(true);
      try {
        const res = await api<PatientSearchResult[]>(`/api/manual-therapy/patient-search?q=${encodeURIComponent(q)}`, {
          token: accessToken,
        });
        setSearchResults(res.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [accessToken],
  );

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchPatients(val), 300);
  };

  const selectPatient = (p: PatientSearchResult) => {
    setSelectedPatient(p);
    setPatientName(p.name);
    setPatientType(p.isAdmitted ? 'INPATIENT' : 'OUTPATIENT');
    setSearchResults([]);
    setSearchQuery('');
  };

  const toggleCode = (code: string) => {
    setTreatmentCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const handleSave = async () => {
    if (!patientName.trim()) return;
    setSaving(true);
    try {
      if (existingSlot) {
        await api(`/api/manual-therapy/slots/${existingSlot.id}`, {
          method: 'PATCH',
          token: accessToken,
          body: {
            patientId: selectedPatient?.id || existingSlot.patientId || undefined,
            patientName: patientName.trim(),
            treatmentCodes,
            sessionMarker: sessionMarker || null,
            patientType,
            notes: notes || null,
            version: existingSlot.version,
          },
        });
      } else {
        await api('/api/manual-therapy/slots', {
          method: 'POST',
          token: accessToken,
          body: {
            therapistId: therapist.id,
            patientId: selectedPatient?.id || undefined,
            patientName: patientName.trim(),
            date,
            timeSlot,
            treatmentCodes,
            sessionMarker: sessionMarker || undefined,
            patientType,
            notes: notes || undefined,
          },
        });
      }
      onSave();
    } catch (err: any) {
      alert(err.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingSlot || !confirm('이 예약을 취소하시겠습니까?')) return;
    try {
      await api(`/api/manual-therapy/slots/${existingSlot.id}`, {
        method: 'DELETE',
        token: accessToken,
      });
      onSave();
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  };

  if (!open) return null;

  const d = new Date(date + 'T00:00:00');
  const dayLabel = `${d.getMonth() + 1}/${d.getDate()}(${DAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1]})`;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-lg">{existingSlot ? '예약 수정' : '예약 추가'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Info row */}
          <div className="flex gap-4 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <User size={14} /> {therapist.name}
            </span>
            <span className="flex items-center gap-1">
              <Calendar size={14} /> {dayLabel}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} /> {timeSlot}
            </span>
          </div>

          {/* Patient search */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">환자</label>
            {!existingSlot && (
              <div className="relative mb-2">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="환자 이름 검색..."
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => selectPatient(p)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between"
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-slate-400">
                          {p.emrPatientId} {p.isAdmitted ? '(입원)' : '(외래)'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <input
              type="text"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="환자 이름 직접 입력"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Treatment codes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">치료코드</label>
            <div className="flex flex-wrap gap-2">
              {TREATMENT_CODES.map((tc) => (
                <button
                  key={tc.code}
                  onClick={() => toggleCode(tc.code)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    treatmentCodes.includes(tc.code)
                      ? tc.color + ' border-current'
                      : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}
                >
                  {tc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Session marker + Patient type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">세션마커</label>
              <select
                value={sessionMarker}
                onChange={(e) => setSessionMarker(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">없음</option>
                {SESSION_MARKERS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">환자구분</label>
              <select
                value={patientType}
                onChange={(e) => setPatientType(e.target.value as any)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="INPATIENT">입원</option>
                <option value="OUTPATIENT">외래</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">비고</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="메모"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t bg-slate-50 rounded-b-xl">
          <div>
            {existingSlot && (
              <button onClick={handleDelete} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700">
                <Trash2 size={14} />
                취소
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">
              닫기
            </button>
            <button
              onClick={handleSave}
              disabled={!patientName.trim() || saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '저장 중...' : existingSlot ? '수정' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RemarkEditor ───
function RemarkEditor({
  remarks,
  weekDates,
  accessToken,
  onUpdate,
}: {
  remarks: { id: string; date: string; content: string }[];
  weekDates: string[];
  accessToken: string;
  onUpdate: () => void;
}) {
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const startEdit = (date: string) => {
    const existing = remarks.find((r) => r.date === date);
    setEditContent(existing?.content || '');
    setEditingDate(date);
  };

  const save = async () => {
    if (!editingDate) return;
    const existing = remarks.find((r) => r.date === editingDate);
    try {
      if (existing) {
        if (editContent.trim()) {
          await api(`/api/staff-notes/${existing.id}`, {
            method: 'PATCH',
            token: accessToken,
            body: { content: editContent.trim() },
          });
        } else {
          await api(`/api/staff-notes/${existing.id}`, {
            method: 'DELETE',
            token: accessToken,
          });
        }
      } else if (editContent.trim()) {
        await api('/api/staff-notes', {
          method: 'POST',
          token: accessToken,
          body: {
            noteType: 'MANUAL_THERAPY_REMARK',
            date: editingDate,
            content: editContent.trim(),
          },
        });
      }
      setEditingDate(null);
      onUpdate();
    } catch (err: any) {
      alert(err.message || '저장 실패');
    }
  };

  return (
    <div className="border-t-2 border-slate-300 bg-slate-50">
      <div className="grid" style={{ gridTemplateColumns: '70px 1fr' }}>
        <div className="px-2 py-2 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center">
          비고
        </div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${weekDates.length}, 1fr)` }}>
          {weekDates.map((date) => {
            const remark = remarks.find((r) => r.date === date);
            const isEditing = editingDate === date;
            return (
              <div key={date} className="px-2 py-1.5 border-r border-slate-200 last:border-r-0 min-h-[36px]">
                {isEditing ? (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') save();
                        if (e.key === 'Escape') setEditingDate(null);
                      }}
                      autoFocus
                      className="flex-1 text-xs px-1 py-0.5 border rounded"
                    />
                    <button onClick={save} className="text-blue-600 hover:text-blue-700">
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <div onClick={() => startEdit(date)} className="cursor-pointer text-xs text-slate-600 hover:text-slate-900 min-h-[20px]">
                    {remark?.content || <span className="text-slate-300">클릭하여 입력</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───
export default function ManualTherapyPage() {
  const { accessToken } = useAuthStore();
  const [weekDate, setWeekDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTherapist, setModalTherapist] = useState<Therapist | null>(null);
  const [modalDate, setModalDate] = useState('');
  const [modalTimeSlot, setModalTimeSlot] = useState('');
  const [modalExisting, setModalExisting] = useState<SlotData | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<WeeklyData>(`/api/manual-therapy/weekly?date=${weekDate}`, { token: accessToken });
      setData(res.data || null);
    } catch (err: any) {
      console.error('Failed to load schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, weekDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openSlotModal = (therapist: Therapist, date: string, timeSlot: string, slot: SlotData | null) => {
    setModalTherapist(therapist);
    setModalDate(date);
    setModalTimeSlot(timeSlot);
    setModalExisting(slot);
    setModalOpen(true);
  };

  const handleModalSave = () => {
    setModalOpen(false);
    fetchData();
  };

  const goToday = () => setWeekDate(new Date().toISOString().slice(0, 10));

  if (!data && loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">로딩 중...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">데이터를 불러올 수 없습니다.</div>
      </div>
    );
  }

  const { week, therapists, timeSlots, grid, remarks, stats } = data;
  const weekDates: string[] = [];
  const startD = new Date(week.start + 'T00:00:00');
  for (let i = 0; i < 6; i++) {
    const dd = new Date(startD);
    dd.setDate(startD.getDate() + i);
    weekDates.push(dd.toISOString().slice(0, 10));
  }

  // 토요일 근무 치료사 수 (workSchedule 기준)
  const satTherapists = therapists.filter((t) => {
    if (!t.workSchedule) return true;
    return (t.workSchedule as any).sat !== false;
  });

  const totalCols = weekDates.reduce((sum, date, idx) => {
    const dayName = DAY_LABELS[idx];
    if (dayName === '토') return sum + satTherapists.length;
    return sum + therapists.length;
  }, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">도수예약 현황</h1>
          <p className="text-sm text-slate-500 mt-0.5">주간 도수치료 예약 관리</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-sm text-slate-500 mr-4">
            <span className="inline-block w-3 h-3 rounded bg-pink-100 border border-pink-200" /> 입원
            <span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-200 ml-2" /> 외래
            <span className="inline-block w-3 h-3 rounded bg-yellow-50 border border-yellow-300 ml-2" /> 노쇼
          </div>
          <div className="flex items-center gap-1 text-xs bg-slate-100 rounded-lg px-3 py-1.5">
            <span>예약 {stats.totalBooked}</span>
            <span className="text-slate-300 mx-1">|</span>
            <span className="text-green-600">완료 {stats.totalCompleted}</span>
            <span className="text-slate-300 mx-1">|</span>
            <span className="text-yellow-600">노쇼 {stats.noShows}</span>
            <span className="text-slate-300 mx-1">|</span>
            <span className="text-red-600">취소 {stats.cancelled}</span>
          </div>
        </div>
      </div>

      {/* Week Nav */}
      <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
        <button
          onClick={() => setWeekDate(shiftWeek(week.start, -1))}
          className="p-1.5 rounded-lg hover:bg-slate-100 transition"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-800">{getWeekLabel(week.start, week.end)}</span>
          <button onClick={goToday} className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">
            오늘
          </button>
        </div>
        <button
          onClick={() => setWeekDate(shiftWeek(week.start, 1))}
          className="p-1.5 rounded-lg hover:bg-slate-100 transition"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Grid */}
      <div className="bg-white rounded-lg border overflow-x-auto">
        <div className="min-w-[900px]">
          {/* Header Row 1: Dates */}
          <div className="grid border-b-2 border-slate-300" style={{ gridTemplateColumns: `70px repeat(${totalCols}, minmax(90px, 1fr))` }}>
            <div className="px-2 py-2 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">
              시간
            </div>
            {weekDates.map((date, idx) => {
              const dayLabel = DAY_LABELS[idx];
              const isSat = dayLabel === '토';
              const dayTherapists = isSat ? satTherapists : therapists;
              const isToday = date === new Date().toISOString().slice(0, 10);

              return (
                <div
                  key={date}
                  className={`text-center border-r border-slate-200 last:border-r-0 ${isSat ? 'bg-blue-50/50' : ''}`}
                  style={{ gridColumn: `span ${dayTherapists.length}` }}
                >
                  <div
                    className={`py-1.5 text-xs font-semibold border-b border-slate-200 ${
                      isToday ? 'bg-blue-100 text-blue-700' : 'text-slate-700'
                    }`}
                  >
                    {formatDate(date)}({dayLabel})
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${dayTherapists.length}, 1fr)` }}>
                    {dayTherapists.map((t) => (
                      <div key={t.id} className="text-xs py-1 text-slate-500 border-r border-slate-100 last:border-r-0 truncate px-1">
                        {t.name}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time Rows */}
          {timeSlots.map((ts) => (
            <div
              key={ts}
              className="grid border-b border-slate-100 hover:bg-slate-50/50"
              style={{ gridTemplateColumns: `70px repeat(${totalCols}, minmax(90px, 1fr))` }}
            >
              {/* Time label */}
              <div className="px-2 py-1 text-xs font-mono text-slate-500 border-r border-slate-200 flex items-center justify-center">
                {ts}
              </div>
              {/* Cells */}
              {weekDates.map((date, idx) => {
                const dayLabel = DAY_LABELS[idx];
                const isSat = dayLabel === '토';
                const dayTherapists = isSat ? satTherapists : therapists;

                return dayTherapists.map((t) => {
                  const slot = grid[t.id]?.[date]?.[ts] || null;

                  return (
                    <div
                      key={`${t.id}-${date}-${ts}`}
                      onClick={() => openSlotModal(t, date, ts, slot)}
                      className={`px-1 py-0.5 border-r border-slate-100 last:border-r-0 cursor-pointer transition-colors min-h-[38px] ${
                        slot
                          ? `${PATIENT_TYPE_STYLES[slot.patientType] || ''} ${STATUS_STYLES[slot.status] || ''} border`
                          : 'hover:bg-blue-50/50'
                      } ${isSat ? 'bg-blue-50/30' : ''}`}
                    >
                      {slot && (
                        <div className="text-xs leading-tight">
                          <div className="font-medium text-slate-800 truncate">{slot.patientName}</div>
                          <div className="flex items-center gap-0.5 flex-wrap mt-0.5">
                            {slot.treatmentCodes?.map((code) => {
                              const tc = TREATMENT_CODES.find((c) => c.code === code);
                              return (
                                <span
                                  key={code}
                                  className={`px-1 rounded text-[10px] leading-tight ${tc?.color || 'bg-slate-100 text-slate-500'}`}
                                >
                                  {code}
                                </span>
                              );
                            })}
                            {slot.sessionMarker && (
                              <span className="px-1 rounded text-[10px] leading-tight bg-slate-200 text-slate-600">
                                {slot.sessionMarker}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })}
            </div>
          ))}

          {/* Remarks Row */}
          <RemarkEditor remarks={remarks} weekDates={weekDates} accessToken={accessToken || ''} onUpdate={fetchData} />
        </div>
      </div>

      {/* Modal */}
      {modalTherapist && (
        <SlotModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSave={handleModalSave}
          therapist={modalTherapist}
          date={modalDate}
          timeSlot={modalTimeSlot}
          existingSlot={modalExisting}
          accessToken={accessToken || ''}
        />
      )}
    </div>
  );
}
