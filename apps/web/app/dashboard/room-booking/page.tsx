'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import { RefreshCw } from 'lucide-react';

/* ── API 응답 타입 ── */
interface RoomBookingRow {
  roomName: string;
  bedLabel: string;
  bedId: string;
  bedStatus: string;
  patientName: string | null;
  patientId: string | null;
  admitDate: string | null;
  plannedDischargeDate: string | null;
  isFutureDischarge: boolean;
  doctorName: string | null;
  treatments: string[];
  admissionStatus: string | null;
}

function formatDischarge(row: RoomBookingRow): { text: string; className: string } {
  if (!row.plannedDischargeDate) return { text: '-', className: 'text-slate-300' };
  const planned = new Date(row.plannedDischargeDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (planned >= today) {
    return { text: `${row.plannedDischargeDate} (예정)`, className: 'text-blue-600' };
  }
  return { text: `${row.plannedDischargeDate} (예정초과)`, className: 'text-red-500 font-medium' };
}

export default function RoomBookingPage() {
  const { accessToken } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RoomBookingRow[]>([]);

  const fetchTable = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/api/room-booking/table', { token: accessToken || undefined });
      if (res.success) setRows(res.data.rows || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    fetchTable();
  }, [fetchTable]);

  // 병실별 그룹핑 (rowSpan 계산)
  const roomGroups: Record<string, RoomBookingRow[]> = {};
  for (const row of rows) {
    if (!roomGroups[row.roomName]) roomGroups[row.roomName] = [];
    roomGroups[row.roomName].push(row);
  }

  // 통계
  const totalBeds = rows.length;
  const occupied = rows.filter((r) => r.bedStatus === 'OCCUPIED').length;
  const empty = rows.filter((r) => r.bedStatus === 'EMPTY').length;
  const reserved = rows.filter((r) => r.bedStatus === 'RESERVED').length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-slate-800">병실현황</h1>
        <button
          onClick={fetchTable}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

      {/* 요약 */}
      <div className="flex items-center gap-6 mb-4 bg-slate-50 rounded-lg px-4 py-3 text-sm">
        <span>전체 <strong className="text-slate-700">{totalBeds}</strong></span>
        <span>재원 <strong className="text-blue-600">{occupied}</strong></span>
        <span>빈 베드 <strong className="text-green-600">{empty}</strong></span>
        {reserved > 0 && <span>예약 <strong className="text-orange-500">{reserved}</strong></span>}
      </div>

      {loading && <div className="text-center py-8 text-slate-400">불러오는 중...</div>}

      {!loading && rows.length === 0 && (
        <div className="text-center py-12 text-slate-400">병실 데이터가 없습니다.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-20">병실</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-14">베드</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-20">환자명</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-28">입원일</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-36">퇴원일(예정)</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-20">주치의</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">치료내용</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(roomGroups).map(([roomName, beds]) =>
                beds.map((row, idx) => {
                  const discharge = formatDischarge(row);
                  const isOccupied = row.bedStatus === 'OCCUPIED';
                  const isEmpty = row.bedStatus === 'EMPTY';

                  return (
                    <tr
                      key={row.bedId}
                      className={`border-b ${isOccupied ? 'bg-white' : 'bg-slate-50/50'} hover:bg-blue-50/30`}
                    >
                      {/* 병실명 - rowSpan */}
                      {idx === 0 && (
                        <td
                          rowSpan={beds.length}
                          className="px-3 py-2 font-semibold text-slate-700 align-top border-r bg-slate-50/80"
                        >
                          {roomName}
                        </td>
                      )}
                      <td className="px-3 py-2 text-slate-500">{row.bedLabel}</td>
                      <td className="px-3 py-2">
                        {row.patientName ? (
                          <span className="font-medium text-slate-800">{row.patientName}</span>
                        ) : (
                          <span className={`${isEmpty ? 'text-green-500' : 'text-slate-300'}`}>
                            {isEmpty ? '(빈 베드)' : '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.admitDate || '-'}</td>
                      <td className={`px-3 py-2 ${discharge.className}`}>{discharge.text}</td>
                      <td className="px-3 py-2 text-slate-600">{row.doctorName || '-'}</td>
                      <td className="px-3 py-2">
                        {row.treatments.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.treatments.map((t, i) => (
                              <span
                                key={i}
                                className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
