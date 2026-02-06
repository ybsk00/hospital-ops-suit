'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import { X, Search, CalendarClock, User, Clock } from 'lucide-react';

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

interface Props {
  appointment: Appointment | null;
  doctors: Doctor[];
  clinicRooms: ClinicRoom[];
  onClose: () => void;
  onSaved: () => void;
}

export default function AppointmentModal({ appointment, doctors, clinicRooms, onClose, onSaved }: Props) {
  const { accessToken } = useAuthStore();
  const isEdit = !!appointment;

  // Patient search
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(
    appointment ? { id: appointment.patient.id, name: appointment.patient.name, emrPatientId: appointment.patient.emrPatientId, dob: null, sex: null } : null,
  );
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);

  // Form
  const [doctorId, setDoctorId] = useState(appointment?.doctor.id || (doctors[0]?.id ?? ''));
  const [clinicRoomId, setClinicRoomId] = useState(appointment?.clinicRoom?.id || '');
  const [dateStr, setDateStr] = useState(() => {
    if (appointment) return new Date(appointment.startAt).toISOString().split('T')[0];
    return new Date().toISOString().split('T')[0];
  });
  const [startTime, setStartTime] = useState(() => {
    if (appointment) {
      const d = new Date(appointment.startAt);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return '09:00';
  });
  const [endTime, setEndTime] = useState(() => {
    if (appointment) {
      const d = new Date(appointment.endAt);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return '09:30';
  });
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Search patients
  const searchPatients = useCallback(async (q: string) => {
    if (!accessToken || q.length < 1) {
      setPatientResults([]);
      return;
    }
    try {
      const res = await api<Patient[]>(`/api/appointments/patients/search?q=${encodeURIComponent(q)}`, { token: accessToken });
      setPatientResults(res.data || []);
    } catch {
      setPatientResults([]);
    }
  }, [accessToken]);

  useEffect(() => {
    const timer = setTimeout(() => searchPatients(patientSearch), 300);
    return () => clearTimeout(timer);
  }, [patientSearch, searchPatients]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!selectedPatient) {
      setError('환자를 선택해 주세요.');
      return;
    }
    if (!doctorId) {
      setError('담당의를 선택해 주세요.');
      return;
    }

    const startAt = new Date(`${dateStr}T${startTime}:00`).toISOString();
    const endAt = new Date(`${dateStr}T${endTime}:00`).toISOString();

    if (new Date(endAt) <= new Date(startAt)) {
      setError('종료 시간은 시작 시간 이후여야 합니다.');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && appointment) {
        await api(`/api/appointments/${appointment.id}`, {
          method: 'PATCH',
          token: accessToken!,
          body: {
            doctorId,
            clinicRoomId: clinicRoomId || null,
            startAt,
            endAt,
            notes: notes || null,
            version: appointment.version,
          },
        });
      } else {
        await api('/api/appointments', {
          method: 'POST',
          token: accessToken!,
          body: {
            patientId: selectedPatient.id,
            doctorId,
            clinicRoomId: clinicRoomId || undefined,
            startAt,
            endAt,
            notes: notes || undefined,
          },
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  // Time slot options
  const timeOptions: string[] = [];
  for (let h = 8; h <= 19; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeOptions.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <CalendarClock size={20} className="text-blue-600" />
            <h2 className="text-lg font-bold text-slate-800">{isEdit ? '예약 수정' : '새 예약'}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 font-medium">
              {error}
            </div>
          )}

          {/* Patient Search */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">환자</label>
            {selectedPatient ? (
              <div className="flex items-center justify-between px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-blue-600" />
                  <span className="font-bold text-slate-800">{selectedPatient.name}</span>
                  <span className="text-xs text-slate-500">({selectedPatient.emrPatientId})</span>
                </div>
                {!isEdit && (
                  <button type="button" onClick={() => { setSelectedPatient(null); setPatientSearch(''); }} className="text-xs text-blue-600 hover:underline">
                    변경
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={patientSearch}
                  onChange={(e) => { setPatientSearch(e.target.value); setShowPatientDropdown(true); }}
                  onFocus={() => setShowPatientDropdown(true)}
                  placeholder="환자명 또는 등록번호로 검색..."
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  autoFocus
                />
                {showPatientDropdown && patientResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {patientResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setSelectedPatient(p); setShowPatientDropdown(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors"
                      >
                        <User size={14} className="text-slate-400 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-slate-800">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.emrPatientId} {p.sex ? `• ${p.sex}` : ''}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Doctor & Room */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">담당의</label>
              <select
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">선택</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` (${d.specialty})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">진료실</label>
              <select
                value={clinicRoomId}
                onChange={(e) => setClinicRoomId(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">미지정</option>
                {clinicRooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date & Time */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">날짜</label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">시작 시간</label>
              <select
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  // Auto-set end time +30min
                  const [h, m] = e.target.value.split(':').map(Number);
                  const endMinutes = h * 60 + m + 30;
                  const eh = Math.floor(endMinutes / 60);
                  const em = endMinutes % 60;
                  if (eh <= 19) {
                    setEndTime(`${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`);
                  }
                }}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">종료 시간</label>
              <select
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">메모</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="예약 관련 메모..."
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-sm shadow-blue-200 transition-colors disabled:opacity-50"
            >
              {saving ? '저장 중...' : isEdit ? '수정' : '예약 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
