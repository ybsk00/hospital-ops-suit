'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  Syringe,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Calendar,
  List,
  Check,
  Clock,
  Trash2,
  Loader2,
} from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  emrPatientId: string;
}

interface Admission {
  id: string;
  patient: Patient;
  currentBed: {
    label: string;
    room: { name: string; ward: { name: string } };
  } | null;
}

interface Execution {
  id: string;
  scheduledAt: string;
  executedAt: string | null;
  status: string;
  notes: string | null;
  version: number;
  plan: {
    id: string;
    notes: string | null;
    procedureCatalog: { id: string; name: string; category: string };
    admission: {
      id: string;
      patient: Patient;
      currentBed: {
        label: string;
        room: { name: string; ward: { name: string } };
      } | null;
    };
  };
  executedBy: { id: string; name: string } | null;
}

const statusLabels: Record<string, string> = {
  SCHEDULED: '예정',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  ON_HOLD: '보류',
  CANCELLED: '취소',
};

const statusColors: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-green-100 text-green-700',
  ON_HOLD: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

type ViewMode = 'daily' | 'weekly' | 'monthly';
type TreatmentType = 'RADIOFREQUENCY' | 'HYPERBARIC_OXYGEN' | 'OTHER';

const treatmentTypes = [
  { key: 'RADIOFREQUENCY', label: '고주파열치료' },
  { key: 'HYPERBARIC_OXYGEN', label: '고압산소치료' },
  { key: 'OTHER', label: '기타치료' },
];

