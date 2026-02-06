'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  BedDouble,
  RefreshCw,
  User,
  ChevronLeft,
  ChevronRight,
  Calendar,
  List,
} from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  emrPatientId: string;
  sex: string;
  dob: string;
}

interface Admission {
  id: string;
  status: string;
  admitDate: string;
  plannedDischargeDate: string | null;
  patient: Patient;
}

interface Bed {
  id: string;
  label: string;
  status: string;
  version: number;
  currentAdmission: Admission | null;
}

interface Room {
  id: string;
  name: string;
  beds: Bed[];
}

interface Ward {
  id: string;
  name: string;
  floor: number | null;
  rooms: Room[];
}

interface Stats {
  total: number;
  empty: number;
  occupied: number;
  reserved: number;
  cleaning: number;
  isolation: number;
  outOfOrder: number;
}

// 간소화된 상태 (예약, 사용중, 사용불가만)
const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  EMPTY: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300' },
  OCCUPIED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
  RESERVED: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-300' },
  CLEANING: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
  ISOLATION: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
  OUT_OF_ORDER: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-300' },
};

const statusLabels: Record<string, string> = {
  EMPTY: '빈 베드',
  OCCUPIED: '사용중',
  RESERVED: '예약',
  CLEANING: '청소 중',
  ISOLATION: '격리',
  OUT_OF_ORDER: '사용불가',
};

// 간소화된 상태 옵션
const simpleStatusOptions = [
  { key: 'RESERVED', label: '예약' },
  { key: 'OCCUPIED', label: '사용중' },
  { key: 'OUT_OF_ORDER', label: '사용불가' },
];

type ViewMode = 'daily' | 'weekly' | 'monthly';

