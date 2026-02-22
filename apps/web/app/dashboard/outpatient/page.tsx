'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, ChevronLeft, ChevronRight, Users, Calendar,
  Phone, Star
} from 'lucide-react';
import { api } from '../../../lib/api';

// ── 날짜 유틸 ─────────────────────────────────────────────────────
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} (${DAY_NAMES[d.getDay()]})`;
}
function fmtDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function getMonWeekStart(d: Date): Date {
  const day = d.getDay(); // 0=일
  const diff = day === 0 ? -6 : 1 - day; // 월요일로
  return addDays(d, diff);
}

// ── 타입 ──────────────────────────────────────────────────────────
type AppointmentStatus = 'BOOKED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'CHANGED';

interface OutpatientAppointment {
  id: string;
  appointmentDate: string;
  timeSlot: string;
  doctorCode: string | null;
  slotIndex: number;
  patientId: string | null;
  patient: { id: string; name: string; emrPatientId: string | null; phone: string | null } | null;
  patientNameRaw: string | null;
  isNewPatient: boolean;
  phoneNumber: string | null;
  treatmentContent: string | null;
  status: AppointmentStatus;
  sheetTab: string;
  sheetA1Name: string;
  sheetSyncedAt: string | null;
}

interface TimeSlotGroup {
  timeSlot: string;
  appointments: OutpatientAppointment[];
}

interface DailyData {
  date: string;
  timeSlots: TimeSlotGroup[];
  summary: {
    totalCount: number;
    doctorCounts: Record<string, number>;
    newPatientCount: number;
  };
}

interface WeeklySummary {
  start: string;
  end: string;
  summary: Record<string, Record<string, { total: number; newPatients: number }>>;
}

type ViewMode = 'daily' | 'weekly';

// ── 의사별 색상 ────────────────────────────────────────────────────
function getDoctorColor(code: string | null): string {
  if (code === 'C') return 'bg-blue-50 border-blue-200';
  if (code === 'J') return 'bg-purple-50 border-purple-200';
  return 'bg-gray-50 border-gray-200';
}

function getDoctorBadgeColor(code: string | null): string {
  if (code === 'C') return 'bg-blue-100 text-blue-700';
  if (code === 'J') return 'bg-purple-100 text-purple-700';
  return 'bg-gray-100 text-gray-600';
}

// ── AppointmentCard ───────────────────────────────────────────────
function AppointmentCard({
  appt,
  onClick,
}: {
  appt: OutpatientAppointment;
  onClick: (appt: OutpatientAppointment) => void;
}) {
  const patientName = appt.patient?.name ?? appt.patientNameRaw ?? '-';
  const isUnmatched = !appt.patientId && appt.patientNameRaw;

  return (
    <div
      className={`border rounded-lg p-2.5 cursor-pointer hover:shadow-md transition-shadow ${getDoctorColor(appt.doctorCode)}`}
      onClick={() => onClick(appt)}
    >
      {/* 이름 + 신환 뱃지 */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm font-medium text-gray-800 truncate">{patientName}</span>
        {appt.isNewPatient && (
          <span className="flex-shrink-0 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">신환</span>
        )}
        {isUnmatched && (
          <span className="flex-shrink-0 text-xs text-orange-400" title="환자 미매칭">⚠</span>
        )}
      </div>

      {/* 슬롯 번호 + 의사 */}
      <div className="flex items-center gap-1.5">
        <span className={`text-xs px-1.5 py-0.5 rounded ${getDoctorBadgeColor(appt.doctorCode)}`}>
          {appt.doctorCode ?? '미정'}-{appt.slotIndex}
        </span>
        {appt.status !== 'BOOKED' && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            appt.status === 'COMPLETED' ? 'bg-gray-100 text-gray-500' :
            appt.status === 'CANCELLED' ? 'bg-red-100 text-red-500' :
            appt.status === 'NO_SHOW' ? 'bg-red-100 text-red-500' :
            'bg-yellow-100 text-yellow-600'
          }`}>
            {appt.status === 'COMPLETED' ? '완료' :
             appt.status === 'CANCELLED' ? '취소' :
             appt.status === 'NO_SHOW' ? '노쇼' :
             appt.status === 'CHECKED_IN' ? '체크인' : appt.status}
          </span>
        )}
      </div>

      {/* 내용 */}
      {appt.treatmentContent && (
        <div className="text-xs text-gray-500 mt-1 truncate">{appt.treatmentContent}</div>
      )}
      {appt.phoneNumber && (
        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
          <Phone size={10} />
          {appt.phoneNumber}
        </div>
      )}
    </div>
  );
}

