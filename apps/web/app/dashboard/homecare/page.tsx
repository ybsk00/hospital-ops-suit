'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  Home,
  RefreshCw,
  Clock,
  Play,
  CheckCircle,
  User,
  Plus,
  FileText,
  Eye,
  X,
  Search,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Sparkles,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

interface Visit {
  id: string;
  scheduledAt: string;
  completedAt: string | null;
  status: string;
  patient: { id: string; name: string; emrPatientId: string; dob?: string; sex?: string; phone?: string };
  staff: { id: string; name: string };
  questionnaires?: Questionnaire[];
  aiReports?: AiReport[];
}

interface Questionnaire {
  id: string;
  payloadJson: Record<string, any>;
  riskLevel: string;
  riskReason: string | null;
  submittedAt: string;
}

interface AiReport {
  id: string;
  status: string;
  draftText: string | null;
  createdAt: string;
}

interface Patient {
  id: string;
  name: string;
  emrPatientId: string;
}

interface Staff {
  id: string;
  name: string;
  loginId: string;
}

// ============================================================
// Constants
// ============================================================

const statusLabels: Record<string, string> = {
  SCHEDULED: '예정',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

const statusColors: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700 border-blue-200',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  COMPLETED: 'bg-green-100 text-green-700 border-green-200',
  CANCELLED: 'bg-red-100 text-red-500 border-red-200',
};

const riskColors: Record<string, string> = {
  NORMAL: 'bg-green-100 text-green-700',
  ORANGE: 'bg-orange-100 text-orange-700',
  RED: 'bg-red-100 text-red-700',
};

// 문진표 항목 정의
const QUESTIONNAIRE_ITEMS = [
  { key: 'generalCondition', label: '전반적 상태', type: 'select', options: ['양호', '보통', '불량', '위험'] },
  { key: 'painLevel', label: '통증 수준 (0-10)', type: 'number', min: 0, max: 10 },
  { key: 'appetite', label: '식욕', type: 'select', options: ['양호', '감소', '거의 못 먹음'] },
  { key: 'sleep', label: '수면', type: 'select', options: ['양호', '불면', '과다수면'] },
  { key: 'mobility', label: '거동 상태', type: 'select', options: ['독립보행', '보조기구 사용', '침상생활'] },
  { key: 'mentalStatus', label: '정신 상태', type: 'select', options: ['명료', '혼미', '혼돈'] },
  { key: 'skinCondition', label: '피부 상태', type: 'select', options: ['정상', '발적', '욕창 의심', '욕창 확인'] },
  { key: 'vitalBP', label: '혈압 (수축/이완)', type: 'text', placeholder: '120/80' },
  { key: 'vitalPulse', label: '맥박 (회/분)', type: 'number', min: 30, max: 200 },
  { key: 'vitalTemp', label: '체온 (°C)', type: 'number', min: 34, max: 42, step: 0.1 },
  { key: 'vitalSpO2', label: '산소포화도 (%)', type: 'number', min: 70, max: 100 },
  { key: 'notes', label: '특이사항', type: 'textarea' },
];

// ============================================================
// Main Component
// ============================================================

