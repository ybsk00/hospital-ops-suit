'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  ChevronLeft,
  ChevronRight,
  UserPlus,
  CalendarDays,
  BedDouble,
  ArrowDown,
  ArrowUp,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react';

/* ── 타입 ── */
interface ReservationAdmission {
  id: string;
  admitDate: string;
  plannedDischargeDate: string | null;
  status: string;
  notes: string | null;
  version: number;
  patient: {
    id: string;
    name: string;
    emrPatientId: string;
    dob: string | null;
    sex: string | null;
    phone: string | null;
  };
  currentBed: {
    id: string;
    label: string;
    status: string;
    room: {
      id: string;
      name: string;
      ward: { id: string; name: string };
    };
  } | null;
  attendingDoctor: { id: string; name: string } | null;
}

interface BedProjectionDay {
  date: string;
  inHospital: number;
  admitting: number;
  discharging: number;
  available: number;
  events: Array<{
    type: 'ADMIT' | 'DISCHARGE';
    patientName: string;
    roomName: string | null;
    bedLabel: string | null;
    doctorName: string | null;
  }>;
}

interface AvailableBed {
  id: string;
  label: string;
  status: string;
  room: {
    id: string;
    name: string;
    ward: { id: string; name: string };
  };
}

interface DoctorOption {
  id: string;
  name: string;
}

/* ── 뷰 모드 ── */
type ViewMode = 'reservations' | 'projection';