export default function BedsPage() {
  const { accessToken } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [wards, setWards] = useState<Ward[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchBeds = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api<{ wards: Ward[]; stats: Stats }>(`/api/beds${query}`, {
        token: accessToken,
      });
      setWards(res.data!.wards);
      setStats(res.data!.stats);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter]);

  useEffect(() => {
    fetchBeds();
  }, [fetchBeds]);

  async function handleStatusChange(bed: Bed, newStatus: string) {
    if (!accessToken) return;
    try {
      await api(`/api/beds/${bed.id}/status`, {
        method: 'PATCH',
        body: { status: newStatus, version: bed.version },
        token: accessToken,
      });
      await fetchBeds();
      setSelectedBed(null);
    } catch (err: any) {
      alert(err.message || '상태 변경에 실패했습니다.');
    }
  }

  // Date navigation
  const navigateDate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (viewMode === 'weekly') {
      d.setDate(d.getDate() + dir * 7);
    } else {
      d.setMonth(d.getMonth() + dir);
    }
    setCurrentDate(d);
  };

  // Generate week days
  const getWeekDays = () => {
    const day = currentDate.getDay();
    const start = new Date(currentDate);
    start.setDate(currentDate.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  };

  // Generate month days
  const getMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: Date[] = [];

    const startDayOfWeek = firstDay.getDay();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push(new Date(year, month, -i));
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    while (days.length < 42) {
      days.push(new Date(year, month + 1, days.length - lastDay.getDate() - startDayOfWeek + 1));
    }

    return days;
  };

  // Get beds with admissions for date range (for weekly/monthly view)
  const getBedsWithSchedule = () => {
    const allBeds = wards.flatMap(w => w.rooms.flatMap(r => r.beds.map(b => ({
      ...b,
      wardName: w.name,
      roomName: r.name,
    }))));
    return allBeds.filter(b => b.currentAdmission);
  };

  // Simplified stats (only 예약, 사용중, 사용불가)
  const simpleStats = stats ? {
    total: stats.total,
    reserved: stats.reserved,
    occupied: stats.occupied,
    unavailable: stats.outOfOrder + stats.isolation + stats.cleaning,
    available: stats.empty,
  } : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">베드 관리</h1>
          <p className="text-slate-500 mt-1">병동별 베드 현황을 확인하고 관리합니다.</p>
        </div>
        <button
          onClick={fetchBeds}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {/* View Mode Tabs */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex bg-slate-100 rounded-lg p-1">
          {[
            { key: 'daily', label: '일간', icon: List },
            { key: 'weekly', label: '주간', icon: Calendar },
            { key: 'monthly', label: '월간', icon: Calendar },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setViewMode(key as ViewMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                viewMode === key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {viewMode !== 'daily' && (
          <div className="flex items-center gap-2">
            <button onClick={() => navigateDate(-1)} className="p-1.5 rounded hover:bg-slate-100">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {viewMode === 'weekly'
                ? `${getWeekDays()[0].toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} - ${getWeekDays()[6].toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}`
                : currentDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })}
            </span>
            <button onClick={() => navigateDate(1)} className="p-1.5 rounded hover:bg-slate-100">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Daily View */}
      {viewMode === 'daily' && (
        <>
          {/* Stats */}
          {simpleStats && (
            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { key: 'total', label: '전체', value: simpleStats.total, color: 'bg-slate-600' },
                { key: 'available', label: '빈 베드', value: simpleStats.available, color: 'bg-green-500' },
                { key: 'occupied', label: '사용중', value: simpleStats.occupied, color: 'bg-blue-500' },
                { key: 'reserved', label: '예약', value: simpleStats.reserved, color: 'bg-yellow-500' },
              ].map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStatusFilter(s.key === 'total' ? '' : s.key === 'available' ? 'EMPTY' : s.key.toUpperCase())}
                  className={`p-3 rounded-xl border text-center transition ${
                    (statusFilter === '' && s.key === 'total') ||
                    (statusFilter === 'EMPTY' && s.key === 'available') ||
                    statusFilter === s.key.toUpperCase()
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-3 h-3 ${s.color} rounded-full mx-auto mb-2`} />
                  <div className="text-lg font-bold text-slate-900">{s.value}</div>
                  <div className="text-xs text-slate-500">{s.label}</div>
                </button>
              ))}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-12 text-slate-400">로딩 중...</div>
          )}

          {/* Ward Grid */}
          {!loading && wards.map((ward) => (
            <div key={ward.id} className="mb-8">
              <h2 className="text-lg font-semibold text-slate-900 mb-3">
                {ward.name} {ward.floor && `(${ward.floor}층)`}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {ward.rooms.map((room) => (
                  <div key={room.id} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm font-medium text-slate-600 mb-3">{room.name}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {room.beds.map((bed) => {
                        const colors = statusColors[bed.status] || statusColors.EMPTY;
                        return (
                          <button
                            key={bed.id}
                            onClick={() => setSelectedBed(bed)}
                            className={`p-3 rounded-lg border ${colors.bg} ${colors.border} ${colors.text} text-left transition hover:shadow-md`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold">{bed.label}</span>
                            </div>
                            <div className="text-xs mb-1">{statusLabels[bed.status]}</div>
                            {bed.currentAdmission && (
                              <div className="flex items-center gap-1 mt-1">
                                <User size={10} />
                                <span className="text-xs font-medium truncate">
                                  {bed.currentAdmission.patient.name}
                                </span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Empty State */}
          {!loading && wards.length === 0 && (
            <div className="text-center py-12">
              <BedDouble size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-slate-500">베드 데이터가 없습니다.</p>
            </div>
          )}
        </>
      )}

      {/* Weekly View */}
      {viewMode === 'weekly' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="text-center py-12 text-slate-400">로딩 중...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-600 min-w-[150px]">베드</th>
                    {getWeekDays().map((date, i) => {
                      const dateStr = date.toISOString().slice(0, 10);
                      const isToday = dateStr === new Date().toISOString().slice(0, 10);
                      return (
                        <th
                          key={i}
                          className={`text-center px-2 py-3 font-medium min-w-[100px] ${
                            isToday ? 'bg-blue-50' : ''
                          } ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'}`}
                        >
                          <div>{['일', '월', '화', '수', '목', '금', '토'][i]}</div>
                          <div className="text-xs">{date.getMonth() + 1}/{date.getDate()}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {getBedsWithSchedule().map((bed) => {
                    const adm = bed.currentAdmission;
                    return (
                      <tr key={bed.id} className="border-b border-slate-100">
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">{bed.wardName} {bed.roomName}-{bed.label}</div>
                          {adm && <div className="text-xs text-slate-500">{adm.patient.name}</div>}
                        </td>
                        {getWeekDays().map((date, i) => {
                          const dateStr = date.toISOString().slice(0, 10);
                          const isToday = dateStr === new Date().toISOString().slice(0, 10);

                          if (!adm) return <td key={i} className={`px-2 py-2 text-center ${isToday ? 'bg-blue-50' : ''}`}>-</td>;

                          const admitDate = new Date(adm.admitDate).toISOString().slice(0, 10);
                          const dischargeDate = adm.plannedDischargeDate ? new Date(adm.plannedDischargeDate).toISOString().slice(0, 10) : null;

                          const isInRange = dateStr >= admitDate && (!dischargeDate || dateStr <= dischargeDate);
                          const isAdmitDay = dateStr === admitDate;
                          const isDischargeDay = dateStr === dischargeDate;

                          return (
                            <td key={i} className={`px-2 py-2 text-center ${isToday ? 'bg-blue-50' : ''}`}>
                              {isInRange ? (
                                <div className={`text-xs px-1 py-1 rounded ${
                                  isAdmitDay ? 'bg-green-100 text-green-700' :
                                  isDischargeDay ? 'bg-orange-100 text-orange-700' :
                                  'bg-blue-100 text-blue-700'
                                }`}>
                                  {isAdmitDay ? '입원' : isDischargeDay ? '퇴원' : '입원중'}
                                </div>
                              ) : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {/* Legend */}
          <div className="px-4 py-2 border-t border-slate-200 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-100 rounded"></span> 입원</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 rounded"></span> 입원중</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-100 rounded"></span> 퇴원예정</span>
          </div>
        </div>
      )}

      {/* Monthly View */}
      {viewMode === 'monthly' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="text-center py-12 text-slate-400">로딩 중...</div>
          ) : (
            <div className="grid grid-cols-7">
              {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => (
                <div key={day} className={`px-2 py-2 text-center text-xs font-medium border-b border-slate-200 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'}`}>
                  {day}
                </div>
              ))}
              {getMonthDays().map((date, i) => {
                const dateStr = date.toISOString().slice(0, 10);
                const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                const isToday = dateStr === new Date().toISOString().slice(0, 10);

                // 해당 날짜에 입원중인 베드 수 계산
                const bedsInUse = getBedsWithSchedule().filter(bed => {
                  const adm = bed.currentAdmission;
                  if (!adm) return false;
                  const admitDate = new Date(adm.admitDate).toISOString().slice(0, 10);
                  const dischargeDate = adm.plannedDischargeDate ? new Date(adm.plannedDischargeDate).toISOString().slice(0, 10) : null;
                  return dateStr >= admitDate && (!dischargeDate || dateStr <= dischargeDate);
                });

                return (
                  <div
                    key={i}
                    className={`min-h-[60px] p-1 border-r border-b border-slate-100 ${
                      !isCurrentMonth ? 'bg-slate-50' : isToday ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className={`text-xs font-medium mb-1 ${
                      !isCurrentMonth ? 'text-slate-300' : i % 7 === 0 ? 'text-red-500' : i % 7 === 6 ? 'text-blue-500' : 'text-slate-700'
                    }`}>
                      {date.getDate()}
                    </div>
                    {isCurrentMonth && bedsInUse.length > 0 && (
                      <div className="text-[10px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded">
                        {bedsInUse.length}병상 사용
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Bed Detail Modal */}
      {selectedBed && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40" onClick={() => setSelectedBed(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">베드 상세</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">베드</span>
                <span className="font-medium">{selectedBed.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">상태</span>
                <span className={`font-medium ${statusColors[selectedBed.status]?.text}`}>
                  {statusLabels[selectedBed.status]}
                </span>
              </div>
              {selectedBed.currentAdmission && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">환자</span>
                    <span className="font-medium">{selectedBed.currentAdmission.patient.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">EMR ID</span>
                    <span>{selectedBed.currentAdmission.patient.emrPatientId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">입원일</span>
                    <span>{new Date(selectedBed.currentAdmission.admitDate).toLocaleDateString('ko-KR')}</span>
                  </div>
                  {selectedBed.currentAdmission.plannedDischargeDate && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">퇴원예정</span>
                      <span>{new Date(selectedBed.currentAdmission.plannedDischargeDate).toLocaleDateString('ko-KR')}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Status Change Buttons - 간소화 (예약, 사용중, 사용불가만) */}
            {selectedBed.status !== 'OCCUPIED' && (
              <div className="mt-6">
                <div className="text-xs text-slate-500 mb-2">상태 변경</div>
                <div className="flex flex-wrap gap-2">
                  {simpleStatusOptions
                    .filter((opt) => opt.key !== selectedBed.status)
                    .map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => handleStatusChange(selectedBed, opt.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statusColors[opt.key]?.bg} ${statusColors[opt.key]?.border} ${statusColors[opt.key]?.text} hover:shadow-sm transition`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  {/* 빈 베드로 변경 */}
                  {selectedBed.status !== 'EMPTY' && selectedBed.status !== 'OCCUPIED' && (
                    <button
                      onClick={() => handleStatusChange(selectedBed, 'EMPTY')}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-green-50 border-green-300 text-green-700 hover:shadow-sm transition"
                    >
                      빈 베드
                    </button>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={() => setSelectedBed(null)}
              className="mt-4 w-full py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm transition"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
