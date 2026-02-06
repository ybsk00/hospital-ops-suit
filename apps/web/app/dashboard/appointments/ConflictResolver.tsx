'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import { AlertTriangle, Check, X, Database, Monitor, Merge, Clock, User, Stethoscope } from 'lucide-react';

interface Appointment {
  id: string;
  emrAppointmentId: string | null;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  conflictFlag: boolean;
  notes: string | null;
  version: number;
  patient: { id: string; name: string; emrPatientId: string };
  doctor: { id: string; name: string; specialty: string | null };
  clinicRoom: { id: string; name: string } | null;
}

interface Props {
  onResolved?: () => void;
}

export default function ConflictResolver({ onResolved }: Props) {
  const { accessToken } = useAuthStore();
  const [conflicts, setConflicts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  const fetchConflicts = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<Appointment[]>('/api/appointments/conflicts', { token: accessToken });
      setConflicts(res.data || []);
    } catch {
      setConflicts([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchConflicts(); }, [fetchConflicts]);

  async function handleResolve(apt: Appointment, resolution: 'KEEP_EMR' | 'KEEP_INTERNAL' | 'MERGE') {
    if (!accessToken) return;
    setResolving(apt.id);
    try {
      await api(`/api/appointments/${apt.id}/resolve-conflict`, {
        method: 'PATCH',
        token: accessToken,
        body: { resolution, version: apt.version },
      });
      await fetchConflicts();
      onResolved?.();
    } catch (err: any) {
      alert(err.message || '충돌 해결에 실패했습니다.');
    } finally {
      setResolving(null);
    }
  }

  function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' });
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        <p className="text-sm text-slate-400">충돌 데이터 로딩 중...</p>
      </div>
    );
  }

  if (conflicts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <Check size={40} className="mx-auto text-emerald-400 mb-3" />
        <p className="text-slate-700 font-bold">충돌 없음</p>
        <p className="text-sm text-slate-400 mt-1">현재 해결이 필요한 EMR-INTERNAL 동기화 충돌이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <AlertTriangle size={18} className="text-yellow-500" />
        <h3 className="text-lg font-bold text-slate-800">동기화 충돌 ({conflicts.length}건)</h3>
      </div>

      {/* Conflict Cards */}
      {conflicts.map((apt) => (
        <div key={apt.id} className="bg-white rounded-xl border-2 border-yellow-200 shadow-sm overflow-hidden">
          {/* Card Header */}
          <div className="bg-yellow-50 px-5 py-3 border-b border-yellow-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle size={16} className="text-yellow-600" />
              <div>
                <p className="font-bold text-slate-800">{apt.patient.name}</p>
                <p className="text-xs text-slate-500">{apt.patient.emrPatientId}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${apt.source === 'EMR' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {apt.source}
              </span>
            </div>
          </div>

          {/* Info */}
          <div className="px-5 py-4 grid grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-slate-400" />
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">일시</p>
                <p className="font-medium text-slate-700">{formatDate(apt.startAt)}</p>
                <p className="text-xs text-slate-500">{formatTime(apt.startAt)} - {formatTime(apt.endAt)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Stethoscope size={14} className="text-slate-400" />
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">담당의</p>
                <p className="font-medium text-slate-700">{apt.doctor.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <User size={14} className="text-slate-400" />
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase">진료실</p>
                <p className="font-medium text-slate-700">{apt.clinicRoom?.name || '미지정'}</p>
              </div>
            </div>
          </div>

          {/* Resolution Actions */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-2">
            <button
              onClick={() => handleResolve(apt, 'KEEP_EMR')}
              disabled={resolving === apt.id}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <Database size={13} /> EMR 데이터 유지
            </button>
            <button
              onClick={() => handleResolve(apt, 'KEEP_INTERNAL')}
              disabled={resolving === apt.id}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <Monitor size={13} /> 내부 데이터 유지
            </button>
            <button
              onClick={() => handleResolve(apt, 'MERGE')}
              disabled={resolving === apt.id}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <Merge size={13} /> 병합 처리
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
