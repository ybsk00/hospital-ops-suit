'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Stethoscope,
  Zap,
  Hand,
  ClipboardCheck,
  Users,
  BedDouble,
  CalendarDays,
} from 'lucide-react';

/* ══════════════════════════════════════
   타입
   ══════════════════════════════════════ */
interface Schedule {
  time: string;
  endTime: string;
  type: 'APPOINTMENT' | 'RF' | 'MANUAL' | 'PROCEDURE';
  patientName: string;
  detail: string;
  status: string;
}

interface Inpatient {
  patientId: string;
  patientName: string;
  chartNumber: string;
  roomName: string;
  bedLabel: string;
  status: string;
}

interface DoctorSchedule {
  doctorId: string;
  doctorName: string;
  doctorCode: string;
  schedules: Schedule[];
  inpatientCount: number;
  appointmentCount: number;
  rfCount: number;
  manualCount: number;
  inpatients: Inpatient[];
}

interface WorkDay {
  date: string;
  status: 'WORKING' | 'DAY_OFF' | 'REGULAR_OFF';
  reason?: string;
  dayOffId?: string;
}

interface WorkDoctor {
  id: string;
  name: string;
  doctorCode: string;
  workDays: number[];
  workStartTime: string;
  workEndTime: string;
}

interface WorkCalendarEntry {
  doctor: WorkDoctor;
  days: WorkDay[];
}

/* ── 색상 매핑 ── */
const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  APPOINTMENT: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  RF: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  MANUAL: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  PROCEDURE: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
};

const TYPE_LABELS: Record<string, string> = {
  APPOINTMENT: '외래',
  RF: '고주파',
  MANUAL: '도수',
  PROCEDURE: '처치',
};

const TYPE_ICONS: Record<string, typeof Stethoscope> = {
  APPOINTMENT: Stethoscope,
  RF: Zap,
  MANUAL: Hand,
  PROCEDURE: ClipboardCheck,
};

