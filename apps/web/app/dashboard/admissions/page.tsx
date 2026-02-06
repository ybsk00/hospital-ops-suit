'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
  Calendar,
  List,
  Loader2,
} from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  emrPatientId: string;
  sex: string;
  dob: string;
}

interface BedInfo {
  id: string;
  label: string;
  room: { name: string; ward: { name: string } };
}

interface Admission {
  id: string;
  admitDate: string;
  plannedDischargeDate: string | null;
  status: string;
  patient: Patient;
  currentBed: BedInfo | null;
  attendingDoctor: { id: string; name: string };
  version?: number;
}

interface AvailableBed {
  id: string;
  label: string;
  status: string;
  room: { id: string; name: string; ward: { id: string; name: string } };
}

interface WardGroup {
  id: string;
  name: string;
  rooms: RoomGroup[];
}

interface RoomGroup {
  id: string;
  name: string;
  beds: AvailableBed[];
}

interface Doctor {
  id: string;
  name: string;
  loginId: string;
  departments: Array<{ role: string; department: { name: string } }>;
}

const statusLabels: Record<string, string> = {
  ADMITTED: '입원중',
  DISCHARGE_PLANNED: '예약',
  TRANSFER_PLANNED: '전실예정',
  ON_LEAVE: '외출',
  DISCHARGED: '퇴원완료',
};

const statusColors: Record<string, string> = {
  ADMITTED: 'bg-blue-100 text-blue-700',
  DISCHARGE_PLANNED: 'bg-yellow-100 text-yellow-700',
  TRANSFER_PLANNED: 'bg-purple-100 text-purple-700',
  ON_LEAVE: 'bg-orange-100 text-orange-700',
  DISCHARGED: 'bg-slate-100 text-slate-500',
};

type ViewMode = 'daily' | 'weekly' | 'monthly';

