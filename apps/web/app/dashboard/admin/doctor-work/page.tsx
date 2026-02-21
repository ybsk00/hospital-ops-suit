'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../../stores/auth';
import { api } from '../../../../lib/api';
import {
  CalendarClock,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

/* ── 타입 ── */

interface DoctorInfo {
  id: string;
  name: string;
  doctorCode: string;
  workDays: number[];
  workStartTime: string;
  workEndTime: string;
}

interface DayStatus {
  date: string;
  status: 'WORKING' | 'DAY_OFF' | 'REGULAR_OFF';
  reason?: string;
  dayOffId?: string;
}

interface CalendarEntry {
  doctor: DoctorInfo;
  days: DayStatus[];
}

/* ── 상수 ── */

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/* ── 메인 ── */

export default function DoctorWorkPage() {
  const { accessToken } = useAuthStore();

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [calendar, setCalendar] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // 편집 상태
  const [editDoctor, setEditDoctor] = useState<DoctorInfo | null>(null);
  const [editWorkDays, setEditWorkDays] = useState<number[]>([]);
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [saving, setSaving] = useState(false);

  // 휴무 추가
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [dayOffDate, setDayOffDate] = useState('');
  const [dayOffReason, setDayOffReason] = useState('');
  const [addingDayOff, setAddingDayOff] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await api<{ year: number; month: number; calendar: CalendarEntry[] }>(
        `/api/doctor-schedule/monthly?year=${year}&month=${month}`,
        { token: accessToken || undefined },
      );
      if (res.success && res.data) {
        setCalendar(res.data.calendar);
        if (!selectedDoctorId && res.data.calendar.length > 0) {
          setSelectedDoctorId(res.data.calendar[0].doctor.id);
        }
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [accessToken, year, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const moveMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setYear(y);
    setMonth(m);
  };

  /* 근무패턴 편집 시작 */
  function startEdit(doc: DoctorInfo) {
    setEditDoctor(doc);
    setEditWorkDays([...doc.workDays]);
    setEditStartTime(doc.workStartTime);
    setEditEndTime(doc.workEndTime);
  }

  function toggleWorkDay(dow: number) {
    setEditWorkDays((prev) =>
      prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow].sort(),
    );
  }

  async function saveWorkPattern() {
    if (!editDoctor || !accessToken) return;
    setSaving(true);
    try {
      await api(`/api/doctor-schedule/work-pattern/${editDoctor.id}`, {
        method: 'PATCH',
        body: {
          workDays: editWorkDays,
          workStartTime: editStartTime,
          workEndTime: editEndTime,
        },
        token: accessToken,
      });
      setEditDoctor(null);
      await fetchData();
    } catch (err: any) {
      alert(err.message || '저장에 실패했습니다.');
    }
    setSaving(false);
  }

  /* 휴무 추가 */
  async function addDayOff() {
    if (!selectedDoctorId || !dayOffDate || !accessToken) return;
    setAddingDayOff(true);
    try {
      await api('/api/doctor-schedule/day-off', {
        method: 'POST',
        body: {
          doctorId: selectedDoctorId,
          date: dayOffDate,
          reason: dayOffReason || undefined,
        },
        token: accessToken,
      });
      setDayOffDate('');
      setDayOffReason('');
      await fetchData();
    } catch (err: any) {
      alert(err.message || '휴무 추가에 실패했습니다.');
    }
    setAddingDayOff(false);
  }

  /* 휴무 삭제 */
  async function deleteDayOff(dayOffId: string) {
    if (!accessToken) return;
    try {
      await api(`/api/doctor-schedule/day-off/${dayOffId}`, {
        method: 'DELETE',
        token: accessToken,
      });
      await fetchData();
    } catch (err: any) {
      alert(err.message || '휴무 삭제에 실패했습니다.');
    }
  }

  const selectedCalendar = calendar.find((c) => c.doctor.id === selectedDoctorId);
  const dayOffs = selectedCalendar?.days.filter((d) => d.status === 'DAY_OFF') || [];

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-indigo-100 rounded-lg">
          <CalendarClock className="w-6 h-6 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">닥터 근무 조정</h1>
          <p className="text-sm text-gray-500">의사별 근무일/시간 및 휴무일을 관리합니다</p>
        </div>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}

      {!loading && (
        <div className="space-y-6">
          {/* ── 의사별 근무 패턴 카드 ── */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">근무 패턴 설정</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {calendar.map(({ doctor }) => {
                const isEditing = editDoctor?.id === doctor.id;
                return (
                  <div
                    key={doctor.id}
                    className="bg-white rounded-xl border border-gray-200 p-5"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">{doctor.name}</h3>
                        <span className="text-xs font-mono text-gray-400">{doctor.doctorCode}</span>
                      </div>
                      {!isEditing ? (
                        <button
                          onClick={() => startEdit(doctor)}
                          className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition font-medium"
                        >
                          편집
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditDoctor(null)}
                            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition"
                          >
                            취소
                          </button>
                          <button
                            onClick={saveWorkPattern}
                            disabled={saving}
                            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 flex items-center gap-1"
                          >
                            <Save size={12} />
                            저장
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 근무일 체크박스 */}
                    <div className="mb-3">
                      <label className="text-xs font-medium text-gray-500 mb-1.5 block">근무일</label>
                      <div className="flex gap-1">
                        {DAY_LABELS.map((label, dow) => {
                          const active = isEditing
                            ? editWorkDays.includes(dow)
                            : doctor.workDays.includes(dow);
                          return (
                            <button
                              key={dow}
                              onClick={() => isEditing && toggleWorkDay(dow)}
                              disabled={!isEditing}
                              className={`w-9 h-9 rounded-lg text-xs font-medium transition ${
                                active
                                  ? dow === 0
                                    ? 'bg-red-100 text-red-600 border border-red-200'
                                    : dow === 6
                                    ? 'bg-blue-100 text-blue-600 border border-blue-200'
                                    : 'bg-green-100 text-green-700 border border-green-200'
                                  : 'bg-gray-50 text-gray-300 border border-gray-100'
                              } ${isEditing ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 근무시간 */}
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-500 mb-1 block">시작</label>
                        {isEditing ? (
                          <input
                            type="time"
                            value={editStartTime}
                            onChange={(e) => setEditStartTime(e.target.value)}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <div className="text-sm font-medium text-gray-700">{doctor.workStartTime}</div>
                        )}
                      </div>
                      <div className="flex-1">
                        <label className="text-xs font-medium text-gray-500 mb-1 block">종료</label>
                        {isEditing ? (
                          <input
                            type="time"
                            value={editEndTime}
                            onChange={(e) => setEditEndTime(e.target.value)}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <div className="text-sm font-medium text-gray-700">{doctor.workEndTime}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 월간 근무 캘린더 (선택된 의사) ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800">월간 근무 현황</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => moveMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100">
                  <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-semibold text-gray-700 min-w-[100px] text-center">
                  {year}년 {month}월
                </span>
                <button onClick={() => moveMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100">
                  <ChevronRight size={18} />
                </button>
                <button onClick={fetchData} className="p-1.5 rounded-lg hover:bg-gray-100 ml-2">
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {/* 의사별 월간 O/X/- 그리드 */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[100px]">
                        의사
                      </th>
                      {calendar[0]?.days.map((d) => {
                        const date = new Date(d.date);
                        const dow = date.getDay();
                        return (
                          <th
                            key={d.date}
                            className={`text-center px-1 py-2 font-medium min-w-[32px] ${
                              dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-500'
                            }`}
                          >
                            <div>{date.getDate()}</div>
                            <div className="text-[10px]">{DAY_LABELS[dow]}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {calendar.map(({ doctor, days }) => (
                      <tr key={doctor.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-medium text-gray-800 sticky left-0 bg-white z-10">
                          {doctor.name}
                        </td>
                        {days.map((d) => (
                          <td key={d.date} className="text-center px-1 py-2">
                            {d.status === 'WORKING' ? (
                              <span className="inline-block w-6 h-6 leading-6 rounded-full bg-green-100 text-green-700 font-bold">
                                O
                              </span>
                            ) : d.status === 'DAY_OFF' ? (
                              <span
                                className="inline-block w-6 h-6 leading-6 rounded-full bg-red-100 text-red-600 font-bold cursor-help"
                                title={d.reason || '특별 휴무'}
                              >
                                X
                              </span>
                            ) : (
                              <span className="inline-block w-6 h-6 leading-6 rounded-full bg-gray-100 text-gray-400">
                                -
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 범례 */}
              <div className="px-4 py-2 border-t bg-gray-50 flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-green-100 text-green-700 text-center text-[10px] leading-4 font-bold">O</span>
                  근무
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-red-100 text-red-600 text-center text-[10px] leading-4 font-bold">X</span>
                  휴무
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-gray-100 text-gray-400 text-center text-[10px] leading-4">-</span>
                  정규휴무
                </span>
              </div>
            </div>
          </div>

          {/* ── 휴무일 관리 ── */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">휴무일 관리</h2>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              {/* 의사 선택 + 추가 폼 */}
              <div className="flex flex-wrap items-end gap-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">의사 선택</label>
                  <select
                    value={selectedDoctorId}
                    onChange={(e) => setSelectedDoctorId(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {calendar.map(({ doctor }) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name} ({doctor.doctorCode})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">날짜</label>
                  <input
                    type="date"
                    value={dayOffDate}
                    onChange={(e) => setDayOffDate(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1 min-w-[150px]">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">사유 (선택)</label>
                  <input
                    type="text"
                    value={dayOffReason}
                    onChange={(e) => setDayOffReason(e.target.value)}
                    placeholder="예: 설 연휴, 개인사유"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={addDayOff}
                  disabled={addingDayOff || !dayOffDate || !selectedDoctorId}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition text-sm font-medium disabled:opacity-50"
                >
                  <Plus size={14} />
                  {addingDayOff ? '추가 중...' : '휴무 추가'}
                </button>
              </div>

              {/* 현재 휴무 목록 */}
              {dayOffs.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  {selectedCalendar?.doctor.name
                    ? `${selectedCalendar.doctor.name} — ${month}월 특별 휴무 없음`
                    : '의사를 선택하세요'}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-gray-500 mb-2">
                    {selectedCalendar?.doctor.name} — {month}월 특별 휴무 ({dayOffs.length}일)
                  </div>
                  {dayOffs.map((d) => (
                    <div
                      key={d.dayOffId}
                      className="flex items-center justify-between px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-red-700">{d.date}</span>
                        <span className="text-sm text-red-500">
                          ({DAY_LABELS[new Date(d.date).getDay()]}요일)
                        </span>
                        {d.reason && (
                          <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded">
                            {d.reason}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => d.dayOffId && deleteDayOff(d.dayOffId)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-100 hover:text-red-600 transition"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
