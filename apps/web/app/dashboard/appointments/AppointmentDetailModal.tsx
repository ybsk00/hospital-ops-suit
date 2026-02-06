'use client';

import {
  X,
  User,
  Clock,
  Stethoscope,
  MapPin,
  FileText,
  UserCheck,
  CheckCircle,
  XCircle,
  Edit3,
  AlertTriangle,
} from 'lucide-react';

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

const statusLabels: Record<string, string> = {
  BOOKED: '예약됨',
  CHECKED_IN: '접수완료',
  COMPLETED: '진료완료',
  CANCELLED: '취소',
  NO_SHOW: '미방문',
  CHANGED: '변경됨',
};

const statusStyles: Record<string, string> = {
  BOOKED: 'bg-blue-100 text-blue-700 border-blue-300',
  CHECKED_IN: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  COMPLETED: 'bg-slate-100 text-slate-600 border-slate-300',
  CANCELLED: 'bg-red-50 text-red-600 border-red-300',
  NO_SHOW: 'bg-orange-100 text-orange-600 border-orange-300',
  CHANGED: 'bg-purple-100 text-purple-600 border-purple-300',
};

interface Props {
  appointment: Appointment;
  onClose: () => void;
  onAction: (apt: Appointment, action: 'check-in' | 'complete' | 'cancel' | 'no-show') => void;
  onEdit: (apt: Appointment) => void;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

export default function AppointmentDetailModal({ appointment: apt, onClose, onAction, onEdit }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="relative px-6 py-5 bg-gradient-to-br from-blue-600 to-blue-700 text-white">
          <button onClick={onClose} className="absolute top-3 right-3 p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X size={18} />
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <User size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">{apt.patient.name}</h2>
              <p className="text-blue-200 text-sm">{apt.patient.emrPatientId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusStyles[apt.status]}`}>
              {statusLabels[apt.status]}
            </span>
            {apt.source === 'EMR' && (
              <span className="px-2 py-0.5 rounded bg-white/20 text-white text-[10px] font-bold">EMR</span>
            )}
            {apt.conflictFlag && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-yellow-400/30 text-yellow-200 text-[10px] font-bold">
                <AlertTriangle size={10} /> 충돌
              </span>
            )}
          </div>
        </div>

        {/* Info Section */}
        <div className="px-6 py-5 space-y-4">
          {/* Date & Time */}
          <InfoRow icon={<Clock size={16} className="text-blue-500" />} label="일시">
            <p className="text-sm font-bold text-slate-800">{formatFullDate(apt.startAt)}</p>
            <p className="text-sm text-slate-600">{formatTime(apt.startAt)} - {formatTime(apt.endAt)}</p>
          </InfoRow>

          {/* Doctor */}
          <InfoRow icon={<Stethoscope size={16} className="text-blue-500" />} label="담당의">
            <p className="text-sm font-bold text-slate-800">{apt.doctor.name}</p>
            <p className="text-xs text-slate-500">{apt.doctor.specialty || '전문과목 미지정'}</p>
          </InfoRow>

          {/* Room */}
          <InfoRow icon={<MapPin size={16} className="text-blue-500" />} label="진료실">
            <p className="text-sm text-slate-700">{apt.clinicRoom?.name || '미지정'}</p>
          </InfoRow>

          {/* Notes */}
          {apt.notes && (
            <InfoRow icon={<FileText size={16} className="text-blue-500" />} label="메모">
              <p className="text-sm text-slate-600">{apt.notes}</p>
            </InfoRow>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="flex flex-wrap gap-2">
            {/* Edit */}
            {!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status) && (
              <button
                onClick={() => onEdit(apt)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors"
              >
                <Edit3 size={13} /> 수정
              </button>
            )}

            {/* Status transitions */}
            {apt.status === 'BOOKED' && (
              <>
                <button
                  onClick={() => onAction(apt, 'check-in')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <UserCheck size={13} /> 접수
                </button>
                <button
                  onClick={() => onAction(apt, 'no-show')}
                  className="flex items-center gap-1.5 px-3 py-2 bg-orange-500 text-white rounded-lg text-xs font-bold hover:bg-orange-600 transition-colors shadow-sm"
                >
                  <XCircle size={13} /> 미방문
                </button>
              </>
            )}
            {apt.status === 'CHECKED_IN' && (
              <button
                onClick={() => onAction(apt, 'complete')}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm"
              >
                <CheckCircle size={13} /> 진료완료
              </button>
            )}
            {!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(apt.status) && (
              <button
                onClick={() => onAction(apt, 'cancel')}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors ml-auto"
              >
                <XCircle size={13} /> 취소
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1">
        <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  );
}
