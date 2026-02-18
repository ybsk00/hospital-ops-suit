'use client';

import { AlertTriangle, Clock } from 'lucide-react';

interface ConflictAlertProps {
  message: string;
  alternatives: string[];
  displayData?: Record<string, any>;
  onSelectAlternative: (time: string) => void;
}

export default function ConflictAlert({
  message,
  alternatives,
  displayData,
  onSelectAlternative,
}: ConflictAlertProps) {
  return (
    <div className="bg-white border border-amber-200 rounded-xl p-3 shadow-sm max-w-[85%]">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-amber-100">
        <div className="w-6 h-6 bg-amber-100 rounded-full flex items-center justify-center">
          <AlertTriangle size={14} className="text-amber-600" />
        </div>
        <span className="text-xs font-semibold text-amber-700">시간 충돌</span>
      </div>

      {/* 메시지 */}
      <p className="text-xs text-slate-700 mb-3">{message}</p>

      {/* 대안 시간대 */}
      {alternatives.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5">대안 시간대:</p>
          <div className="flex flex-wrap gap-1.5">
            {alternatives.map((time) => (
              <button
                key={time}
                onClick={() => onSelectAlternative(time)}
                className="flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs rounded-md border border-blue-200 transition"
              >
                <Clock size={10} />
                {time}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
