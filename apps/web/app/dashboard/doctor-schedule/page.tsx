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
} from 'lucide-react';

/* ── 타입 ── */
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

/* ── 시간 슬롯 (08:00 ~ 18:00) ── */
const TIME_SLOTS = Array.from({ length: 21 }, (_, i) => {
  const h = Math.floor(i / 2) + 8;
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

export default function DoctorSchedulePage() {
  const { accessToken } = useAuthStore();
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [doctors, setDoctors] = useState<DoctorSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<string>('all');
  const [showInpatients, setShowInpatients] = useState(false);

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
    fetchSchedule();
  }, [fetchSchedule]);

  const moveDate = (delta: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setDate(toDateStr(d));
  };

  const filteredDoctors = selectedDoctor === 'all'
    ? doctors
    : doctors.filter((d) => d.doctorId === selectedDoctor);

  // 타임라인에서 특정 시간 슬롯에 해당하는 스케줄 필터
  const getSchedulesAtTime = (schedules: Schedule[], timeSlot: string) => {
    return schedules.filter((s) => {
      const sTime = s.time;
      // 같은 시간 슬롯이면 표시
      if (sTime === timeSlot) return true;
      // 30분 간격 체크: 해당 슬롯 시간 범위 내에 있는지
      const [sh, sm] = sTime.split(':').map(Number);
      const [th, tm] = timeSlot.split(':').map(Number);
      const sMin = sh * 60 + sm;
      const tMin = th * 60 + tm;
      return sMin >= tMin && sMin < tMin + 30;
    });
  };

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
            <p className="text-sm text-gray-500">의사별 외래/고주파/도수/처치 통합 스케줄</p>
          </div>
        </div>

        {/* 날짜 네비게이션 */}
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
    </div>
  );
}