// ── 일간 뷰 ───────────────────────────────────────────────────────
function DailyView({
  data,
  onAppointmentClick,
}: {
  data: DailyData | null;
  onAppointmentClick: (appt: OutpatientAppointment) => void;
}) {
  if (!data) return <div className="text-center text-gray-400 py-12">데이터 없음</div>;

  const doctorCodes = ['C', 'J', null];

  return (
    <div className="space-y-4">
      {data.timeSlots.map(({ timeSlot, appointments }) => (
        <div key={timeSlot} className="bg-white rounded-xl border overflow-hidden">
          {/* 시간대 헤더 */}
          <div className="bg-gray-50 px-4 py-2 border-b">
            <span className="font-bold text-gray-700 text-sm">{timeSlot}</span>
            <span className="ml-2 text-xs text-gray-400">{appointments.length}명</span>
          </div>

          {/* 의사별 컬럼 */}
          <div className="grid grid-cols-3 gap-3 p-3">
            {doctorCodes.map(code => {
              const appts = appointments.filter(a => a.doctorCode === code);
              return (
                <div key={code ?? 'null'}>
                  <div className={`text-xs font-medium mb-1.5 ${
                    code === 'C' ? 'text-blue-600' :
                    code === 'J' ? 'text-purple-600' :
                    'text-gray-500'
                  }`}>
                    {code === 'C' ? 'C 이찬용' : code === 'J' ? 'J 이재일' : '미정'}
                    {appts.length > 0 && <span className="ml-1 text-gray-400">({appts.length})</span>}
                  </div>
                  <div className="space-y-1.5">
                    {appts.map(appt => (
                      <AppointmentCard key={appt.id} appt={appt} onClick={onAppointmentClick} />
                    ))}
                    {appts.length === 0 && (
                      <div className="text-xs text-gray-300 italic">없음</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {data.timeSlots.length === 0 && (
        <div className="text-center text-gray-400 py-12">
          <Calendar size={32} className="mx-auto mb-2" />
          예약 없음
        </div>
      )}
    </div>
  );
}

// ── 주간 뷰 ───────────────────────────────────────────────────────
function WeeklyView({
  data,
  weekStart,
}: {
  data: WeeklySummary | null;
  weekStart: Date;
}) {
  const days = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));
  const doctors = ['C', 'J'];

  if (!data) return <div className="text-center text-gray-400 py-12">데이터 없음</div>;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* 날짜 헤더 */}
      <div className="grid grid-cols-7 border-b">
        <div className="bg-gray-50 p-3 border-r" />
        {days.map(day => (
          <div key={day.toISOString()} className="bg-gray-50 p-3 text-center border-r last:border-r-0">
            <div className="text-xs text-gray-500">{DAY_NAMES[day.getDay()]}</div>
            <div className="font-bold text-gray-700">{fmtDateShort(day)}</div>
          </div>
        ))}
      </div>

      {/* 의사별 행 */}
      {doctors.map(doctor => (
        <div key={doctor} className={`grid grid-cols-7 border-b last:border-b-0 ${
          doctor === 'C' ? 'bg-blue-50/30' : 'bg-purple-50/30'
        }`}>
          <div className={`p-3 border-r font-medium text-sm ${
            doctor === 'C' ? 'text-blue-700' : 'text-purple-700'
          }`}>
            {doctor === 'C' ? 'C 이찬용' : 'J 이재일'}
          </div>
          {days.map(day => {
            const dateKey = fmtDateKey(day);
            const stats = data.summary[dateKey]?.[doctor];
            return (
              <div key={dateKey} className="p-3 text-center border-r last:border-r-0">
                {stats ? (
                  <>
                    <div className="text-lg font-bold text-gray-800">{stats.total}명</div>
                    {stats.newPatients > 0 && (
                      <div className="text-xs text-green-600">신환 {stats.newPatients}</div>
                    )}
                  </>
                ) : (
                  <div className="text-gray-300 text-sm">-</div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* 합계 행 */}
      <div className="grid grid-cols-7 bg-gray-50">
        <div className="p-3 border-r font-bold text-gray-600 text-sm">합계</div>
        {days.map(day => {
          const dateKey = fmtDateKey(day);
          const dayData = data.summary[dateKey] ?? {};
          const total = Object.values(dayData).reduce((s, d) => s + d.total, 0);
          return (
            <div key={dateKey} className="p-3 text-center border-r last:border-r-0">
              {total > 0 ? (
                <div className="font-bold text-gray-800">{total}명</div>
              ) : (
                <div className="text-gray-300">-</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 상세 패널 ─────────────────────────────────────────────────────
function AppointmentDetailPanel({
  appt,
  onClose,
  onStatusChange,
}: {
  appt: OutpatientAppointment | null;
  onClose: () => void;
  onStatusChange: (id: string, status: AppointmentStatus) => void;
}) {
  if (!appt) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl border-l z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <h3 className="font-bold text-gray-800">예약 상세</h3>
        <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <div className="text-xs text-gray-500 mb-0.5">환자명</div>
          <div className="font-medium">
            {appt.patient?.name ?? appt.patientNameRaw ?? '-'}
            {appt.isNewPatient && <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">신환</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-0.5">날짜</div>
            <div className="text-sm">{fmtDate(new Date(appt.appointmentDate))}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-0.5">시간</div>
            <div className="text-sm">{appt.timeSlot}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-0.5">주치의</div>
            <div className="text-sm">{appt.doctorCode ?? '미정'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-0.5">슬롯</div>
            <div className="text-sm">{appt.doctorCode ?? '?'}-{appt.slotIndex}</div>
          </div>
        </div>

        {appt.phoneNumber && (
          <div>
            <div className="text-xs text-gray-500 mb-0.5">연락처</div>
            <div className="text-sm">{appt.phoneNumber}</div>
          </div>
        )}
        {appt.treatmentContent && (
          <div>
            <div className="text-xs text-gray-500 mb-0.5">진료 내용</div>
            <div className="text-sm">{appt.treatmentContent}</div>
          </div>
        )}

        <div>
          <div className="text-xs text-gray-500 mb-1">상태 변경</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(['BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as AppointmentStatus[]).map(s => (
              <button
                key={s}
                onClick={() => onStatusChange(appt.id, s)}
                className={`text-xs px-2 py-1.5 rounded border transition-colors ${
                  appt.status === s
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {s === 'BOOKED' ? '예약' : s === 'COMPLETED' ? '완료' :
                 s === 'CANCELLED' ? '취소' : '노쇼'}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-gray-400 space-y-0.5 pt-2 border-t">
          <div>시트 탭: {appt.sheetTab}</div>
          <div>셀: {appt.sheetA1Name}</div>
          {appt.sheetSyncedAt && (
            <div>동기화: {new Date(appt.sheetSyncedAt).toLocaleString('ko-KR')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function OutpatientPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [selectedDate, setSelectedDate] = useState(() => fmtYMD(new Date()));
  const [weekStart, setWeekStart] = useState(() => getMonWeekStart(new Date()));
  const [dailyData, setDailyData] = useState<DailyData | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<OutpatientAppointment | null>(null);

  const fetchDaily = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await api(`/api/outpatient/daily?date=${date}`);
      if (res.success) setDailyData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchWeekly = useCallback(async (start: Date) => {
    setLoading(true);
    try {
      const startStr = fmtYMD(start);
      const res = await api(`/api/outpatient/weekly-summary?start=${startStr}`);
      if (res.success) setWeeklyData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (viewMode === 'daily') fetchDaily(selectedDate);
    else fetchWeekly(weekStart);
  }, [viewMode, selectedDate, weekStart, fetchDaily, fetchWeekly]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api('/api/outpatient/sync', { method: 'POST', body: '{}' });
      if (res.success) {
        alert(`동기화 요청 완료 (${res.data?.mode === 'inline' ? '즉시 실행' : '큐 등록'})`);
        if (viewMode === 'daily') fetchDaily(selectedDate);
        else fetchWeekly(weekStart);
      }
    } catch (e: any) {
      alert(`동기화 실패: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleStatusChange = async (id: string, status: AppointmentStatus) => {
    try {
      const res = await api(`/api/outpatient/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (res.success) {
        if (viewMode === 'daily') fetchDaily(selectedDate);
        setSelectedAppt((prev: OutpatientAppointment | null) => prev ? { ...prev, status } : null);
      }
    } catch (e) { console.error(e); }
  };

  const moveDate = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(fmtYMD(d));
  };

  const moveWeek = (delta: number) => {
    setWeekStart(prev => addDays(prev, delta * 7));
  };

  const summary = dailyData?.summary;

  return (
    <div className="p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">외래 예약</h1>
          <p className="text-sm text-gray-500">Google Sheets 연동 · 외래 예약 현황</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 뷰모드 */}
          <div className="flex border rounded-lg overflow-hidden">
            {(['daily', 'weekly'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === m ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                {m === 'daily' ? '일간' : '주간'}
              </button>
            ))}
          </div>

          {/* 날짜 네비게이션 */}
          {viewMode === 'daily' ? (
            <>
              <button onClick={() => moveDate(-1)} className="p-1.5 hover:bg-gray-100 rounded"><ChevronLeft size={18} /></button>
              <span className="text-sm font-medium w-28 text-center">
                {fmtDate(new Date(selectedDate))}
              </span>
              <button onClick={() => moveDate(1)} className="p-1.5 hover:bg-gray-100 rounded"><ChevronRight size={18} /></button>
              <button
                onClick={() => setSelectedDate(fmtYMD(new Date()))}
                className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
              >오늘</button>
            </>
          ) : (
            <>
              <button onClick={() => moveWeek(-1)} className="p-1.5 hover:bg-gray-100 rounded"><ChevronLeft size={18} /></button>
              <span className="text-sm font-medium w-36 text-center">
                {fmtDateShort(weekStart)} ~ {fmtDateShort(addDays(weekStart, 5))}
              </span>
              <button onClick={() => moveWeek(1)} className="p-1.5 hover:bg-gray-100 rounded"><ChevronRight size={18} /></button>
            </>
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? '동기화 중...' : '시트 동기화'}
          </button>
          <button
            onClick={() => viewMode === 'daily' ? fetchDaily(selectedDate) : fetchWeekly(weekStart)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>
      </div>

      {/* 일간 요약 */}
      {viewMode === 'daily' && summary && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-white border rounded-xl p-3 flex items-center gap-2">
            <Users size={18} className="text-gray-500" />
            <div>
              <div className="text-xl font-bold">{summary.totalCount}</div>
              <div className="text-xs text-gray-500">전체 예약</div>
            </div>
          </div>
          <div className="bg-white border rounded-xl p-3 flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-500" />
            <div>
              <div className="text-xl font-bold">{summary.doctorCounts['C'] ?? 0}</div>
              <div className="text-xs text-gray-500">C 이찬용</div>
            </div>
          </div>
          <div className="bg-white border rounded-xl p-3 flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-purple-500" />
            <div>
              <div className="text-xl font-bold">{summary.doctorCounts['J'] ?? 0}</div>
              <div className="text-xs text-gray-500">J 이재일</div>
            </div>
          </div>
          <div className="bg-white border rounded-xl p-3 flex items-center gap-2">
            <Star size={18} className="text-green-500" />
            <div>
              <div className="text-xl font-bold">{summary.newPatientCount}</div>
              <div className="text-xs text-gray-500">신환</div>
            </div>
          </div>
        </div>
      )}

      {/* 메인 뷰 */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">
          <RefreshCw size={24} className="animate-spin mr-2" />
          로딩 중...
        </div>
      ) : viewMode === 'daily' ? (
        <DailyView data={dailyData} onAppointmentClick={setSelectedAppt} />
      ) : (
        <WeeklyView data={weeklyData} weekStart={weekStart} />
      )}

      {/* 상세 패널 */}
      {selectedAppt && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedAppt(null)} />
          <AppointmentDetailPanel
            appt={selectedAppt}
            onClose={() => setSelectedAppt(null)}
            onStatusChange={handleStatusChange}
          />
        </>
      )}
    </div>
  );
}
