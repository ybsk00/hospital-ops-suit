'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../../stores/auth';
import { api } from '../../../../lib/api';
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
  chartNumber: string;
  doctorCode: string;
  duration: number;
  patientType: string;
  status: string;
  notes: string | null;
  version: number;
  startMin: number;
  endMin: number;
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
  { code: 'C', label: '최원장', color: 'text-blue-700' },
  { code: 'J', label: '전원장', color: 'text-green-700' },
];

const DURATION_OPTIONS = [
  { value: 60, label: '60분 (1시간)' },
  { value: 90, label: '90분 (1.5시간)' },
  { value: 120, label: '120분 (2시간)' },
  { value: 150, label: '150분 (2.5시간)' },
  { value: 180, label: '180분 (3시간)' },
];

const STATUS_COLORS: Record<string, string> = {
  BOOKED: 'bg-blue-100 border-blue-300',
  COMPLETED: 'bg-slate-100 border-slate-300 opacity-60',
  NO_SHOW: 'bg-yellow-100 border-yellow-300',
  CANCELLED: 'bg-red-50 border-red-200 opacity-30',
};

const DOCTOR_COLORS: Record<string, string> = {
  C: 'bg-blue-500',
  J: 'bg-green-500',
};

// ─── Helper ───
function shiftDay(dateStr: string, offset: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${dayLabels[d.getDay()]})`;
}

// ─── RfSlotModal ───
function RfSlotModal({
  open,
  onClose,
  onSave,
  room,
  date,
  startTime,
  existingSlot,
  accessToken,
}: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  room: Room;
  date: string;
  startTime: string;
  existingSlot: SlotData | null;
  accessToken: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [patientName, setPatientName] = useState('');
  const [chartNumber, setChartNumber] = useState('');
  const [doctorCode, setDoctorCode] = useState('C');
  const [duration, setDuration] = useState(120);
  const [patientType, setPatientType] = useState<'INPATIENT' | 'OUTPATIENT'>('INPATIENT');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (existingSlot) {
      setPatientName(existingSlot.patientName || '');
      setChartNumber(existingSlot.chartNumber || '');
      setDoctorCode(existingSlot.doctorCode || 'C');
      setDuration(existingSlot.duration || 120);
      setPatientType(existingSlot.patientType as 'INPATIENT' | 'OUTPATIENT');
      setNotes(existingSlot.notes || '');
    } else {
      setPatientName('');
      setChartNumber('');
      setDoctorCode('C');
      setDuration(120);
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
      try {
        const res = await api<PatientSearchResult[]>(`/api/rf-schedule/patient-search?q=${encodeURIComponent(q)}`, {
          token: accessToken,
        });
        setSearchResults(res.data || []);
      } catch { setSearchResults([]); }
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
    setChartNumber(p.emrPatientId || '');
    setPatientType(p.isAdmitted ? 'INPATIENT' : 'OUTPATIENT');
    setSearchResults([]);
    setSearchQuery('');
  };

  const handleSave = async () => {
    if (!patientName.trim()) return;
    setSaving(true);
    try {
      if (existingSlot) {
        await api(`/api/rf-schedule/slots/${existingSlot.id}`, {
          method: 'PATCH',
          token: accessToken,
          body: {
            patientId: selectedPatient?.id || existingSlot.patientId || undefined,
            patientName: patientName.trim(),
            chartNumber: chartNumber || null,
            doctorCode,
            duration,
            patientType,
            notes: notes || null,
            version: existingSlot.version,
          },
        });
      } else {
        await api('/api/rf-schedule/slots', {
          method: 'POST',
          token: accessToken,
          body: {
            roomId: room.id,
            patientId: selectedPatient?.id || undefined,
            patientName: patientName.trim(),
            chartNumber: chartNumber || undefined,
            doctorCode,
            date,
            startTime,
            duration,
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
      await api(`/api/rf-schedule/slots/${existingSlot.id}`, {
        method: 'DELETE',
        token: accessToken,
      });
      onSave();
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
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
                        <span className="text-slate-400">{p.emrPatientId} {p.isAdmitted ? '(입원)' : '(외래)'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="환자 이름"
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={chartNumber}
                onChange={(e) => setChartNumber(e.target.value)}
                placeholder="차트번호"
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Doctor + Duration + Type */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">담당의</label>
              <select
                value={doctorCode}
                onChange={(e) => setDoctorCode(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                {DOCTOR_CODES.map((d) => (
                  <option key={d.code} value={d.code}>{d.code} ({d.label})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">소요시간</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
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

        <div className="flex items-center justify-between px-5 py-4 border-t bg-slate-50 rounded-b-xl">
          <div>
            {existingSlot && (
              <button onClick={handleDelete} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700">
                <Trash2 size={14} /> 취소
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">닫기</button>
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

// ─── StaffNoteBar ───
function StaffNoteBar({
  staffNotes,
  date,
  accessToken,
  onUpdate,
}: {
  staffNotes: { id: string; content: string }[];
  date: string;
  accessToken: string;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');

  const startEdit = () => {
    setContent(staffNotes.map((n) => n.content).join(', '));
    setEditing(true);
  };

  const save = async () => {
    try {
      // 기존 메모들은 유지하고 새 메모 추가
      if (content.trim()) {
        await api('/api/staff-notes', {
          method: 'POST',
          token: accessToken,
          body: {
            noteType: 'RF_STAFF_NOTE',
            date,
            content: content.trim(),
          },
        });
      }
      setEditing(false);
      onUpdate();
    } catch (err: any) {
      alert(err.message || '저장 실패');
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500 font-medium whitespace-nowrap">직원메모:</span>
      {editing ? (
        <div className="flex items-center gap-1 flex-1">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus
            className="flex-1 px-2 py-1 border rounded text-sm"
            placeholder="직원 메모 입력..."
          />
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

// ─── Main Page ───
export default function RfSchedulePage() {
  const { accessToken } = useAuthStore();
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal state
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
    } catch (err: any) {
      console.error('Failed to load RF schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, dateStr]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openModal = (room: Room, time: string, slot: SlotData | null) => {
    setModalRoom(room);
    setModalTime(time);
    setModalExisting(slot);
    setModalOpen(true);
  };

  const handleModalSave = () => {
    setModalOpen(false);
    fetchData();
  };

  const goToday = () => setDateStr(new Date().toISOString().slice(0, 10));

  if (!data && loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-slate-400">로딩 중...</div></div>;
  }

  if (!data) {
    return <div className="flex items-center justify-center h-64"><div className="text-slate-400">데이터를 불러올 수 없습니다.</div></div>;
  }

  const { rooms, timeSlots, grid, staffNotes, stats } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">고주파예약 현황</h1>
          <p className="text-sm text-slate-500 mt-0.5">일간 고주파(RF) 치료 예약 관리</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mr-4">
            <span className="inline-block w-3 h-3 rounded bg-blue-100 border border-blue-300" /> 예약
            <span className="inline-block w-3 h-3 rounded bg-slate-200 border border-slate-300 ml-1" /> 점유
            <span className="inline-block w-3 h-3 rounded-sm ml-1" style={{ background: 'repeating-linear-gradient(45deg, #e2e8f0, #e2e8f0 2px, transparent 2px, transparent 6px)', border: '1px solid #cbd5e1' }} /> 버퍼
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

      {/* Day Nav */}
      <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-2.5">
        <button onClick={() => setDateStr(shiftDay(dateStr, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-800">{formatDateFull(dateStr)}</span>
          <button onClick={goToday} className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">오늘</button>
        </div>
        <button onClick={() => setDateStr(shiftDay(dateStr, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 transition">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Staff Note */}
      <div className="bg-white rounded-lg border px-4 py-2.5">
        <StaffNoteBar staffNotes={staffNotes} date={dateStr} accessToken={accessToken || ''} onUpdate={fetchData} />
      </div>

      {/* Grid */}
      <div className="bg-white rounded-lg border overflow-x-auto">
        <div style={{ minWidth: `${70 + rooms.length * 90}px` }}>
          {/* Header: Room numbers */}
          <div
            className="grid border-b-2 border-slate-300"
            style={{ gridTemplateColumns: `70px repeat(${rooms.length}, minmax(80px, 1fr))` }}
          >
            <div className="px-2 py-2.5 text-xs font-semibold text-slate-500 border-r border-slate-200 flex items-center justify-center">
              시간
            </div>
            {rooms.map((room) => (
              <div key={room.id} className="px-1 py-2.5 text-center text-xs font-bold text-slate-700 border-r border-slate-200 last:border-r-0">
                {room.name}번
              </div>
            ))}
          </div>

          {/* Time Rows */}
          {timeSlots.map((ts) => (
            <div
              key={ts}
              className="grid border-b border-slate-100"
              style={{ gridTemplateColumns: `70px repeat(${rooms.length}, minmax(80px, 1fr))` }}
            >
              <div className="px-2 py-1 text-xs font-mono text-slate-500 border-r border-slate-200 flex items-center justify-center">
                {ts}
              </div>
              {rooms.map((room) => {
                const cell = grid[room.id]?.[ts];

                if (cell === 'OCCUPIED') {
                  return (
                    <div key={room.id} className="border-r border-slate-100 last:border-r-0 bg-blue-50/60 min-h-[34px]" />
                  );
                }

                if (cell === 'BUFFER') {
                  return (
                    <div
                      key={room.id}
                      className="border-r border-slate-100 last:border-r-0 min-h-[34px]"
                      style={{
                        background: 'repeating-linear-gradient(45deg, #f1f5f9, #f1f5f9 3px, transparent 3px, transparent 8px)',
                      }}
                    />
                  );
                }

                if (cell && typeof cell === 'object') {
                  const slot = cell as SlotData;
                  const spanSlots = Math.ceil(slot.duration / 30);
                  const doctorColor = DOCTOR_COLORS[slot.doctorCode] || 'bg-slate-500';

                  return (
                    <div
                      key={room.id}
                      onClick={() => openModal(room, ts, slot)}
                      className={`border-r border-slate-100 last:border-r-0 cursor-pointer px-1 py-0.5 min-h-[34px] border-l-2 ${STATUS_COLORS[slot.status] || ''}`}
                      style={{ borderLeftColor: slot.doctorCode === 'C' ? '#3b82f6' : '#22c55e' }}
                    >
                      <div className="text-xs leading-tight">
                        <div className="font-medium text-slate-800 truncate">{slot.patientName}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {slot.chartNumber && <span className="text-[10px] text-slate-400">{slot.chartNumber}</span>}
                          <span className={`text-[10px] font-bold ${DOCTOR_CODES.find(d => d.code === slot.doctorCode)?.color || ''}`}>
                            {slot.doctorCode}
                          </span>
                          <span className="text-[10px] text-slate-400">{slot.duration}분</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Empty cell
                return (
                  <div
                    key={room.id}
                    onClick={() => openModal(room, ts, null)}
                    className="border-r border-slate-100 last:border-r-0 cursor-pointer hover:bg-blue-50/40 min-h-[34px] transition-colors"
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Modal */}
      {modalRoom && (
        <RfSlotModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSave={handleModalSave}
          room={modalRoom}
          date={dateStr}
          startTime={modalTime}
          existingSlot={modalExisting}
          accessToken={accessToken || ''}
        />
      )}
    </div>
  );
}
