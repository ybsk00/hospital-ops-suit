'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../../stores/auth';
import { api } from '../../../../lib/api';
import { useScheduleRefresh } from '../../../../hooks/useScheduleRefresh';
import SlotTooltip, { ClinicalInfo } from '../../../../components/scheduling/SlotTooltip';
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
  clinicalInfo?: ClinicalInfo | null;
  bedInfo?: string | null;
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

interface MonthlyData {
  year: number;
  month: number;
  therapists: Therapist[];
  timeSlots: string[];
  weeks: { start: string; end: string; dates: string[] }[];
  grid: Record<string, Record<string, Record<string, SlotData>>>;
  remarks: { id: string; date: string; content: string }[];
  stats: { totalBooked: number; totalCompleted: number; noShows: number; cancelled: number };
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

// ─── 구글시트 스타일 색상 ───
const PATIENT_TYPE_STYLES: Record<string, string> = {
  INPATIENT: 'bg-yellow-100 border-yellow-300',
  OUTPATIENT: 'bg-white border-slate-200',
};

const STATUS_STYLES: Record<string, string> = {
  BOOKED: '',
  COMPLETED: 'bg-green-50 border-green-200',
  NO_SHOW: 'bg-red-50 border-red-200',
  CANCELLED: 'bg-red-100 border-red-300 line-through opacity-50',
};

// ─── Helpers ───
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getWeekLabel(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const weekNum = Math.ceil(s.getDate() / 7);
  return `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${weekNum}주차 (${s.getMonth() + 1}/${s.getDate()}~${e.getMonth() + 1}/${e.getDate()})`;
}

function shiftWeek(dateStr: string, offset: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offset * 7);
  return toDateStr(d);
}