/* ── 날짜 헬퍼 ── */
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateKR(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
}

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/* ── 시간 슬롯 (08:00 ~ 18:00) ── */
const TIME_SLOTS = Array.from({ length: 21 }, (_, i) => {
  const h = Math.floor(i / 2) + 8;
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

/* ══════════════════════════════════════
   메인 컴포넌트
   ══════════════════════════════════════ */
export default function DoctorSchedulePage() {
  const { accessToken } = useAuthStore();
  const [viewMode, setViewMode] = useState<'timeline' | 'workSchedule'>('timeline');

  // ── 타임라인 뷰 상태 ──
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [doctors, setDoctors] = useState<DoctorSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<string>('all');
  const [showInpatients, setShowInpatients] = useState(false);

  // ── 근무 스케줄 뷰 상태 ──
  const [workYear, setWorkYear] = useState(() => new Date().getFullYear());
  const [workMonth, setWorkMonth] = useState(() => new Date().getMonth() + 1);
  const [workCalendar, setWorkCalendar] = useState<WorkCalendarEntry[]>([]);
  const [workLoading, setWorkLoading] = useState(false);

  // ── 타임라인 데이터 ──
  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ date: string; doctors: DoctorSchedule[] }>(
        `/api/dashboard/doctor-schedule?date=${date}`,
        { token: accessToken || undefined },
      );
      if (res.success && res.data) {
        setDoctors(res.data.doctors);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [date, accessToken]);

  useEffect(() => {
    if (viewMode === 'timeline') fetchSchedule();
  }, [fetchSchedule, viewMode]);

  // ── 근무 스케줄 데이터 ──
  const fetchWorkSchedule = useCallback(async () => {
    setWorkLoading(true);
    try {
      const res = await api<{ year: number; month: number; calendar: WorkCalendarEntry[] }>(
        `/api/doctor-schedule/monthly?year=${workYear}&month=${workMonth}`,
        { token: accessToken || undefined },
      );
      if (res.success && res.data) {
        setWorkCalendar(res.data.calendar);
      }
    } catch {
      /* ignore */
    }
    setWorkLoading(false);
  }, [workYear, workMonth, accessToken]);

  useEffect(() => {
    if (viewMode === 'workSchedule') fetchWorkSchedule();
  }, [fetchWorkSchedule, viewMode]);

  const moveDate = (delta: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setDate(toDateStr(d));
  };

  const moveWorkMonth = (delta: number) => {
    let y = workYear;
    let m = workMonth + delta;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setWorkYear(y);
    setWorkMonth(m);
  };

  const filteredDoctors = selectedDoctor === 'all'
    ? doctors
    : doctors.filter((d) => d.doctorId === selectedDoctor);

  const getSchedulesAtTime = (schedules: Schedule[], timeSlot: string) => {
    return schedules.filter((s) => {
      const sTime = s.time;
      if (sTime === timeSlot) return true;
      const [sh, sm] = sTime.split(':').map(Number);
      const [th, tm] = timeSlot.split(':').map(Number);
      const sMin = sh * 60 + sm;
      const tMin = th * 60 + tm;
      return sMin >= tMin && sMin < tMin + 30;
    });
  };

  // 근무 스케줄 뷰의 날짜 수
  const daysInMonth = new Date(workYear, workMonth, 0).getDate();
  const todayStr = toDateStr(new Date());

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Calendar className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">의사별 일정</h1>
            <p className="text-sm text-gray-500">
              {viewMode === 'timeline' ? '의사별 외래/고주파/도수/처치 통합 스케줄' : '의사별 월간 근무/휴무 캘린더'}
            </p>
          </div>
        </div>

        {/* 뷰 모드 탭 */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setViewMode('timeline')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-md font-medium transition-colors ${
              viewMode === 'timeline' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Stethoscope size={14} />
            일간 일정
          </button>
          <button
            onClick={() => setViewMode('workSchedule')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-md font-medium transition-colors ${
              viewMode === 'workSchedule' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <CalendarDays size={14} />
            근무 스케줄
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════
         타임라인 뷰
         ══════════════════════════════════════ */}
      {viewMode === 'timeline' && (
        <>
          {/* 날짜 네비게이션 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button onClick={() => moveDate(-1)} className="p-2 rounded-lg hover:bg-gray-100">
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setDate(toDateStr(new Date()))}
                className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium"
              >
                오늘
              </button>
              <span className="text-lg font-semibold text-gray-800 min-w-[160px] text-center">
                {formatDateKR(date)}
              </span>
              <button onClick={() => moveDate(1)} className="p-2 rounded-lg hover:bg-gray-100">
                <ChevronRight size={18} />
              </button>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="ml-2 px-3 py-1.5 text-sm border rounded-lg"
              />
            </div>
          </div>

          {/* 의사 필터 탭 + 입원환자 토글 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedDoctor('all')}
                className={`px-4 py-2 text-sm rounded-lg font-medium ${
                  selectedDoctor === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                전체
              </button>
              {doctors.map((doc) => (
                <button
                  key={doc.doctorId}
                  onClick={() => setSelectedDoctor(doc.doctorId)}
                  className={`px-4 py-2 text-sm rounded-lg font-medium ${
                    selectedDoctor === doc.doctorId
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {doc.doctorName}
                  <span className="ml-1 text-xs opacity-70">({doc.doctorCode})</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowInpatients(!showInpatients)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg ${
                showInpatients ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <BedDouble size={14} />
              담당입원환자
            </button>
          </div>

          {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}

          {!loading && (
            <>
              {/* 의사별 요약 카드 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {filteredDoctors.map((doc) => (
                  <div key={doc.doctorId} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                          <span className="text-indigo-600 font-bold text-sm">{doc.doctorCode}</span>
                        </div>
                        <span className="font-semibold text-gray-800">{doc.doctorName}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        총 {doc.schedules.length}건
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="text-center p-2 bg-blue-50 rounded-lg">
                        <div className="text-lg font-bold text-blue-600">{doc.appointmentCount}</div>
                        <div className="text-xs text-blue-500">외래</div>
                      </div>
                      <div className="text-center p-2 bg-orange-50 rounded-lg">
                        <div className="text-lg font-bold text-orange-600">{doc.rfCount}</div>
                        <div className="text-xs text-orange-500">고주파</div>
                      </div>
                      <div className="text-center p-2 bg-purple-50 rounded-lg">
                        <div className="text-lg font-bold text-purple-600">{doc.manualCount}</div>
                        <div className="text-xs text-purple-500">도수</div>
                      </div>
                      <div className="text-center p-2 bg-gray-50 rounded-lg">
                        <div className="text-lg font-bold text-gray-600">{doc.inpatientCount}</div>
                        <div className="text-xs text-gray-500">입원</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 담당 입원환자 패널 */}
              {showInpatients && (
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
                    <Users size={16} /> 담당 입원환자
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredDoctors.map((doc) => (
                      <div key={doc.doctorId}>
                        <h4 className="text-xs font-semibold text-blue-600 mb-2">{doc.doctorName} ({doc.inpatientCount}명)</h4>
                        <div className="space-y-1">
                          {doc.inpatients.map((p) => (
                            <div key={p.patientId} className="flex items-center gap-3 text-sm bg-white px-3 py-1.5 rounded-lg">
                              <span className="font-medium text-gray-800">{p.patientName}</span>
                              <span className="text-gray-400 text-xs">{p.chartNumber}</span>
                              <span className="text-gray-500 text-xs">{p.roomName} {p.bedLabel}</span>
                              {p.status === 'DISCHARGE_PLANNED' && (
                                <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">퇴원예정</span>
                              )}
                            </div>
                          ))}
                          {doc.inpatients.length === 0 && (
                            <span className="text-xs text-gray-400">담당환자 없음</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 타임라인 뷰 */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-16 sticky left-0 bg-gray-50 z-10">시간</th>
                        {filteredDoctors.map((doc) => (
                          <th key={doc.doctorId} className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[240px]">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center text-xs font-bold text-indigo-600">
                                {doc.doctorCode}
                              </span>
                              {doc.doctorName}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {TIME_SLOTS.map((timeSlot) => {
                        const isHour = timeSlot.endsWith(':00');
                        const hasAny = filteredDoctors.some((d) => getSchedulesAtTime(d.schedules, timeSlot).length > 0);

                        return (
                          <tr
                            key={timeSlot}
                            className={`border-b ${isHour ? 'border-gray-200' : 'border-gray-100'} ${
                              hasAny ? 'bg-white' : 'bg-gray-50/30'
                            }`}
                          >
                            <td className={`px-3 py-1.5 text-xs sticky left-0 z-10 ${
                              isHour ? 'font-semibold text-gray-700 bg-gray-50' : 'text-gray-400 bg-gray-50/80'
                            }`}>
                              {timeSlot}
                            </td>
                            {filteredDoctors.map((doc) => {
                              const items = getSchedulesAtTime(doc.schedules, timeSlot);
                              return (
                                <td key={doc.doctorId} className="px-2 py-1">
                                  {items.map((item, idx) => {
                                    const color = TYPE_COLORS[item.type] || TYPE_COLORS.PROCEDURE;
                                    const Icon = TYPE_ICONS[item.type] || ClipboardCheck;
                                    return (
                                      <div
                                        key={idx}
                                        className={`${color.bg} ${color.border} border rounded-lg px-2.5 py-1.5 mb-1`}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <Icon size={12} className={color.text} />
                                          <span className={`text-xs font-medium ${color.text}`}>
                                            {TYPE_LABELS[item.type]}
                                          </span>
                                          <span className="text-xs text-gray-500">
                                            {item.time}{item.endTime ? `~${item.endTime}` : ''}
                                          </span>
                                        </div>
                                        <div className="font-medium text-gray-800 text-sm mt-0.5">
                                          {item.patientName}
                                        </div>
                                        <div className="text-xs text-gray-500 truncate">{item.detail}</div>
                                      </div>
                                    );
                                  })}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ══════════════════════════════════════
         근무 스케줄 뷰
         ══════════════════════════════════════ */}
      {viewMode === 'workSchedule' && (
        <>
          {/* 월 네비게이션 */}
          <div className="flex items-center gap-2 mb-5">
            <button onClick={() => moveWorkMonth(-1)} className="p-2 rounded-lg hover:bg-gray-100">
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => { setWorkYear(new Date().getFullYear()); setWorkMonth(new Date().getMonth() + 1); }}
              className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium"
            >
              이번달
            </button>
            <span className="text-lg font-semibold text-gray-800 min-w-[120px] text-center">
              {workYear}년 {workMonth}월
            </span>
            <button onClick={() => moveWorkMonth(1)} className="p-2 rounded-lg hover:bg-gray-100">
              <ChevronRight size={18} />
            </button>
          </div>

          {workLoading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}

          {!workLoading && workCalendar.length > 0 && (
            <>
              {/* 범례 */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 bg-green-100 border border-green-300 rounded text-center text-xs leading-5 font-bold text-green-700">O</div>
                  <span className="text-gray-600">근무</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 bg-red-100 border border-red-300 rounded text-center text-xs leading-5 font-bold text-red-600">X</div>
                  <span className="text-gray-600">특별휴무</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 bg-gray-100 border border-gray-300 rounded text-center text-xs leading-5 font-bold text-gray-400">-</div>
                  <span className="text-gray-600">정규휴무</span>
                </div>
              </div>

              {/* 의사별 근무 카드 */}
              <div className="space-y-4">
                {workCalendar.map((entry) => {
                  const doc = entry.doctor;
                  const regularOffDays = [0, 1, 2, 3, 4, 5, 6]
                    .filter(d => !doc.workDays.includes(d))
                    .map(d => WEEKDAY_NAMES[d]);
                  const dayOffCount = entry.days.filter(d => d.status === 'DAY_OFF').length;
                  const workDayCount = entry.days.filter(d => d.status === 'WORKING').length;

                  return (
                    <div key={doc.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      {/* 의사 헤더 */}
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                            <span className="text-indigo-600 font-bold text-sm">{doc.doctorCode}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-gray-800">{doc.name}</span>
                            <span className="text-xs text-gray-500 ml-2">
                              {doc.workStartTime}~{doc.workEndTime}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-gray-500">
                            정규휴무: <span className="font-medium text-gray-700">{regularOffDays.join(', ') || '없음'}</span>
                          </span>
                          <span className="text-green-600 font-medium">근무 {workDayCount}일</span>
                          {dayOffCount > 0 && (
                            <span className="text-red-600 font-medium">특별휴무 {dayOffCount}일</span>
                          )}
                        </div>
                      </div>

                      {/* 날짜 그리드 */}
                      <div className="overflow-x-auto">
                        <div className="flex min-w-fit">
                          {entry.days.map((day) => {
                            const d = new Date(day.date + 'T00:00:00');
                            const dow = d.getDay();
                            const dayNum = d.getDate();
                            const isToday = day.date === todayStr;

                            let bgColor = 'bg-green-50';
                            let textColor = 'text-green-700';
                            let marker = 'O';

                            if (day.status === 'DAY_OFF') {
                              bgColor = 'bg-red-50';
                              textColor = 'text-red-600';
                              marker = 'X';
                            } else if (day.status === 'REGULAR_OFF') {
                              bgColor = 'bg-gray-50';
                              textColor = 'text-gray-400';
                              marker = '-';
                            }

                            return (
                              <div
                                key={day.date}
                                className={`flex flex-col items-center py-2 px-1 min-w-[38px] border-r border-gray-100 ${bgColor} ${
                                  isToday ? 'ring-2 ring-indigo-400 ring-inset' : ''
                                }`}
                                title={day.reason || ''}
                              >
                                <div className={`text-[10px] ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
                                  {WEEKDAY_NAMES[dow]}
                                </div>
                                <div className={`text-xs font-medium mb-1 ${
                                  isToday ? 'w-5 h-5 bg-indigo-500 text-white rounded-full flex items-center justify-center text-[10px]' :
                                  dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'
                                }`}>
                                  {dayNum}
                                </div>
                                <div className={`text-sm font-bold ${textColor}`}>{marker}</div>
                                {day.reason && (
                                  <div className="text-[9px] text-red-500 truncate max-w-[36px]" title={day.reason}>
                                    {day.reason}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!workLoading && workCalendar.length === 0 && (
            <div className="text-center py-12 text-gray-400">의사 정보가 없습니다</div>
          )}
        </>
      )}
    </div>
  );
}