/* ── 날짜 헬퍼 ── */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateKR(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekday})`;
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
}

function getWeekDates(baseDate: string): string[] {
  const d = new Date(baseDate + 'T00:00:00');
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    dates.push(toDateStr(dd));
  }
  return dates;
}

export default function AdmissionReservationPage() {
  const { accessToken } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>('reservations');
  const [loading, setLoading] = useState(false);

  // 예약 목록
  const [reservations, setReservations] = useState<ReservationAdmission[]>([]);
  const [currentAdmissions, setCurrentAdmissions] = useState<ReservationAdmission[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // 병상 전망
  const [projectionDate, setProjectionDate] = useState(() => toDateStr(new Date()));
  const [projectionDays, setProjectionDays] = useState<BedProjectionDay[]>([]);
  const [totalBeds, setTotalBeds] = useState(0);

  // 신규 예약 모달
  const [showModal, setShowModal] = useState(false);
  const [availableBeds, setAvailableBeds] = useState<AvailableBed[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [formData, setFormData] = useState({
    patientName: '',
    emrPatientId: '',
    admitDate: '',
    plannedDischargeDate: '',
    bedId: '',
    attendingDoctorId: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // 예약 목록 로드
  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{
        reservations: ReservationAdmission[];
        currentAdmissions: ReservationAdmission[];
        total: number;
        futureCount: number;
      }>('/api/admissions/reservations', {
        token: accessToken || undefined,
      });
      if (res.success && res.data) {
        setReservations(res.data.reservations);
        setCurrentAdmissions(res.data.currentAdmissions);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [accessToken]);

  // 병상 전망 로드
  const fetchProjection = useCallback(async () => {
    setLoading(true);
    try {
      const weekDates = getWeekDates(projectionDate);
      const from = weekDates[0];
      const to = weekDates[6];
      const res = await api<{ totalBeds: number; days: BedProjectionDay[] }>(
        `/api/admissions/bed-projection?from=${from}&to=${to}`,
        { token: accessToken || undefined },
      );
      if (res.success && res.data) {
        setProjectionDays(res.data.days);
        setTotalBeds(res.data.totalBeds);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectionDate, accessToken]);

  // 모달용 데이터 로드
  const fetchModalData = useCallback(async () => {
    try {
      const [bedsRes, doctorsRes] = await Promise.all([
        api<AvailableBed[]>('/api/admissions/available-beds', {
          token: accessToken || undefined,
        }),
        api<DoctorOption[]>('/api/admissions/doctors', {
          token: accessToken || undefined,
        }),
      ]);
      if (bedsRes.success && bedsRes.data) setAvailableBeds(bedsRes.data);
      if (doctorsRes.success && doctorsRes.data) setDoctors(doctorsRes.data);
    } catch { /* ignore */ }
  }, [accessToken]);

  useEffect(() => {
    if (viewMode === 'reservations') {
      fetchReservations();
    } else {
      fetchProjection();
    }
  }, [viewMode, fetchReservations, fetchProjection]);

  const moveWeek = (delta: number) => {
    const d = new Date(projectionDate + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    setProjectionDate(toDateStr(d));
  };

  // 검색 필터
  const filteredReservations = reservations.filter((a) =>
    !searchTerm ||
    a.patient.name.includes(searchTerm) ||
    a.patient.emrPatientId.includes(searchTerm),
  );

  // 신규 예약
  const openModal = () => {
    setShowModal(true);
    setFormData({
      patientName: '',
      emrPatientId: '',
      admitDate: '',
      plannedDischargeDate: '',
      bedId: '',
      attendingDoctorId: '',
      notes: '',
    });
    fetchModalData();
  };

  const handleSubmit = async () => {
    if (!formData.patientName || !formData.emrPatientId || !formData.admitDate || !formData.attendingDoctorId) {
      alert('환자명, 차트번호, 입원예정일, 담당의를 입력해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        newPatient: {
          name: formData.patientName,
          emrPatientId: formData.emrPatientId,
        },
        admitDate: formData.admitDate,
        attendingDoctorId: formData.attendingDoctorId,
        isReservation: true,
      };
      if (formData.plannedDischargeDate) payload.plannedDischargeDate = formData.plannedDischargeDate;
      if (formData.bedId) payload.bedId = formData.bedId;
      if (formData.notes) payload.notes = formData.notes;

      const res = await api<any>('/api/admissions', {
        method: 'POST',
        token: accessToken || undefined,
        body: payload,
      });

      if (res.success) {
        setShowModal(false);
        fetchReservations();
      } else {
        alert(res.error?.message || '예약 생성에 실패했습니다.');
      }
    } catch {
      alert('예약 생성에 실패했습니다.');
    }
    setSubmitting(false);
  };

  // 예약 취소
  const cancelReservation = async (id: string) => {
    if (!confirm('이 입원 예약을 취소하시겠습니까?')) return;
    try {
      const res = await api<any>(`/api/admissions/${id}`, {
        method: 'DELETE',
        token: accessToken || undefined,
      });
      if (res.success) {
        fetchReservations();
      } else {
        alert(res.error?.message || '취소에 실패했습니다.');
      }
    } catch {
      alert('취소에 실패했습니다.');
    }
  };

  const todayStr = toDateStr(new Date());

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <UserPlus className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">입원예약</h1>
            <p className="text-sm text-gray-500">입원 예약 관리 및 병상 전망</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 뷰 모드 탭 */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('reservations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${
                viewMode === 'reservations'
                  ? 'bg-white text-emerald-700 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <CalendarDays size={14} />
              예약 목록
            </button>
            <button
              onClick={() => setViewMode('projection')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition ${
                viewMode === 'projection'
                  ? 'bg-white text-emerald-700 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <BedDouble size={14} />
              병상 전망
            </button>
          </div>

          {viewMode === 'reservations' && (
            <button
              onClick={openModal}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 font-medium"
            >
              <Plus size={14} />
              새 입원예약
            </button>
          )}
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}

      {/* ───── 예약 목록 ───── */}
      {!loading && viewMode === 'reservations' && (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-sm text-gray-500 mb-1">현재 재원</div>
              <div className="text-2xl font-bold text-gray-800">{currentAdmissions.length}명</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <div className="text-sm text-emerald-600 mb-1">입원 예약</div>
              <div className="text-2xl font-bold text-emerald-700">{reservations.length}건</div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="text-sm text-blue-600 mb-1">이번 주 입원예정</div>
              <div className="text-2xl font-bold text-blue-700">
                {reservations.filter((r) => {
                  const weekDates = getWeekDates(todayStr);
                  const admitStr = r.admitDate.substring(0, 10);
                  return admitStr >= weekDates[0] && admitStr <= weekDates[6];
                }).length}건
              </div>
            </div>
          </div>

          {/* 검색 */}
          <div className="mb-4">
            <div className="relative max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="환자명 또는 차트번호 검색"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>

          {/* 예약 테이블 */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">입원예정일</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">환자명</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">차트번호</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">배정병실</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">담당의</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">퇴원예정</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">비고</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">상태</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredReservations.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                      입원 예약이 없습니다.
                    </td>
                  </tr>
                )}
                {filteredReservations.map((r) => {
                  const admitDateStr = r.admitDate.substring(0, 10);
                  const isThisWeek = (() => {
                    const weekDates = getWeekDates(todayStr);
                    return admitDateStr >= weekDates[0] && admitDateStr <= weekDates[6];
                  })();
                  const isTomorrow = (() => {
                    const tmr = new Date();
                    tmr.setDate(tmr.getDate() + 1);
                    return admitDateStr === toDateStr(tmr);
                  })();

                  return (
                    <tr key={r.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-800">{formatDateKR(admitDateStr)}</span>
                        {isTomorrow && (
                          <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">내일</span>
                        )}
                        {isThisWeek && !isTomorrow && (
                          <span className="ml-1.5 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">이번주</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{r.patient.name}</td>
                      <td className="px-4 py-3 text-gray-500">{r.patient.emrPatientId}</td>
                      <td className="px-4 py-3">
                        {r.currentBed ? (
                          <span className="text-gray-700">
                            {r.currentBed.room.name} {r.currentBed.label}
                          </span>
                        ) : (
                          <span className="text-orange-500 text-xs">미배정</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.attendingDoctor?.name || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {r.plannedDischargeDate
                          ? formatDateKR(r.plannedDischargeDate.substring(0, 10))
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate">{r.notes || '-'}</td>
                      <td className="px-4 py-3">
                        {r.currentBed ? (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                            병실배정
                          </span>
                        ) : (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                            대기중
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => cancelReservation(r.id)}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                        >
                          취소
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ───── 병상 전망 ───── */}
      {!loading && viewMode === 'projection' && (
        <>
          {/* 날짜 네비게이션 */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <button onClick={() => moveWeek(-1)} className="p-2 rounded-lg hover:bg-gray-100">
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setProjectionDate(toDateStr(new Date()))}
                className="px-3 py-1.5 text-sm bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 font-medium"
              >
                이번 주
              </button>
              <span className="text-lg font-semibold text-gray-800 min-w-[200px] text-center">
                {projectionDays.length > 0 && (
                  <>
                    {formatDateKR(projectionDays[0].date)} ~ {formatDateKR(projectionDays[projectionDays.length - 1].date)}
                  </>
                )}
              </span>
              <button onClick={() => moveWeek(1)} className="p-2 rounded-lg hover:bg-gray-100">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="text-sm text-gray-500">
              총 병상: <span className="font-semibold text-gray-700">{totalBeds}</span>개
            </div>
          </div>

          {/* 주간 전망 그리드 */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 w-24">항목</th>
                  {projectionDays.map((day) => {
                    const isToday = day.date === todayStr;
                    const isWeekend = (() => {
                      const d = new Date(day.date + 'T00:00:00');
                      return d.getDay() === 0 || d.getDay() === 6;
                    })();
                    return (
                      <th
                        key={day.date}
                        className={`px-3 py-3 text-center font-semibold min-w-[120px] ${
                          isToday ? 'bg-emerald-50 text-emerald-700' : isWeekend ? 'text-red-500' : 'text-gray-600'
                        }`}
                      >
                        {formatDateKR(day.date)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* 재원 */}
                <tr className="border-b">
                  <td className="px-3 py-3 font-medium text-gray-700">
                    <div className="flex items-center gap-1.5">
                      <Minus size={14} className="text-blue-500" />
                      재원
                    </div>
                  </td>
                  {projectionDays.map((day) => {
                    const isToday = day.date === todayStr;
                    return (
                      <td key={day.date} className={`px-3 py-3 text-center ${isToday ? 'bg-emerald-50' : ''}`}>
                        <span className="text-lg font-bold text-gray-800">{day.inHospital}</span>
                        <span className="text-xs text-gray-400 ml-1">명</span>
                      </td>
                    );
                  })}
                </tr>
                {/* 입원 */}
                <tr className="border-b">
                  <td className="px-3 py-3 font-medium text-gray-700">
                    <div className="flex items-center gap-1.5">
                      <ArrowDown size={14} className="text-emerald-500" />
                      입원
                    </div>
                  </td>
                  {projectionDays.map((day) => {
                    const isToday = day.date === todayStr;
                    return (
                      <td key={day.date} className={`px-3 py-3 text-center ${isToday ? 'bg-emerald-50' : ''}`}>
                        {day.admitting > 0 ? (
                          <span className="text-emerald-600 font-semibold">+{day.admitting}</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {/* 퇴원 */}
                <tr className="border-b">
                  <td className="px-3 py-3 font-medium text-gray-700">
                    <div className="flex items-center gap-1.5">
                      <ArrowUp size={14} className="text-orange-500" />
                      퇴원
                    </div>
                  </td>
                  {projectionDays.map((day) => {
                    const isToday = day.date === todayStr;
                    return (
                      <td key={day.date} className={`px-3 py-3 text-center ${isToday ? 'bg-emerald-50' : ''}`}>
                        {day.discharging > 0 ? (
                          <span className="text-orange-600 font-semibold">-{day.discharging}</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {/* 가용 */}
                <tr>
                  <td className="px-3 py-3 font-medium text-gray-700">
                    <div className="flex items-center gap-1.5">
                      <BedDouble size={14} className="text-indigo-500" />
                      가용
                    </div>
                  </td>
                  {projectionDays.map((day) => {
                    const isToday = day.date === todayStr;
                    const ratio = totalBeds > 0 ? day.available / totalBeds : 0;
                    return (
                      <td key={day.date} className={`px-3 py-3 text-center ${isToday ? 'bg-emerald-50' : ''}`}>
                        <span
                          className={`text-lg font-bold ${
                            ratio <= 0.1 ? 'text-red-600' : ratio <= 0.3 ? 'text-orange-600' : 'text-indigo-600'
                          }`}
                        >
                          {day.available}
                        </span>
                        <span className="text-xs text-gray-400 ml-1">/{totalBeds}</span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* 일별 이벤트 상세 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {projectionDays
              .filter((day) => day.events.length > 0)
              .map((day) => {
                const isToday = day.date === todayStr;
                return (
                  <div
                    key={day.date}
                    className={`bg-white border rounded-xl p-4 ${
                      isToday ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-gray-200'
                    }`}
                  >
                    <h3 className={`text-sm font-semibold mb-3 ${isToday ? 'text-emerald-700' : 'text-gray-700'}`}>
                      {formatDateFull(day.date)}
                      {isToday && <span className="ml-2 text-xs bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded">오늘</span>}
                    </h3>
                    <div className="space-y-2">
                      {day.events.map((event, idx) => (
                        <div
                          key={idx}
                          className={`flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg ${
                            event.type === 'ADMIT'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-orange-50 text-orange-700'
                          }`}
                        >
                          {event.type === 'ADMIT' ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ArrowUp size={12} />
                          )}
                          <span className="font-medium">{event.patientName}</span>
                          {event.roomName && (
                            <span className="text-xs opacity-70">
                              {event.roomName} {event.bedLabel}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>

          {projectionDays.every((day) => day.events.length === 0) && (
            <div className="text-center py-8 text-gray-400 bg-white border border-gray-200 rounded-xl">
              이 주간에 입원/퇴원 예정 이벤트가 없습니다.
            </div>
          )}
        </>
      )}

      {/* ───── 신규 예약 모달 ───── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">새 입원예약</h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* 환자명 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">환자명 *</label>
                <input
                  type="text"
                  value={formData.patientName}
                  onChange={(e) => setFormData({ ...formData, patientName: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="환자 이름"
                />
              </div>

              {/* 차트번호 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">차트번호 *</label>
                <input
                  type="text"
                  value={formData.emrPatientId}
                  onChange={(e) => setFormData({ ...formData, emrPatientId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="차트번호"
                />
              </div>

              {/* 입원예정일 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">입원예정일 *</label>
                <input
                  type="date"
                  value={formData.admitDate}
                  onChange={(e) => setFormData({ ...formData, admitDate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>

              {/* 퇴원예정일 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">퇴원예정일</label>
                <input
                  type="date"
                  value={formData.plannedDischargeDate}
                  onChange={(e) => setFormData({ ...formData, plannedDischargeDate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>

              {/* 담당의 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당의 *</label>
                <select
                  value={formData.attendingDoctorId}
                  onChange={(e) => setFormData({ ...formData, attendingDoctorId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">선택</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* 병실 배정 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">병실 배정</label>
                <select
                  value={formData.bedId}
                  onChange={(e) => setFormData({ ...formData, bedId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">미배정 (나중에 배정)</option>
                  {availableBeds.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.room.name} {b.label} ({b.room.ward.name})
                    </option>
                  ))}
                </select>
              </div>

              {/* 비고 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비고</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  rows={2}
                  placeholder="참고사항"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
              >
                {submitting ? '처리중...' : '예약 생성'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
