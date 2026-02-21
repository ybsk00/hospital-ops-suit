'use client';

import { useState, useRef, useEffect, useCallback, ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ClinicalInfo {
  diagnosis?: string | null;
  surgeryHistory?: string | null;
  metastasis?: string | null;
  ctxHistory?: string | null;
  chemoPort?: string | null;
  rtHistory?: string | null;
  notes?: string | null;
}

interface SlotTooltipProps {
  patientName: string;
  emrPatientId: string;
  patientType: string;
  bedInfo?: string | null;
  clinicalInfo?: ClinicalInfo | null;
  treatmentCodes?: string[];
  doctorCode?: string;
  duration?: number;
  slotNotes?: string | null;
  children: ReactNode;
}

export default function SlotTooltip({
  patientName,
  emrPatientId,
  patientType,
  bedInfo,
  clinicalInfo,
  treatmentCodes,
  doctorCode,
  duration,
  slotNotes,
  children,
}: SlotTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, flipX: false, flipY: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const show = useCallback((e: React.MouseEvent) => {
    timerRef.current = setTimeout(() => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const flipX = rect.left + 280 > vw;
      const flipY = rect.bottom + 200 > vh;
      setPos({
        x: flipX ? rect.right : rect.left,
        y: flipY ? rect.top : rect.bottom + 4,
        flipX,
        flipY,
      });
      setVisible(true);
    }, 200);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const hasClinical = clinicalInfo && (
    clinicalInfo.diagnosis || clinicalInfo.surgeryHistory || clinicalInfo.metastasis ||
    clinicalInfo.ctxHistory || clinicalInfo.chemoPort || clinicalInfo.rtHistory
  );

  return (
    <div
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      className="w-full h-full"
    >
      {children}
      {visible && typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[9999] bg-white border border-slate-300 rounded-lg shadow-xl text-xs pointer-events-none"
          style={{
            left: pos.flipX ? undefined : pos.x,
            right: pos.flipX ? window.innerWidth - pos.x : undefined,
            top: pos.flipY ? undefined : pos.y,
            bottom: pos.flipY ? window.innerHeight - pos.y + 4 : undefined,
            maxWidth: 300,
            minWidth: 200,
          }}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-lg">
            <div className="font-semibold text-slate-900">
              {patientName}
              {emrPatientId && <span className="text-slate-400 font-normal ml-1">({emrPatientId})</span>}
            </div>
            <div className="text-slate-500 mt-0.5">
              {patientType === 'INPATIENT' ? '입원' : '외래'}
              {bedInfo && <span className="ml-1">{bedInfo}</span>}
              {doctorCode && (
                <span className={`ml-2 font-medium ${doctorCode === 'C' ? 'text-blue-600' : 'text-green-600'}`}>
                  {doctorCode === 'C' ? '이찬용' : doctorCode === 'J' ? '이재일' : doctorCode}
                </span>
              )}
              {duration && <span className="ml-1">{duration}분</span>}
            </div>
          </div>

          {/* Clinical Info */}
          {hasClinical && (
            <div className="px-3 py-2 space-y-0.5 border-b border-slate-100">
              {clinicalInfo!.diagnosis && (
                <div><span className="text-slate-400">진단:</span> <span className="text-slate-800">{clinicalInfo!.diagnosis}</span></div>
              )}
              {clinicalInfo!.surgeryHistory && (
                <div><span className="text-slate-400">수술:</span> <span className="text-slate-800">{clinicalInfo!.surgeryHistory}</span></div>
              )}
              {clinicalInfo!.chemoPort && (
                <div><span className="text-slate-400">케모포트:</span> <span className="text-slate-800">{clinicalInfo!.chemoPort}</span></div>
              )}
              {clinicalInfo!.ctxHistory && (
                <div><span className="text-slate-400">항암:</span> <span className="text-slate-800">{clinicalInfo!.ctxHistory}</span></div>
              )}
              {clinicalInfo!.rtHistory && (
                <div><span className="text-slate-400">방사선:</span> <span className="text-slate-800">{clinicalInfo!.rtHistory}</span></div>
              )}
              {clinicalInfo!.metastasis && (
                <div><span className="text-slate-400">전이:</span> <span className="text-red-600 font-medium">{clinicalInfo!.metastasis}</span></div>
              )}
            </div>
          )}

          {/* Slot Details */}
          {(treatmentCodes?.length || slotNotes) && (
            <div className="px-3 py-2 text-slate-500">
              {treatmentCodes && treatmentCodes.length > 0 && (
                <div>치료: {treatmentCodes.join(', ')}</div>
              )}
              {slotNotes && <div>메모: {slotNotes}</div>}
            </div>
          )}

          {/* No clinical info message */}
          {!hasClinical && !treatmentCodes?.length && !slotNotes && (
            <div className="px-3 py-2 text-slate-400 italic">임상정보 없음</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
