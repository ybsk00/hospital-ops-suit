'use client';

import { Check, X, Calendar, Clock, User, Stethoscope } from 'lucide-react';

interface ConfirmationCardProps {
  displayData: Record<string, any>;
  pendingId: string;
  onConfirm: (pendingId: string) => void;
  onReject: (pendingId: string) => void;
  isLoading?: boolean;
}

export default function ConfirmationCard({
  displayData,
  pendingId,
  onConfirm,
  onReject,
  isLoading,
}: ConfirmationCardProps) {
  return (
    <div className="bg-white border border-blue-200 rounded-xl p-3 shadow-sm max-w-[85%]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
        <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
          <Calendar size={14} className="text-blue-600" />
        </div>
        <span className="text-xs font-semibold text-blue-700">
          {displayData.actionLabel || '작업 확인'}
        </span>
      </div>

      {/* 내용 */}
      <div className="space-y-1.5 mb-3 text-xs text-slate-700">
        {displayData.patientName && (
          <div className="flex items-center gap-2">
            <User size={12} className="text-slate-400" />
            <span>{displayData.patientName}</span>
            {displayData.patientEmrId && (
              <span className="text-slate-400">({displayData.patientEmrId})</span>
            )}
          </div>
        )}
        {displayData.doctorName && (
          <div className="flex items-center gap-2">
            <Stethoscope size={12} className="text-slate-400" />
            <span>{displayData.doctorName} {displayData.department ? `(${displayData.department})` : ''}</span>
          </div>
        )}
        {displayData.procedureName && (
          <div className="flex items-center gap-2">
            <Stethoscope size={12} className="text-slate-400" />
            <span>{displayData.procedureName}</span>
            {displayData.frequency && <span className="text-slate-400">({displayData.frequency})</span>}
          </div>
        )}
        {(displayData.date || displayData.newDate) && (
          <div className="flex items-center gap-2">
            <Calendar size={12} className="text-slate-400" />
            <span>{displayData.newDate || displayData.date}</span>
            {(displayData.time || displayData.newTime) && (
              <>
                <Clock size={12} className="text-slate-400" />
                <span>{displayData.newTime || displayData.time}</span>
              </>
            )}
          </div>
        )}
        {displayData.memo && (
          <div className="text-slate-500 italic">"{displayData.memo}"</div>
        )}
        {displayData.reason && (
          <div className="text-slate-500">사유: {displayData.reason}</div>
        )}
      </div>

      {/* 버튼 */}
      <div className="flex gap-2">
        <button
          onClick={() => onConfirm(pendingId)}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
        >
          <Check size={14} />
          확인
        </button>
        <button
          onClick={() => onReject(pendingId)}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition disabled:opacity-50"
        >
          <X size={14} />
          취소
        </button>
      </div>
    </div>
  );
}
