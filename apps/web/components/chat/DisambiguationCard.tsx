'use client';

import { Users, User } from 'lucide-react';

interface PatientOption {
  id: string;
  name: string;
  emrId: string | null;
  dob: string | null;
}

interface DisambiguationCardProps {
  message: string;
  patients: PatientOption[];
  onSelect: (patientId: string, patientName: string) => void;
}

export default function DisambiguationCard({
  message,
  patients,
  onSelect,
}: DisambiguationCardProps) {
  return (
    <div className="bg-white border border-purple-200 rounded-xl p-3 shadow-sm max-w-[85%]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-purple-100">
        <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
          <Users size={14} className="text-purple-600" />
        </div>
        <span className="text-xs font-semibold text-purple-700">환자 선택</span>
      </div>

      {/* 메시지 */}
      <p className="text-xs text-slate-700 mb-2">{message}</p>

      {/* 환자 목록 */}
      <div className="space-y-1.5">
        {patients.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id, p.name)}
            className="w-full flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50 text-left transition"
          >
            <div className="w-7 h-7 bg-slate-100 rounded-full flex items-center justify-center shrink-0">
              <User size={14} className="text-slate-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-slate-800">{p.name}</div>
              <div className="text-[10px] text-slate-400 truncate">
                {p.emrId && `#${p.emrId}`}
                {p.emrId && p.dob && ' | '}
                {p.dob && `${new Date(p.dob).toLocaleDateString('ko-KR')}`}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