export default function ProceduresPage() {
  const { accessToken } = useAuthStore();

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [currentDate, setCurrentDate] = useState(new Date());

  // Data
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  // Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [saving, setSaving] = useState(false);

  // Form
  const [form, setForm] = useState({
    admissionId: '',
    treatmentType: 'RADIOFREQUENCY' as TreatmentType,
    treatmentName: '',
    schedules: [{ date: new Date().toISOString().slice(0, 10), time: '09:00' }],
    notes: '',
  });

  // Fetch executions
  const fetchExecutions = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      let from: Date, to: Date;

      if (viewMode === 'daily') {
        from = new Date(currentDate);
        from.setHours(0, 0, 0, 0);
        to = new Date(currentDate);
        to.setHours(23, 59, 59, 999);
      } else if (viewMode === 'weekly') {
        const day = currentDate.getDay();
        from = new Date(currentDate);
        from.setDate(currentDate.getDate() - day);
        from.setHours(0, 0, 0, 0);
        to = new Date(from);
        to.setDate(from.getDate() + 6);
        to.setHours(23, 59, 59, 999);
      } else {
        from = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        to = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        to.setHours(23, 59, 59, 999);
      }

      const res = await api<Execution[]>(
        `/api/procedures/calendar?from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`,
        { token: accessToken }
      );
      setExecutions(res.data || []);
    } catch {
      setExecutions([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, viewMode, currentDate]);

  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  // Fetch admissions for modal
  const fetchAdmissions = async () => {
    if (!accessToken) return;
    try {
      const res = await api<Admission[]>('/api/procedures/admitted-patients', { token: accessToken });
      setAdmissions(res.data || []);
    } catch {
      setAdmissions([]);
    }
  };

  // Add schedule row
  const addScheduleRow = () => {
    const lastDate = form.schedules[form.schedules.length - 1]?.date || new Date().toISOString().slice(0, 10);
    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + 1);
    setForm({
      ...form,
      schedules: [...form.schedules, { date: nextDate.toISOString().slice(0, 10), time: '09:00' }],
    });
  };

  // Remove schedule row
  const removeScheduleRow = (index: number) => {
    if (form.schedules.length <= 1) return;
    setForm({
      ...form,
      schedules: form.schedules.filter((_, i) => i !== index),
    });
  };

  // Update schedule
  const updateSchedule = (index: number, field: 'date' | 'time', value: string) => {
    const newSchedules = [...form.schedules];
    newSchedules[index] = { ...newSchedules[index], [field]: value };
    setForm({ ...form, schedules: newSchedules });
  };

  // Submit new treatment
  const handleSubmit = async () => {
    if (!accessToken) return;
    if (!form.admissionId) {
      alert('환자를 선택해주세요.');
      return;
    }
    if (form.treatmentType === 'OTHER' && !form.treatmentName) {
      alert('치료명을 입력해주세요.');
      return;
    }

    setSaving(true);
    try {
      await api('/api/procedures/treatments', {
        method: 'POST',
        token: accessToken,
        body: {
          admissionId: form.admissionId,
          treatmentType: form.treatmentType,
          treatmentName: form.treatmentType === 'OTHER' ? form.treatmentName : undefined,
          schedules: form.schedules,
          notes: form.notes || undefined,
        },
      });
      alert('등록되었습니다.');
      setShowNewModal(false);
      setForm({
        admissionId: '',
        treatmentType: 'RADIOFREQUENCY',
        treatmentName: '',
        schedules: [{ date: new Date().toISOString().slice(0, 10), time: '09:00' }],
        notes: '',
      });
      fetchExecutions();
    } catch (err: any) {
      alert(err.message || '등록 실패');
    } finally {
      setSaving(false);
    }
  };

  // Status change
  const handleStatusChange = async (exec: Execution, newStatus: string) => {
    if (!accessToken) return;
    try {
      await api(`/api/procedures/executions/${exec.id}`, {
        method: 'PATCH',
        token: accessToken,
        body: {
          status: newStatus,
          ...(newStatus === 'COMPLETED' ? { executedAt: new Date().toISOString() } : {}),
          version: exec.version,
        },
      });
      fetchExecutions();
      if (showDetailModal) {
        setShowDetailModal(false);
        setSelectedExecution(null);
      }
    } catch (err: any) {
      alert(err.message || '상태 변경 실패');
    }
  };

  // Delete
  const handleDelete = async (exec: Execution) => {
    if (!accessToken) return;
    if (!confirm('이 치료 일정을 삭제하시겠습니까?')) return;
    try {
      await api(`/api/procedures/executions/${exec.id}`, {
        method: 'DELETE',
        token: accessToken,
      });
      alert('삭제되었습니다.');
      fetchExecutions();
      if (showDetailModal) {
        setShowDetailModal(false);
        setSelectedExecution(null);
      }
    } catch (err: any) {
      alert(err.message || '삭제 실패');
    }
  };

  // Date navigation
  const navigateDate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (viewMode === 'daily') {
      d.setDate(d.getDate() + dir);
    } else if (viewMode === 'weekly') {
      d.setDate(d.getDate() + dir * 7);
    } else {
      d.setMonth(d.getMonth() + dir);
    }
    setCurrentDate(d);
  };

  // Week days
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

  // Month days
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

  // Get executions for date
  const getExecutionsForDate = (date: Date) => {
    const dateStr = date.toISOString().slice(0, 10);
    return executions.filter((e) => e.scheduledAt.slice(0, 10) === dateStr);
  };

  // Filter by status
  const filteredExecutions = statusFilter
    ? executions.filter((e) => e.status === statusFilter)
    : executions;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">입원환자치료</h1>
          <p className="text-slate-500 mt-1">입원 환자의 치료 일정을 관리합니다.</p>
        </div>
        <button
          onClick={() => {
            fetchAdmissions();
            setShowNewModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
        >
          <Plus size={16} />
          새 치료
        </button>
      </div>

      {/* View Mode Tabs + Date Nav */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
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

          <div className="flex items-center gap-2">
            <button onClick={() => navigateDate(-1)} className="p-1.5 rounded hover:bg-slate-100">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {viewMode === 'daily'
                ? currentDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
                : viewMode === 'weekly'
                ? `${getWeekDays()[0].toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} - ${getWeekDays()[6].toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}`
                : currentDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })}
            </span>
            <button onClick={() => navigateDate(1)} className="p-1.5 rounded hover:bg-slate-100">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">전체 상태</option>
          {Object.entries(statusLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Daily View */}
      {viewMode === 'daily' && (
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12 text-slate-400">로딩 중...</div>
          ) : filteredExecutions.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <Syringe size={48} className="mx-auto text-slate-300 mb-4" />
              <p className="text-slate-500">해당 날짜에 예정된 치료가 없습니다.</p>
            </div>
          ) : (
            filteredExecutions.map((exec) => (
              <div
                key={exec.id}
                onClick={() => {
                  setSelectedExecution(exec);
                  setShowDetailModal(true);
                }}
                className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between hover:shadow-md transition cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Syringe size={18} className="text-purple-600" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900">
                      {exec.plan.procedureCatalog.name} - {exec.plan.admission.patient.name}
                    </div>
                    <div className="text-sm text-slate-500">
                      {exec.plan.admission.patient.emrPatientId}
                      {exec.plan.admission.currentBed && (
                        <span className="ml-2">
                          ({exec.plan.admission.currentBed.room.ward.name} {exec.plan.admission.currentBed.room.name}-{exec.plan.admission.currentBed.label})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      예정: {new Date(exec.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      {exec.executedBy && ` · 실행: ${exec.executedBy.name}`}
                    </div>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[exec.status]}`}>
                  {statusLabels[exec.status]}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Weekly View */}
      {viewMode === 'weekly' && (
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
              {getWeekDays().map((date, i) => {
                const dayExecutions = getExecutionsForDate(date);
                const filtered = statusFilter ? dayExecutions.filter(e => e.status === statusFilter) : dayExecutions;
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
                      {filtered.slice(0, 4).map((exec) => (
                        <div
                          key={exec.id}
                          onClick={() => {
                            setSelectedExecution(exec);
                            setShowDetailModal(true);
                          }}
                          className={`text-xs px-1.5 py-1 rounded truncate cursor-pointer hover:opacity-80 ${statusColors[exec.status]}`}
                          title={`${exec.plan.procedureCatalog.name} - ${exec.plan.admission.patient.name}`}
                        >
                          {exec.plan.procedureCatalog.name} - {exec.plan.admission.patient.name}
                        </div>
                      ))}
                      {filtered.length > 4 && (
                        <div className="text-xs text-slate-400">+{filtered.length - 4}</div>
                      )}
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
                const dayExecutions = getExecutionsForDate(date);
                const filtered = statusFilter ? dayExecutions.filter(e => e.status === statusFilter) : dayExecutions;
                const dateStr = date.toISOString().slice(0, 10);
                const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                const isToday = dateStr === new Date().toISOString().slice(0, 10);
                return (
                  <div
                    key={i}
                    className={`min-h-[70px] p-1 border-r border-b border-slate-100 ${
                      !isCurrentMonth ? 'bg-slate-50' : isToday ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className={`text-xs font-medium mb-1 ${
                      !isCurrentMonth ? 'text-slate-300' : i % 7 === 0 ? 'text-red-500' : i % 7 === 6 ? 'text-blue-500' : 'text-slate-700'
                    }`}>
                      {date.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {filtered.slice(0, 2).map((exec) => (
                        <div
                          key={exec.id}
                          onClick={() => {
                            setSelectedExecution(exec);
                            setShowDetailModal(true);
                          }}
                          className={`text-[10px] px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80 ${statusColors[exec.status]}`}
                          title={`${exec.plan.procedureCatalog.name} - ${exec.plan.admission.patient.name}`}
                        >
                          {exec.plan.admission.patient.name}
                        </div>
                      ))}
                      {filtered.length > 2 && (
                        <div className="text-[10px] text-slate-400">+{filtered.length - 2}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* New Treatment Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">새 치료 등록</h2>
              <button onClick={() => setShowNewModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 환자 선택 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  환자 선택 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.admissionId}
                  onChange={(e) => setForm({ ...form, admissionId: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">환자를 선택하세요</option>
                  {admissions.map((adm) => (
                    <option key={adm.id} value={adm.id}>
                      {adm.patient.name} ({adm.patient.emrPatientId})
                      {adm.currentBed && ` - ${adm.currentBed.room.ward.name} ${adm.currentBed.room.name}-${adm.currentBed.label}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* 치료 유형 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  치료 유형 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {treatmentTypes.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setForm({ ...form, treatmentType: t.key as TreatmentType })}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                        form.treatmentType === t.key
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 기타치료 - 치료명 입력 */}
              {form.treatmentType === 'OTHER' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    치료명 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.treatmentName}
                    onChange={(e) => setForm({ ...form, treatmentName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="치료명을 입력하세요"
                  />
                </div>
              )}

              {/* 치료 일정 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-700">
                    치료 일정 <span className="text-red-500">*</span>
                  </label>
                  <button
                    onClick={addScheduleRow}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    + 일정 추가
                  </button>
                </div>
                <div className="space-y-2">
                  {form.schedules.map((schedule, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="date"
                        value={schedule.date}
                        onChange={(e) => updateSchedule(index, 'date', e.target.value)}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      />
                      <input
                        type="time"
                        value={schedule.time}
                        onChange={(e) => updateSchedule(index, 'time', e.target.value)}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      />
                      {form.schedules.length > 1 && (
                        <button
                          onClick={() => removeScheduleRow(index)}
                          className="p-2 text-slate-400 hover:text-red-500"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 비고 */}
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
                onClick={handleSubmit}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {saving ? '저장 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedExecution && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowDetailModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">치료 상세</h2>
              <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex justify-between">
                <span className="text-slate-500">치료명</span>
                <span className="font-medium">{selectedExecution.plan.procedureCatalog.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">환자명</span>
                <span className="font-medium">{selectedExecution.plan.admission.patient.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">차트번호</span>
                <span>{selectedExecution.plan.admission.patient.emrPatientId}</span>
              </div>
              {selectedExecution.plan.admission.currentBed && (
                <div className="flex justify-between">
                  <span className="text-slate-500">병실</span>
                  <span>
                    {selectedExecution.plan.admission.currentBed.room.ward.name} {selectedExecution.plan.admission.currentBed.room.name}-{selectedExecution.plan.admission.currentBed.label}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">예정 시간</span>
                <span>{new Date(selectedExecution.scheduledAt).toLocaleString('ko-KR')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">상태</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selectedExecution.status]}`}>
                  {statusLabels[selectedExecution.status]}
                </span>
              </div>
              {selectedExecution.executedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500">실행 시간</span>
                  <span>{new Date(selectedExecution.executedAt).toLocaleString('ko-KR')}</span>
                </div>
              )}
              {selectedExecution.executedBy && (
                <div className="flex justify-between">
                  <span className="text-slate-500">실행자</span>
                  <span>{selectedExecution.executedBy.name}</span>
                </div>
              )}
              {selectedExecution.plan.notes && (
                <div>
                  <span className="text-slate-500 block mb-1">비고</span>
                  <p className="text-sm bg-slate-50 p-2 rounded">{selectedExecution.plan.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="pt-4 border-t border-slate-200 space-y-2">
                {selectedExecution.status === 'SCHEDULED' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStatusChange(selectedExecution, 'IN_PROGRESS')}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition text-sm"
                    >
                      <Clock size={16} />
                      시작
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedExecution, 'COMPLETED')}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition text-sm"
                    >
                      <Check size={16} />
                      완료
                    </button>
                  </div>
                )}
                {selectedExecution.status === 'IN_PROGRESS' && (
                  <button
                    onClick={() => handleStatusChange(selectedExecution, 'COMPLETED')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition text-sm"
                  >
                    <Check size={16} />
                    완료
                  </button>
                )}
                {selectedExecution.status !== 'COMPLETED' && (
                  <button
                    onClick={() => handleDelete(selectedExecution)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition text-sm"
                  >
                    <Trash2 size={16} />
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