export default function AdmissionsPage() {
  const { accessToken } = useAuthStore();

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [currentDate, setCurrentDate] = useState(new Date());

  // List state
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const limit = 20;

  // Calendar state
  const [calendarData, setCalendarData] = useState<Admission[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [availableBeds, setAvailableBeds] = useState<AvailableBed[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({
    patientName: '',
    emrPatientId: '',
    wardId: '',
    roomId: '',
    bedId: '',
    attendingDoctorId: '',
    admitDate: new Date().toISOString().slice(0, 10),
    plannedDischargeDate: '',
    notes: '',
  });

  // Grouped beds by ward/room
  const [wardGroups, setWardGroups] = useState<WardGroup[]>([]);

  // Fetch daily list
  const fetchAdmissions = useCallback(async () => {
    if (!accessToken || viewMode !== 'daily') return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const res = await api<{ items: Admission[]; total: number }>(`/api/admissions?${params}`, {
        token: accessToken,
      });
      setAdmissions(res.data!.items);
      setTotal(res.data!.total);
    } catch {
      // handle
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, search, statusFilter, viewMode]);

  // Fetch calendar data
  const fetchCalendarData = useCallback(async () => {
    if (!accessToken || viewMode === 'daily') return;

    setCalendarLoading(true);
    try {
      let from: Date, to: Date;

      if (viewMode === 'weekly') {
        const day = currentDate.getDay();
        from = new Date(currentDate);
        from.setDate(currentDate.getDate() - day);
        to = new Date(from);
        to.setDate(from.getDate() + 6);
      } else {
        from = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        to = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      }

      const res = await api<Admission[]>(
        `/api/admissions/calendar?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`,
        { token: accessToken }
      );
      setCalendarData(res.data || []);
    } catch {
      // handle
    } finally {
      setCalendarLoading(false);
    }
  }, [accessToken, viewMode, currentDate]);

  useEffect(() => {
    if (viewMode === 'daily') {
      fetchAdmissions();
    } else {
      fetchCalendarData();
    }
  }, [viewMode, fetchAdmissions, fetchCalendarData]);

  // Fetch dropdowns for modal
  const fetchDropdowns = async () => {
    if (!accessToken) return;
    try {
      const [bedsRes, doctorsRes] = await Promise.all([
        api<AvailableBed[]>('/api/admissions/available-beds', { token: accessToken }),
        api<Doctor[]>('/api/admissions/doctors', { token: accessToken }),
      ]);
      const beds = bedsRes.data || [];
      setAvailableBeds(beds);
      setDoctors(doctorsRes.data || []);

      // Group beds by ward and room
      const wardMap = new Map<string, WardGroup>();
      for (const bed of beds) {
        const wardId = bed.room.ward.id;
        const wardName = bed.room.ward.name;
        const roomId = bed.room.id;
        const roomName = bed.room.name;

        if (!wardMap.has(wardId)) {
          wardMap.set(wardId, { id: wardId, name: wardName, rooms: [] });
        }

        const ward = wardMap.get(wardId)!;
        let room = ward.rooms.find(r => r.id === roomId);
        if (!room) {
          room = { id: roomId, name: roomName, beds: [] };
          ward.rooms.push(room);
        }
        room.beds.push(bed);
      }

      // Sort
      const groups = Array.from(wardMap.values());
      groups.sort((a, b) => a.name.localeCompare(b.name));
      for (const ward of groups) {
        ward.rooms.sort((a, b) => a.name.localeCompare(b.name));
        for (const room of ward.rooms) {
          room.beds.sort((a, b) => a.label.localeCompare(b.label));
        }
      }
      setWardGroups(groups);
    } catch {
      // handle
    }
  };

  // Handle new admission
  const handleNewAdmission = async () => {
    if (!accessToken) return;

    // 필수값 체크
    if (!form.patientName || !form.emrPatientId || !form.bedId || !form.attendingDoctorId || !form.admitDate || !form.plannedDischargeDate) {
      alert('필수 항목을 모두 입력해주세요.');
      return;
    }

    setSaving(true);
    try {
      await api('/api/admissions', {
        method: 'POST',
        token: accessToken,
        body: {
          newPatient: {
            name: form.patientName,
            emrPatientId: form.emrPatientId,
          },
          bedId: form.bedId,
          attendingDoctorId: form.attendingDoctorId,
          admitDate: form.admitDate,
          plannedDischargeDate: form.plannedDischargeDate,
          notes: form.notes || undefined,
          isReservation: new Date(form.admitDate) > new Date(),
        },
      });

      alert('등록되었습니다.');
      setShowNewModal(false);
      setForm({
        patientName: '',
        emrPatientId: '',
        wardId: '',
        roomId: '',
        bedId: '',
        attendingDoctorId: '',
        admitDate: new Date().toISOString().slice(0, 10),
        plannedDischargeDate: '',
        notes: '',
      });
      fetchAdmissions();
      fetchCalendarData();
    } catch (err: any) {
      alert(err.message || '등록 실패');
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async (id: string, patientName: string) => {
    if (!accessToken) return;
    if (!confirm(`"${patientName}" 입원/예약을 삭제하시겠습니까?`)) return;

    try {
      await api(`/api/admissions/${id}`, {
        method: 'DELETE',
        token: accessToken,
      });
      alert('삭제되었습니다.');
      fetchAdmissions();
      fetchCalendarData();
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  };

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

  const totalPages = Math.ceil(total / limit);

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

    // 이전 달 padding
    const startDayOfWeek = firstDay.getDay();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      days.push(new Date(year, month, -i));
    }

    // 이번 달
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    // 다음 달 padding
    while (days.length < 42) {
      days.push(new Date(year, month + 1, days.length - lastDay.getDate() - startDayOfWeek + 1));
    }

    return days;
  };

  // Get admissions for a specific date
  const getAdmissionsForDate = (date: Date) => {
    const dateStr = date.toISOString().slice(0, 10);
    return calendarData.filter((adm) => {
      const admitDate = adm.admitDate.slice(0, 10);
      const dischargeDate = adm.plannedDischargeDate?.slice(0, 10);
      return admitDate === dateStr || dischargeDate === dateStr;
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">입원 관리</h1>
          <p className="text-slate-500 mt-1">입원 환자를 관리하고 예약을 등록합니다.</p>
        </div>
        <button
          onClick={() => {
            fetchDropdowns();
            setShowNewModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
        >
          <Plus size={16} />
          새 예약
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
            <button
              onClick={() => navigateDate(-1)}
              className="p-1.5 rounded hover:bg-slate-100"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {viewMode === 'weekly'
                ? `${getWeekDays()[0].toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} - ${getWeekDays()[6].toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}`
                : currentDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })}
            </span>
            <button
              onClick={() => navigateDate(1)}
              className="p-1.5 rounded hover:bg-slate-100"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Daily View */}
      {viewMode === 'daily' && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="환자명 검색..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">전체 상태</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">환자</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">EMR ID</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">병실/베드</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">담당의</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">입원일</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">퇴원예정</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">상태</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600 w-16">삭제</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">로딩 중...</td></tr>
                ) : admissions.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">데이터가 없습니다.</td></tr>
                ) : (
                  admissions.map((adm) => (
                    <tr key={adm.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium">{adm.patient.name}</td>
                      <td className="px-4 py-3 text-slate-500">{adm.patient.emrPatientId}</td>
                      <td className="px-4 py-3">
                        {adm.currentBed
                          ? `${adm.currentBed.room.ward.name} ${adm.currentBed.room.name}-${adm.currentBed.label}`
                          : '-'}
                      </td>
                      <td className="px-4 py-3">{adm.attendingDoctor.name}</td>
                      <td className="px-4 py-3">{new Date(adm.admitDate).toLocaleDateString('ko-KR')}</td>
                      <td className="px-4 py-3">
                        {adm.plannedDischargeDate
                          ? new Date(adm.plannedDischargeDate).toLocaleDateString('ko-KR')
                          : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[adm.status] || ''}`}>
                          {statusLabels[adm.status] || adm.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDelete(adm.id, adm.patient.name)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                <span className="text-xs text-slate-500">총 {total}건</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-sm px-2">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Weekly View */}
      {viewMode === 'weekly' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {calendarLoading ? (
            <div className="text-center py-12 text-slate-400">로딩 중...</div>
          ) : (
            <div className="grid grid-cols-7">
              {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => (
                <div key={day} className={`px-2 py-2 text-center text-xs font-medium border-b border-slate-200 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'}`}>
                  {day}
                </div>
              ))}
              {getWeekDays().map((date, i) => {
                const dayAdmissions = getAdmissionsForDate(date);
                const dateStr = date.toISOString().slice(0, 10);
                const isToday = dateStr === new Date().toISOString().slice(0, 10);
                return (
                  <div
                    key={i}
                    className={`min-h-[120px] p-2 border-r border-b border-slate-100 ${isToday ? 'bg-blue-50' : ''}`}
                  >
                    <div className={`text-sm font-medium mb-2 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-700'}`}>
                      {date.getDate()}
                    </div>
                    <div className="space-y-1">
                      {dayAdmissions.map((adm) => {
                        const isAdmit = adm.admitDate.slice(0, 10) === dateStr;
                        const isDischarge = adm.plannedDischargeDate?.slice(0, 10) === dateStr;
                        return (
                          <div
                            key={adm.id}
                            className={`text-xs px-1.5 py-1 rounded truncate ${
                              isAdmit
                                ? 'bg-green-100 text-green-700'
                                : isDischarge
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                            title={`${adm.patient.name} - ${isAdmit ? '입원' : '퇴원예정'}`}
                          >
                            {isAdmit ? '▶' : '◀'} {adm.patient.name}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Monthly View */}
      {viewMode === 'monthly' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {calendarLoading ? (
            <div className="text-center py-12 text-slate-400">로딩 중...</div>
          ) : (
            <div className="grid grid-cols-7">
              {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => (
                <div key={day} className={`px-2 py-2 text-center text-xs font-medium border-b border-slate-200 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-slate-600'}`}>
                  {day}
                </div>
              ))}
              {getMonthDays().map((date, i) => {
                const dayAdmissions = getAdmissionsForDate(date);
                const dateStr = date.toISOString().slice(0, 10);
                const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                const isToday = dateStr === new Date().toISOString().slice(0, 10);
                return (
                  <div
                    key={i}
                    className={`min-h-[80px] p-1 border-r border-b border-slate-100 ${
                      !isCurrentMonth ? 'bg-slate-50' : isToday ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className={`text-xs font-medium mb-1 ${
                      !isCurrentMonth
                        ? 'text-slate-300'
                        : i % 7 === 0 ? 'text-red-500' : i % 7 === 6 ? 'text-blue-500' : 'text-slate-700'
                    }`}>
                      {date.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {dayAdmissions.slice(0, 3).map((adm) => {
                        const isAdmit = adm.admitDate.slice(0, 10) === dateStr;
                        return (
                          <div
                            key={adm.id}
                            className={`text-[10px] px-1 py-0.5 rounded truncate ${
                              isAdmit
                                ? 'bg-green-100 text-green-700'
                                : 'bg-orange-100 text-orange-700'
                            }`}
                            title={adm.patient.name}
                          >
                            {adm.patient.name}
                          </div>
                        );
                      })}
                      {dayAdmissions.length > 3 && (
                        <div className="text-[10px] text-slate-400">+{dayAdmissions.length - 3}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Legend */}
          <div className="px-4 py-2 border-t border-slate-200 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-green-100 rounded"></span> 입원
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-orange-100 rounded"></span> 퇴원예정
            </span>
          </div>
        </div>
      )}

      {/* New Admission Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">새 예약 등록</h2>
              <button onClick={() => setShowNewModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 환자명 (필수) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  환자명 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.patientName}
                  onChange={(e) => setForm({ ...form, patientName: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="환자 이름"
                />
              </div>

              {/* EMR ID (필수) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  차트번호 (EMR ID) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.emrPatientId}
                  onChange={(e) => setForm({ ...form, emrPatientId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="차트번호"
                />
              </div>

              {/* 병동 선택 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  병동 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.wardId}
                  onChange={(e) => setForm({ ...form, wardId: e.target.value, roomId: '', bedId: '' })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">병동 선택</option>
                  {wardGroups.map((ward) => (
                    <option key={ward.id} value={ward.id}>
                      {ward.name} ({ward.rooms.reduce((sum, r) => sum + r.beds.length, 0)}개 베드 가용)
                    </option>
                  ))}
                </select>
              </div>

              {/* 병실 선택 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  병실 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.roomId}
                  onChange={(e) => setForm({ ...form, roomId: e.target.value, bedId: '' })}
                  disabled={!form.wardId}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100 disabled:cursor-not-allowed"
                >
                  <option value="">병실 선택</option>
                  {wardGroups.find(w => w.id === form.wardId)?.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name} ({room.beds.length}개 베드 가용)
                    </option>
                  ))}
                </select>
              </div>

              {/* 베드 선택 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  베드 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.bedId}
                  onChange={(e) => setForm({ ...form, bedId: e.target.value })}
                  disabled={!form.roomId}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100 disabled:cursor-not-allowed"
                >
                  <option value="">베드 선택</option>
                  {wardGroups.find(w => w.id === form.wardId)?.rooms.find(r => r.id === form.roomId)?.beds.map((bed) => (
                    <option key={bed.id} value={bed.id}>
                      {bed.label} ({bed.status === 'EMPTY' ? '빈 베드' : '예약중'})
                    </option>
                  ))}
                </select>
              </div>

              {/* 담당의 (필수) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  담당의 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.attendingDoctorId}
                  onChange={(e) => setForm({ ...form, attendingDoctorId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">선택하세요</option>
                  {doctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name} ({doc.departments.map(d => d.department.name).join(', ')})
                    </option>
                  ))}
                </select>
              </div>

              {/* 입원일 (필수) - 과거 날짜도 허용 (소급 입력) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  입원일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.admitDate}
                  onChange={(e) => setForm({ ...form, admitDate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                {form.admitDate && new Date(form.admitDate) < new Date(new Date().toISOString().slice(0, 10)) && (
                  <p className="text-xs text-orange-600 mt-1">
                    * 과거 날짜입니다. 소급 입력으로 처리됩니다.
                  </p>
                )}
                {form.admitDate && new Date(form.admitDate) > new Date() && (
                  <p className="text-xs text-blue-600 mt-1">
                    * 미래 날짜입니다. 예약으로 처리됩니다.
                  </p>
                )}
              </div>

              {/* 퇴원예정일 (필수) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  퇴원예정일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.plannedDischargeDate}
                  onChange={(e) => setForm({ ...form, plannedDischargeDate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* 비고 (선택) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">비고</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  placeholder="특이사항"
                />
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
              >
                취소
              </button>
              <button
                onClick={handleNewAdmission}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    저장 중...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    등록
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