// ─── SlotCell 컴포넌트 ───
function SlotCell({
  slot,
  compact,
  onClick,
}: {
  slot: SlotData;
  compact?: boolean;
  onClick?: () => void;
}) {
  const baseStyle = slot.status === 'CANCELLED' || slot.status === 'NO_SHOW'
    ? STATUS_STYLES[slot.status]
    : `${PATIENT_TYPE_STYLES[slot.patientType] || 'bg-white border-slate-200'} ${STATUS_STYLES[slot.status] || ''}`;

  return (
    <SlotTooltip
      patientName={slot.patientName}
      emrPatientId={slot.emrPatientId}
      patientType={slot.patientType}
      bedInfo={slot.bedInfo}
      clinicalInfo={slot.clinicalInfo}
      treatmentCodes={slot.treatmentCodes}
      slotNotes={slot.notes}
    >
      <div
        onClick={onClick}
        className={`px-1 py-0.5 border rounded cursor-pointer transition-colors ${baseStyle} ${compact ? 'min-h-[26px]' : 'min-h-[36px]'}`}
      >
        <div className={compact ? 'text-[10px] leading-tight' : 'text-[11px] leading-snug'}>
          <div className="flex items-center gap-0.5">
            <span className="font-semibold text-slate-900 truncate">{slot.patientName}</span>
            {slot.sessionMarker && (
              <span className="text-[9px] font-medium text-blue-600 shrink-0">{slot.sessionMarker}</span>
            )}
          </div>
          {!compact && slot.treatmentCodes?.length > 0 && (
            <div className="flex gap-0.5 mt-0.5">
              {slot.treatmentCodes.map((code: string) => {
                const tc = TREATMENT_CODES.find((c) => c.code === code);
                return (
                  <span key={code} className={`px-0.5 rounded text-[9px] leading-tight ${tc?.color || 'bg-slate-100 text-slate-500'}`}>
                    {code}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SlotTooltip>
  );
}

// ─── WeeklyGrid 서브컴포넌트 (주간/월간 공용) ───
function WeeklyGrid({
  weekDates,
  therapists,
  timeSlots,
  grid,
  compact,
  onCellClick,
}: {
  weekDates: string[];
  therapists: Therapist[];
  timeSlots: string[];
  grid: Record<string, Record<string, Record<string, SlotData>>>;
  compact?: boolean;
  onCellClick?: (therapist: Therapist, date: string, timeSlot: string, slot: SlotData | null) => void;
}) {
  const totalCols = weekDates.length * therapists.length;
  const today = toDateStr(new Date());

  return (
    <div className="min-w-[900px]">
      {/* Header */}
      <div className="grid border-b-2 border-slate-300" style={{ gridTemplateColumns: `50px repeat(${totalCols}, minmax(${compact ? '48px' : '60px'}, 1fr))` }}>
        <div className="px-1 py-1.5 text-[10px] font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">
          시간
        </div>
        {weekDates.map((date, idx) => {
          const dayLabel = DAY_LABELS[idx % 6];
          const isSat = dayLabel === '토';
          const isToday = date === today;
          return (
            <div
              key={date}
              className={`text-center border-r-2 border-slate-300 last:border-r-0 ${isSat ? 'bg-blue-50/50' : ''}`}
              style={{ gridColumn: `span ${therapists.length}` }}
            >
              <div className={`py-1 text-[10px] font-bold border-b border-slate-200 ${isToday ? 'bg-blue-100 text-blue-700' : 'text-slate-700'}`}>
                {formatDate(date)}({dayLabel})
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${therapists.length}, 1fr)` }}>
                {therapists.map((t) => (
                  <div key={t.id} className="text-[10px] py-0.5 text-slate-500 border-r border-slate-100 last:border-r-0 truncate px-0.5 font-medium">
                    {t.name}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rows */}
      {timeSlots.map((ts) => (
        <div
          key={ts}
          className="grid border-b border-slate-100 hover:bg-slate-50/30"
          style={{ gridTemplateColumns: `50px repeat(${totalCols}, minmax(${compact ? '48px' : '60px'}, 1fr))` }}
        >
          <div className={`px-1 py-0.5 text-[10px] font-mono text-slate-500 border-r border-slate-200 flex items-center justify-center ${compact ? 'min-h-[26px]' : 'min-h-[36px]'}`}>
            {ts}
          </div>
          {weekDates.map((date, idx) => {
            const isSat = DAY_LABELS[idx % 6] === '토';
            return therapists.map((t) => {
              const slot = grid[t.id]?.[date]?.[ts] || null;
              return (
                <div
                  key={`${t.id}-${date}-${ts}`}
                  onClick={() => onCellClick?.(t, date, ts, slot)}
                  className={`px-0.5 py-0.5 border-r border-slate-100 cursor-pointer transition-colors ${compact ? 'min-h-[26px]' : 'min-h-[36px]'} ${
                    !slot ? `hover:bg-blue-50/40 ${isSat ? 'bg-blue-50/20' : ''}` : ''
                  } ${
                    // 요일 경계 구분선
                    therapists.indexOf(t) === therapists.length - 1 ? 'border-r-2 border-r-slate-300' : ''
                  }`}
                >
                  {slot ? (
                    <SlotCell slot={slot} compact={compact} />
                  ) : null}
                </div>
              );
            });
          })}
        </div>
      ))}
    </div>
  );
}

// ─── SlotModal ───
function SlotModal({
  open,
  onClose,
  onSave,
  therapist,
  date,
  timeSlot,
  existingSlot,
  accessToken,
}: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (q.length < 1) { setSearchResults([]); return; }
      setSearching(true);
      try {
        const res = await api<PatientSearchResult[]>(`/api/manual-therapy/patient-search?q=${encodeURIComponent(q)}`, { token: accessToken });
        setSearchResults(res.data || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
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
      await api(`/api/manual-therapy/slots/${existingSlot.id}`, { method: 'DELETE', token: accessToken });
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
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-lg">{existingSlot ? '예약 수정' : '예약 추가'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex gap-4 text-sm text-slate-600">
            <span className="flex items-center gap-1"><User size={14} /> {therapist.name}</span>
            <span className="flex items-center gap-1"><Calendar size={14} /> {dayLabel}</span>
            <span className="flex items-center gap-1"><Clock size={14} /> {timeSlot}</span>
          </div>
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
                        <span className="text-slate-400">{p.emrPatientId} {p.isAdmitted ? '(입원)' : '(외래)'}</span>
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
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">치료코드</label>
            <div className="flex flex-wrap gap-2">
              {TREATMENT_CODES.map((tc) => (
                <button
                  key={tc.code}
                  onClick={() => toggleCode(tc.code)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    treatmentCodes.includes(tc.code) ? tc.color + ' border-current' : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}
                >
                  {tc.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">세션마커</label>
              <select value={sessionMarker} onChange={(e) => setSessionMarker(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                <option value="">없음</option>
                {SESSION_MARKERS.map((m) => (<option key={m} value={m}>{m}</option>))}
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
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="메모" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t bg-slate-50 rounded-b-xl">
          <div>
            {existingSlot && (
              <button onClick={handleDelete} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"><Trash2 size={14} /> 취소</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">닫기</button>
            <button onClick={handleSave} disabled={!patientName.trim() || saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
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
  therapistCount,
  accessToken,
  onUpdate,
}: {
  remarks: { id: string; date: string; content: string }[];
  weekDates: string[];
  therapistCount: number;
  accessToken: string;
  onUpdate: () => void;
}) {
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const totalCols = weekDates.length * therapistCount;

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
          await api(`/api/staff-notes/${existing.id}`, { method: 'PATCH', token: accessToken, body: { content: editContent.trim() } });
        } else {
          await api(`/api/staff-notes/${existing.id}`, { method: 'DELETE', token: accessToken });
        }
      } else if (editContent.trim()) {
        await api('/api/staff-notes', { method: 'POST', token: accessToken, body: { noteType: 'MANUAL_THERAPY_REMARK', date: editingDate, content: editContent.trim() } });
      }
      setEditingDate(null);
      onUpdate();
    } catch (err: any) {
      alert(err.message || '저장 실패');
    }
  };

  return (
    <div className="border-t-2 border-slate-300 bg-slate-50">
      <div className="grid" style={{ gridTemplateColumns: `50px repeat(${totalCols}, minmax(60px, 1fr))` }}>
        <div className="px-1 py-1.5 text-[10px] font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">
          비고
        </div>
        {weekDates.map((date) => {
          const remark = remarks.find((r) => r.date === date);
          const isEditing = editingDate === date;
          return (
            <div
              key={date}
              className="px-2 py-1.5 border-r-2 border-slate-300 last:border-r-0 min-h-[36px]"
              style={{ gridColumn: `span ${therapistCount}` }}
            >
              {isEditing ? (
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditingDate(null); }}
                    autoFocus
                    className="flex-1 text-xs px-1 py-0.5 border rounded"
                  />
                  <button onClick={save} className="text-blue-600 hover:text-blue-700"><Check size={14} /></button>
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
  );
}

type ViewMode = 'weekly' | 'monthly';

// ─── Main Page ───
export default function ManualTherapyPage() {
  const { accessToken } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [weekDate, setWeekDate] = useState(() => toDateStr(new Date()));
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);

  const [monthYear, setMonthYear] = useState(() => new Date().getFullYear());
  const [monthNum, setMonthNum] = useState(() => new Date().getMonth() + 1);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);

  // 메모리 캐시 (같은 주/월 재방문 시 즉시 표시)
  const weeklyCache = useRef<Map<string, WeeklyData>>(new Map());
  const monthlyCache = useRef<Map<string, MonthlyData>>(new Map());

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTherapist, setModalTherapist] = useState<Therapist | null>(null);
  const [modalDate, setModalDate] = useState('');
  const [modalTimeSlot, setModalTimeSlot] = useState('');
  const [modalExisting, setModalExisting] = useState<SlotData | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!accessToken) return;
    const cacheKey = weekDate;
    const cached = weeklyCache.current.get(cacheKey);
    // 캐시 히트: 즉시 표시 후 백그라운드 갱신
    if (cached && !forceRefresh) {
      setData(cached);
      setLoading(false);
      api<WeeklyData>(`/api/manual-therapy/weekly?date=${weekDate}`, { token: accessToken })
        .then(res => { if (res.data) { weeklyCache.current.set(cacheKey, res.data); setData(res.data); } })
        .catch(() => {});
      return;
    }
    setLoading(true);
    setWeeklyError(null);
    try {
      const res = await api<WeeklyData>(`/api/manual-therapy/weekly?date=${weekDate}`, { token: accessToken });
      if (res.data) { weeklyCache.current.set(cacheKey, res.data); setData(res.data); }
      else setWeeklyError('데이터를 불러오지 못했습니다.');
    } catch (err: any) {
      setWeeklyError(err.message || '주간 데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  }, [accessToken, weekDate]);

  const fetchMonthlyData = useCallback(async (forceRefresh = false) => {
    if (!accessToken) return;
    const cacheKey = `${monthYear}-${monthNum}`;
    const cached = monthlyCache.current.get(cacheKey);
    // 캐시 히트: 즉시 표시 후 백그라운드 갱신
    if (cached && !forceRefresh) {
      setMonthlyData(cached);
      setMonthlyLoading(false);
      api<MonthlyData>(`/api/manual-therapy/monthly?year=${monthYear}&month=${monthNum}`, { token: accessToken })
        .then(res => { if (res.data) { monthlyCache.current.set(cacheKey, res.data); setMonthlyData(res.data); } })
        .catch(() => {});
      return;
    }
    setMonthlyLoading(true);
    setMonthlyError(null);
    try {
      const res = await api<MonthlyData>(`/api/manual-therapy/monthly?year=${monthYear}&month=${monthNum}`, { token: accessToken });
      if (res.data) { monthlyCache.current.set(cacheKey, res.data); setMonthlyData(res.data); }
      else setMonthlyError('데이터를 불러오지 못했습니다.');
    } catch (err: any) {
      setMonthlyError(err.message || '월간 데이터 로드 실패');
    } finally {
      setMonthlyLoading(false);
    }
  }, [accessToken, monthYear, monthNum]);

  useEffect(() => {
    if (viewMode === 'weekly') fetchData();
    else fetchMonthlyData();
  }, [viewMode, fetchData, fetchMonthlyData]);

  // WebSocket 실시간 갱신 (forceRefresh=true로 캐시 무효화)
  const refreshActive = useCallback(() => {
    if (viewMode === 'weekly') fetchData(true);
    else fetchMonthlyData(true);
  }, [viewMode, fetchData, fetchMonthlyData]);
  useScheduleRefresh(refreshActive);

  const openSlotModal = (therapist: Therapist, date: string, timeSlot: string, slot: SlotData | null) => {
    setModalTherapist(therapist);
    setModalDate(date);
    setModalTimeSlot(timeSlot);
    setModalExisting(slot);
    setModalOpen(true);
  };

  const handleModalSave = () => {
    setModalOpen(false);
    if (viewMode === 'weekly') fetchData(true);
    else fetchMonthlyData(true);
  };

  const goToday = () => setWeekDate(toDateStr(new Date()));

  const shiftMonth = (offset: number) => {
    let y = monthYear;
    let m = monthNum + offset;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonthYear(y);
    setMonthNum(m);
  };

  const goThisMonth = () => {
    setMonthYear(new Date().getFullYear());
    setMonthNum(new Date().getMonth() + 1);
  };

  const navigateToWeek = (dateStr: string) => {
    setWeekDate(dateStr);
    setViewMode('weekly');
  };

  const { week, therapists, timeSlots, grid, remarks } = data || {
    week: { start: '', end: '' },
    therapists: [] as Therapist[],
    timeSlots: [] as string[],
    grid: {} as Record<string, Record<string, Record<string, SlotData>>>,
    remarks: [] as { id: string; date: string; content: string }[],
  };

  const weekDates: string[] = [];
  if (week.start) {
    const startD = new Date(week.start + 'T00:00:00');
    for (let i = 0; i < 6; i++) {
      const dd = new Date(startD);
      dd.setDate(startD.getDate() + i);
      weekDates.push(toDateStr(dd));
    }
  }

  const currentStats = viewMode === 'weekly' ? data?.stats : monthlyData?.stats;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">도수예약 현황</h1>
            <p className="text-sm text-slate-500 mt-0.5">{viewMode === 'weekly' ? '주간' : '월간'} 도수치료 예약 관리</p>
          </div>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('weekly')}
              className={`px-3 py-1 text-sm rounded-md transition ${viewMode === 'weekly' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}
            >
              주간
            </button>
            <button
              onClick={() => setViewMode('monthly')}
              className={`px-3 py-1 text-sm rounded-md transition ${viewMode === 'monthly' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}
            >
              월간
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-block w-3 h-3 rounded bg-yellow-100 border border-yellow-300" /> 입원
            <span className="inline-block w-3 h-3 rounded bg-white border border-slate-300 ml-1" /> 외래
            <span className="inline-block w-3 h-3 rounded bg-red-50 border border-red-200 ml-1" /> 노쇼
            <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300 ml-1" /> 취소
            <span className="inline-block w-3 h-3 rounded bg-green-50 border border-green-200 ml-1" /> 완료
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

      {/* Monthly View — 주차별 그리드 반복 */}
      {viewMode === 'monthly' && (
        <>
          <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronLeft size={20} /></button>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-800">{monthYear}년 {monthNum}월</span>
            </div>
            <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronRight size={20} /></button>
          </div>

          {monthlyLoading && (
            <div className="flex items-center justify-center h-32"><div className="text-slate-400 text-sm animate-pulse">데이터 로딩 중...</div></div>
          )}
          {!monthlyLoading && monthlyError && (
            <div className="flex items-center justify-center h-32 text-red-500 text-sm">{monthlyError}</div>
          )}

          {!monthlyLoading && monthlyData && monthlyData.weeks.map((week, weekIdx) => {
            const weekLabel = `${weekIdx + 1}주차 (${formatDate(week.start)}~${formatDate(week.end)})`;
            return (
              <div key={week.start} className="mb-2">
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 rounded-t-lg border border-b-0 border-slate-200">
                  <span className="text-sm font-semibold text-slate-700">{weekLabel}</span>
                  <button onClick={() => navigateToWeek(week.start)} className="text-xs text-blue-600 hover:text-blue-700 hover:underline">
                    주간 보기
                  </button>
                </div>
                <div className="bg-white rounded-b-lg border overflow-x-auto">
                  <WeeklyGrid
                    weekDates={week.dates}
                    therapists={monthlyData.therapists}
                    timeSlots={monthlyData.timeSlots}
                    grid={monthlyData.grid}
                    compact
                    onCellClick={openSlotModal}
                  />
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Weekly View */}
      {viewMode === 'weekly' && (
        <>
          <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
            <button onClick={() => setWeekDate(shiftWeek(data ? week.start : weekDate, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronLeft size={20} /></button>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-800">{data ? getWeekLabel(week.start, week.end) : `${weekDate} 주간`}</span>
            </div>
            <button onClick={() => setWeekDate(shiftWeek(data ? week.start : weekDate, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><ChevronRight size={20} /></button>
          </div>

          {loading && (
            <div className="flex items-center justify-center h-32"><div className="text-slate-400 text-sm animate-pulse">데이터 로딩 중...</div></div>
          )}
          {!loading && weeklyError && (
            <div className="flex items-center justify-center h-32 text-red-500 text-sm">{weeklyError}</div>
          )}
        </>
      )}

      {/* Weekly Grid */}
      {viewMode === 'weekly' && data && (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <WeeklyGrid
            weekDates={weekDates}
            therapists={therapists}
            timeSlots={timeSlots}
            grid={grid}
            onCellClick={openSlotModal}
          />
          <RemarkEditor
            remarks={remarks}
            weekDates={weekDates}
            therapistCount={therapists.length}
            accessToken={accessToken || ''}
            onUpdate={fetchData}
          />
        </div>
      )}

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