export default function HomecarePage() {
  const { accessToken } = useAuthStore();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailVisit, setDetailVisit] = useState<Visit | null>(null);
  const [showQuestionnaireForm, setShowQuestionnaireForm] = useState<Visit | null>(null);

  const fetchVisits = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: dateFilter });
      if (statusFilter) params.set('status', statusFilter);
      const res = await api<{ items: Visit[] }>(`/api/homecare/visits?${params}`, { token: accessToken });
      setVisits(res.data?.items || []);
    } catch {
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, dateFilter, statusFilter]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  async function handleStatusChange(visit: Visit, newStatus: string) {
    if (!accessToken) return;
    try {
      await api(`/api/homecare/visits/${visit.id}`, {
        method: 'PATCH',
        body: { status: newStatus },
        token: accessToken,
      });
      await fetchVisits();
    } catch (err: any) {
      alert(err.message || '상태 변경에 실패했습니다.');
    }
  }

  async function openDetail(visit: Visit) {
    if (!accessToken) return;
    try {
      const res = await api<Visit>(`/api/homecare/visits/${visit.id}`, { token: accessToken });
      setDetailVisit(res.data || null);
    } catch {
      setDetailVisit(visit);
    }
  }

  // Summary counts
  const counts = {
    total: visits.length,
    scheduled: visits.filter((v) => v.status === 'SCHEDULED').length,
    inProgress: visits.filter((v) => v.status === 'IN_PROGRESS').length,
    completed: visits.filter((v) => v.status === 'COMPLETED').length,
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">가정방문</h1>
          <p className="text-slate-500 text-sm mt-1">가정방문 일정과 문진 결과를 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchVisits} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition text-sm text-slate-600">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-sm shadow-blue-200 transition-colors"
          >
            <Plus size={16} />
            <span>새 방문</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium text-slate-400">전체</p>
          <p className="text-2xl font-bold text-slate-700 mt-0.5">{counts.total}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-xs font-medium text-blue-400">예정</p>
          <p className="text-2xl font-bold text-blue-700 mt-0.5">{counts.scheduled}</p>
        </div>
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-xs font-medium text-yellow-500">진행중</p>
          <p className="text-2xl font-bold text-yellow-700 mt-0.5">{counts.inProgress}</p>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-xs font-medium text-green-400">완료</p>
          <p className="text-2xl font-bold text-green-700 mt-0.5">{counts.completed}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button onClick={() => {
              const d = new Date(dateFilter);
              d.setDate(d.getDate() - 1);
              setDateFilter(d.toISOString().split('T')[0]);
            }} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronLeft size={16} className="text-slate-600" />
            </button>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button onClick={() => {
              const d = new Date(dateFilter);
              d.setDate(d.getDate() + 1);
              setDateFilter(d.toISOString().split('T')[0]);
            }} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <ChevronRight size={16} className="text-slate-600" />
            </button>
          </div>
          <button
            onClick={() => setDateFilter(new Date().toISOString().split('T')[0])}
            className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            오늘
          </button>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
          >
            <option value="">전체 상태</option>
            <option value="SCHEDULED">예정</option>
            <option value="IN_PROGRESS">진행중</option>
            <option value="COMPLETED">완료</option>
            <option value="CANCELLED">취소</option>
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-20 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
          <p className="text-slate-400 text-sm">로딩 중...</p>
        </div>
      )}

      {/* Visit List */}
      {!loading && visits.length > 0 && (
        <div className="space-y-3">
          {visits.map((visit) => (
            <div key={visit.id} className="bg-white rounded-xl border border-slate-200 hover:shadow-md transition-all overflow-hidden">
              <div className="flex items-center gap-4 p-4">
                <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-blue-50 text-blue-500">
                  <User size={20} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{visit.patient.name}</span>
                    <span className="text-xs text-slate-400">{visit.patient.emrPatientId}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">담당: {visit.staff.name}</div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                    <Clock size={11} />
                    {new Date(visit.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    {visit.completedAt && (
                      <span className="ml-2 text-green-500">
                        → {new Date(visit.completedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusColors[visit.status] || 'bg-slate-100 text-slate-600'}`}>
                    {statusLabels[visit.status] || visit.status}
                  </span>

                  {/* Detail button */}
                  <button
                    onClick={() => openDetail(visit)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
                    title="상세 보기"
                  >
                    <Eye size={16} />
                  </button>

                  {/* Questionnaire button - only for IN_PROGRESS or COMPLETED */}
                  {['IN_PROGRESS', 'COMPLETED'].includes(visit.status) && (
                    <button
                      onClick={() => setShowQuestionnaireForm(visit)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100 transition border border-purple-200"
                      title="문진표 작성"
                    >
                      <ClipboardList size={12} />
                      문진
                    </button>
                  )}

                  {visit.status === 'SCHEDULED' && (
                    <button
                      onClick={() => handleStatusChange(visit, 'IN_PROGRESS')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition border border-blue-200"
                    >
                      <Play size={12} /> 시작
                    </button>
                  )}
                  {visit.status === 'IN_PROGRESS' && (
                    <button
                      onClick={() => handleStatusChange(visit, 'COMPLETED')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-bold hover:bg-green-100 transition border border-green-200"
                    >
                      <CheckCircle size={12} /> 완료
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && visits.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
          <Home size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500 font-medium">해당 날짜에 방문 일정이 없습니다.</p>
          <p className="text-slate-400 text-sm mt-1">새 방문을 등록하거나 다른 날짜를 선택하세요.</p>
        </div>
      )}

      {/* Create Visit Modal */}
      {showCreateModal && (
        <CreateVisitModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchVisits(); }}
        />
      )}

      {/* Visit Detail Modal */}
      {detailVisit && (
        <VisitDetailModal
          visit={detailVisit}
          onClose={() => setDetailVisit(null)}
          onOpenQuestionnaire={() => {
            setShowQuestionnaireForm(detailVisit);
            setDetailVisit(null);
          }}
        />
      )}

      {/* Questionnaire Form Modal */}
      {showQuestionnaireForm && (
        <QuestionnaireFormModal
          visit={showQuestionnaireForm}
          onClose={() => setShowQuestionnaireForm(null)}
          onSubmitted={() => { setShowQuestionnaireForm(null); fetchVisits(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Create Visit Modal
// ============================================================

function CreateVisitModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { accessToken } = useAuthStore();
  const [patientSearch, setPatientSearch] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    api<any>('/api/admin/users?limit=50', { token: accessToken }).then((res) => {
      setStaffList(res.data?.users || []);
    });
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || patientSearch.length < 1) { setPatients([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api<Patient[]>(`/api/appointments/patients/search?q=${encodeURIComponent(patientSearch)}`, { token: accessToken });
        setPatients(res.data || []);
      } catch { setPatients([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [patientSearch, accessToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatient) { setError('환자를 선택해 주세요.'); return; }
    if (!staffId) { setError('담당 직원을 선택해 주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      await api('/api/homecare/visits', {
        method: 'POST',
        token: accessToken!,
        body: {
          patientId: selectedPatient.id,
          staffId,
          scheduledAt: `${scheduledDate}T${scheduledTime}:00`,
        },
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || '생성에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Home size={20} className="text-blue-600" />
            <h2 className="text-lg font-bold text-slate-800">새 가정방문</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

          {/* Patient search */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">환자</label>
            {selectedPatient ? (
              <div className="flex items-center justify-between px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-blue-600" />
                  <span className="font-bold text-slate-800">{selectedPatient.name}</span>
                  <span className="text-xs text-slate-500">({selectedPatient.emrPatientId})</span>
                </div>
                <button type="button" onClick={() => { setSelectedPatient(null); setPatientSearch(''); }} className="text-xs text-blue-600 hover:underline">변경</button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text" value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="환자명 또는 등록번호 검색..."
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  autoFocus
                />
                {patients.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {patients.map((p) => (
                      <button key={p.id} type="button" onClick={() => { setSelectedPatient(p); setPatients([]); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left"
                      >
                        <User size={14} className="text-slate-400" />
                        <div>
                          <p className="text-sm font-bold text-slate-800">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.emrPatientId}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Staff */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">담당 직원</label>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">선택</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.loginId})</option>)}
            </select>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">날짜</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">시간</label>
              <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-50">취소</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-sm disabled:opacity-50">
              {saving ? '등록 중...' : '방문 등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Visit Detail Modal
// ============================================================

function VisitDetailModal({ visit, onClose, onOpenQuestionnaire }: { visit: Visit; onClose: () => void; onOpenQuestionnaire: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="relative px-6 py-5 bg-gradient-to-br from-blue-600 to-blue-700 text-white">
          <button onClick={onClose} className="absolute top-3 right-3 p-1.5 hover:bg-white/20 rounded-lg">
            <X size={18} />
          </button>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <User size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">{visit.patient.name}</h2>
              <p className="text-blue-200 text-sm">{visit.patient.emrPatientId}</p>
            </div>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusColors[visit.status]}`}>
            {statusLabels[visit.status]}
          </span>
        </div>

        {/* Info */}
        <div className="px-6 py-5 space-y-4">
          <div className="flex gap-3">
            <Clock size={16} className="text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">일시</p>
              <p className="text-sm font-bold text-slate-800">
                {new Date(visit.scheduledAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
              </p>
              <p className="text-sm text-slate-600">{new Date(visit.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <User size={16} className="text-blue-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase">담당</p>
              <p className="text-sm font-bold text-slate-800">{visit.staff.name}</p>
            </div>
          </div>

          {/* Questionnaires */}
          {visit.questionnaires && visit.questionnaires.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2">문진 기록 ({visit.questionnaires.length}건)</p>
              <div className="space-y-2">
                {visit.questionnaires.map((q) => (
                  <div key={q.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${riskColors[q.riskLevel]}`}>
                        {q.riskLevel === 'RED' ? '위험' : q.riskLevel === 'ORANGE' ? '주의' : '정상'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(q.submittedAt).toLocaleString('ko-KR')}
                      </span>
                    </div>
                    {q.riskReason && <p className="text-xs text-slate-600 mt-1">{q.riskReason}</p>}
                    <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                      {Object.entries(q.payloadJson).slice(0, 5).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-slate-400">{QUESTIONNAIRE_ITEMS.find((i) => i.key === k)?.label || k}</span>
                          <span className="font-medium text-slate-600">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Reports */}
          {visit.aiReports && visit.aiReports.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2">AI 소견서 ({visit.aiReports.length}건)</p>
              {visit.aiReports.map((r) => (
                <div key={r.id} className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-700">{r.status}</span>
                    <span className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleString('ko-KR')}</span>
                  </div>
                  {r.draftText && <p className="text-xs text-slate-600 mt-1 line-clamp-3">{r.draftText}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex gap-2">
          {['IN_PROGRESS', 'COMPLETED'].includes(visit.status) && (
            <button onClick={onOpenQuestionnaire}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 transition shadow-sm"
            >
              <ClipboardList size={13} /> 문진표 작성
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Questionnaire Form Modal
// ============================================================

function QuestionnaireFormModal({ visit, onClose, onSubmitted }: { visit: Visit; onClose: () => void; onSubmitted: () => void }) {
  const { accessToken } = useAuthStore();
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [riskLevel, setRiskLevel] = useState<'NORMAL' | 'ORANGE' | 'RED'>('NORMAL');
  const [riskReason, setRiskReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateField(key: string, value: any) {
    setFormData((prev) => ({ ...prev, [key]: value }));

    // 자동 위험도 판정
    const newData = { ...formData, [key]: value };
    autoDetectRisk(newData);
  }

  function autoDetectRisk(data: Record<string, any>) {
    const reasons: string[] = [];
    let level: 'NORMAL' | 'ORANGE' | 'RED' = 'NORMAL';

    if (data.generalCondition === '위험') { level = 'RED'; reasons.push('전반적 상태 위험'); }
    else if (data.generalCondition === '불량') { level = 'ORANGE'; reasons.push('전반적 상태 불량'); }

    if (Number(data.painLevel) >= 8) { level = 'RED'; reasons.push(`통증 ${data.painLevel}/10`); }
    else if (Number(data.painLevel) >= 6) { if (level !== 'RED') level = 'ORANGE'; reasons.push(`통증 ${data.painLevel}/10`); }

    if (data.mentalStatus === '혼돈') { level = 'RED'; reasons.push('정신 상태 혼돈'); }
    else if (data.mentalStatus === '혼미') { if (level !== 'RED') level = 'ORANGE'; reasons.push('정신 상태 혼미'); }

    if (data.skinCondition === '욕창 확인') { level = 'RED'; reasons.push('욕창 확인'); }
    else if (data.skinCondition === '욕창 의심') { if (level !== 'RED') level = 'ORANGE'; reasons.push('욕창 의심'); }

    if (Number(data.vitalTemp) >= 38.5) { level = 'RED'; reasons.push(`체온 ${data.vitalTemp}°C`); }
    else if (Number(data.vitalTemp) >= 37.5) { if (level !== 'RED') level = 'ORANGE'; reasons.push(`체온 ${data.vitalTemp}°C`); }

    if (Number(data.vitalSpO2) > 0 && Number(data.vitalSpO2) < 90) { level = 'RED'; reasons.push(`SpO2 ${data.vitalSpO2}%`); }
    else if (Number(data.vitalSpO2) > 0 && Number(data.vitalSpO2) < 95) { if (level !== 'RED') level = 'ORANGE'; reasons.push(`SpO2 ${data.vitalSpO2}%`); }

    if (data.appetite === '거의 못 먹음') { if (level !== 'RED') level = 'ORANGE'; reasons.push('식욕 극저하'); }

    setRiskLevel(level);
    if (reasons.length > 0) setRiskReason(reasons.join(', '));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/homecare/visits/${visit.id}/questionnaire`, {
        method: 'POST',
        token: accessToken,
        body: {
          payloadJson: formData,
          riskLevel,
          riskReason: riskReason || undefined,
          idempotencyKey: `${visit.id}-${Date.now()}`,
        },
      });
      onSubmitted();
    } catch (err: any) {
      setError(err.message || '제출에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-purple-600" />
            <div>
              <h2 className="text-lg font-bold text-slate-800">문진표 작성</h2>
              <p className="text-xs text-slate-500">{visit.patient.name} ({visit.patient.emrPatientId})</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg"><X size={20} className="text-slate-500" /></button>
        </div>

        {/* Risk Level Badge */}
        <div className={`px-6 py-3 flex items-center gap-3 border-b shrink-0 ${
          riskLevel === 'RED' ? 'bg-red-50 border-red-200' :
          riskLevel === 'ORANGE' ? 'bg-orange-50 border-orange-200' :
          'bg-green-50 border-green-200'
        }`}>
          <AlertTriangle size={16} className={
            riskLevel === 'RED' ? 'text-red-600' :
            riskLevel === 'ORANGE' ? 'text-orange-600' : 'text-green-600'
          } />
          <div>
            <span className={`text-xs font-bold ${
              riskLevel === 'RED' ? 'text-red-700' :
              riskLevel === 'ORANGE' ? 'text-orange-700' : 'text-green-700'
            }`}>
              위험도: {riskLevel === 'RED' ? '위험 (RED)' : riskLevel === 'ORANGE' ? '주의 (ORANGE)' : '정상 (NORMAL)'}
            </span>
            {riskReason && <p className="text-[11px] text-slate-500 mt-0.5">{riskReason}</p>}
          </div>
          {/* Manual override */}
          <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as any)}
            className="ml-auto text-xs px-2 py-1 border rounded bg-white">
            <option value="NORMAL">정상</option>
            <option value="ORANGE">주의</option>
            <option value="RED">위험</option>
          </select>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-3">
          {error && <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

          {QUESTIONNAIRE_ITEMS.map((item) => (
            <div key={item.key}>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{item.label}</label>
              {item.type === 'select' ? (
                <select
                  value={formData[item.key] || ''}
                  onChange={(e) => updateField(item.key, e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  <option value="">선택</option>
                  {item.options!.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : item.type === 'textarea' ? (
                <textarea
                  value={formData[item.key] || ''}
                  onChange={(e) => updateField(item.key, e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                />
              ) : item.type === 'number' ? (
                <input
                  type="number"
                  value={formData[item.key] || ''}
                  onChange={(e) => updateField(item.key, e.target.value)}
                  min={item.min}
                  max={item.max}
                  step={item.step || 1}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                />
              ) : (
                <input
                  type="text"
                  value={formData[item.key] || ''}
                  onChange={(e) => updateField(item.key, e.target.value)}
                  placeholder={item.placeholder}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                />
              )}
            </div>
          ))}

          {/* Risk Reason (manual) */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">위험 사유 (자동감지 + 수동입력)</label>
            <input
              type="text"
              value={riskReason}
              onChange={(e) => setRiskReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
              placeholder="자동으로 감지되거나 직접 입력..."
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-50">취소</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold shadow-sm disabled:opacity-50"
          >
            {saving ? '제출 중...' : '문진표 제출'}
          </button>
        </div>
      </div>
    </div>
  );
}
