'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  FlaskConical,
  RefreshCw,
  Plus,
  Search,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ChevronLeft,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';

// ── 타입 ──

interface LabResult {
  id: string;
  patientId: string;
  testName: string;
  analyte: string;
  value: number;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flag: string;
  flagReason: string | null;
  collectedAt: string;
  patient?: { id: string; name: string; emrPatientId: string };
}

// ── 상수 ──

const flagColors: Record<string, string> = {
  NORMAL: 'bg-green-100 text-green-700',
  HIGH: 'bg-red-100 text-red-700',
  LOW: 'bg-blue-100 text-blue-700',
  CRITICAL: 'bg-red-200 text-red-800',
};

const flagLabels: Record<string, string> = {
  NORMAL: '정상',
  HIGH: '높음',
  LOW: '낮음',
  CRITICAL: '위험',
};

const flagFilterOptions = [
  { value: '', label: '전체 판정' },
  { value: 'NORMAL', label: '정상' },
  { value: 'HIGH', label: '높음' },
  { value: 'LOW', label: '낮음' },
  { value: 'CRITICAL', label: '위험' },
];

// ── 날짜별 그룹핑 ──

function groupByDate(results: LabResult[]): Record<string, LabResult[]> {
  const groups: Record<string, LabResult[]> = {};
  for (const r of results) {
    const date = new Date(r.collectedAt).toLocaleDateString('ko-KR');
    if (!groups[date]) groups[date] = [];
    groups[date].push(r);
  }
  return groups;
}

// ── 메인 페이지 ──

export default function LabResultsPage() {
  const { accessToken } = useAuthStore();
  const router = useRouter();

  const [results, setResults] = useState<LabResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [flagFilter, setFlagFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);

  // 환자별 상세
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string; emrPatientId: string } | null>(null);
  const [patientResults, setPatientResults] = useState<LabResult[]>([]);
  const [patientSummary, setPatientSummary] = useState<{ total: number; abnormalCount: number; testNames: string[] } | null>(null);
  const [patientLoading, setPatientLoading] = useState(false);

  // 모달
  const [showCreate, setShowCreate] = useState(false);
  const [showBatchCreate, setShowBatchCreate] = useState(false);

  // AI소견서 자동생성 알림
  const [autoReportNotice, setAutoReportNotice] = useState<{ id: string } | null>(null);

  // ── 목록 조회 ──

  const fetchResults = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (flagFilter) params.set('flag', flagFilter);
      if (searchText) params.set('testName', searchText);
      params.set('page', String(page));
      params.set('limit', '20');

      const res = await api<{ items: LabResult[]; total: number }>(`/api/lab-results?${params}`, {
        token: accessToken,
      });
      setResults(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, flagFilter, searchText, page]);

  useEffect(() => {
    if (!selectedPatient) fetchResults();
  }, [fetchResults, selectedPatient]);

  // ── 환자별 조회 ──

  async function fetchPatientResults(patient: { id: string; name: string; emrPatientId: string }) {
    if (!accessToken) return;
    setSelectedPatient(patient);
    setPatientLoading(true);
    try {
      const res = await api<{ results: LabResult[]; summary: any }>(`/api/lab-results/patient/${patient.id}`, {
        token: accessToken,
      });
      setPatientResults(res.data?.results || []);
      setPatientSummary(res.data?.summary || null);
    } catch {
      setPatientResults([]);
    } finally {
      setPatientLoading(false);
    }
  }

  // ── 환자별 상세 뷰 ──

  if (selectedPatient) {
    const grouped = groupByDate(patientResults);

    return (
      <div>
        <button
          onClick={() => setSelectedPatient(null)}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
        >
          <ChevronLeft size={16} />
          목록으로
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {selectedPatient.name} ({selectedPatient.emrPatientId})
            </h1>
            <p className="text-slate-500 mt-1">환자별 검사결과 추이</p>
          </div>
          <button
            onClick={() => {
              router.push(`/dashboard/ai-reports?patientId=${selectedPatient.id}`);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-sm font-medium hover:from-blue-700 hover:to-purple-700 transition"
          >
            <Sparkles size={16} />
            AI 소견서 보기
          </button>
        </div>

        {/* 요약 카드 */}
        {patientSummary && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">총 검사</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{patientSummary.total}건</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">이상 수치</div>
              <div className="text-2xl font-bold text-red-600 mt-1">{patientSummary.abnormalCount}건</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500">검사 항목</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{patientSummary.testNames.length}종</div>
            </div>
          </div>
        )}

        {patientLoading ? (
          <div className="text-center py-12 text-slate-400">로딩 중...</div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {Object.entries(grouped).map(([date, items]) => (
              <div key={date}>
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-600">
                  {date}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-4 py-2 text-left font-medium text-slate-500">검사항목</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">분석물</th>
                      <th className="px-4 py-2 text-right font-medium text-slate-500">수치</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">단위</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">참고범위</th>
                      <th className="px-4 py-2 text-left font-medium text-slate-500">판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((lab) => (
                      <tr key={lab.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium">{lab.testName}</td>
                        <td className="px-4 py-2">{lab.analyte}</td>
                        <td className="px-4 py-2 text-right font-mono font-medium">{lab.value}</td>
                        <td className="px-4 py-2 text-slate-500">{lab.unit || '-'}</td>
                        <td className="px-4 py-2 text-slate-500">
                          {lab.refLow != null && lab.refHigh != null ? `${lab.refLow}–${lab.refHigh}` : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${flagColors[lab.flag] || 'bg-slate-100 text-slate-600'}`}>
                            {lab.flag === 'HIGH' && <TrendingUp size={12} />}
                            {lab.flag === 'LOW' && <TrendingDown size={12} />}
                            {lab.flag === 'CRITICAL' && <AlertTriangle size={12} />}
                            {flagLabels[lab.flag] || lab.flag}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {patientResults.length === 0 && (
              <div className="px-4 py-12 text-center text-slate-400">검사결과가 없습니다.</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── 목록 뷰 ──

  const grouped = groupByDate(results);

  return (
    <div>
      {/* AI 소견서 자동생성 알림 */}
      {autoReportNotice && (
        <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles size={20} className="text-blue-600" />
            <div>
              <div className="text-sm font-medium text-slate-800">AI 소견서가 자동 생성되었습니다.</div>
              <div className="text-xs text-slate-500 mt-0.5">검사결과를 분석하여 소견서 초안을 작성 중입니다.</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/dashboard/ai-reports')}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition"
            >
              소견서 확인하기
            </button>
            <button onClick={() => setAutoReportNotice(null)} className="text-slate-400 hover:text-slate-600 text-xs">
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">검사결과</h1>
          <p className="text-slate-500 mt-1">혈액검사/소변검사 결과를 조회하고 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchResults}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
          >
            <RefreshCw size={16} />
            새로고침
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
          >
            <Plus size={16} />
            결과 등록
          </button>
          <button
            onClick={() => setShowBatchCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm"
          >
            <Upload size={16} />
            일괄 등록
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={flagFilter}
          onChange={(e) => { setFlagFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        >
          {flagFilterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="flex gap-1">
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchResults()}
            placeholder="검사항목명 검색"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-48"
          />
          <button onClick={fetchResults} className="px-3 py-2 bg-slate-100 rounded-lg hover:bg-slate-200 transition">
            <Search size={16} />
          </button>
        </div>
        <span className="text-sm text-slate-500">총 {total}건</span>
      </div>

      {/* Loading */}
      {loading && <div className="text-center py-12 text-slate-400">로딩 중...</div>}

      {/* 날짜별 그룹핑 테이블 */}
      {!loading && results.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-600">
                {date} ({items.length}건)
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2 text-left font-medium text-slate-500">환자</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">검사항목</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">분석물</th>
                    <th className="px-4 py-2 text-right font-medium text-slate-500">수치</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">단위</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">참고범위</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-500">판정</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((lab) => (
                    <tr key={lab.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2">
                        {lab.patient ? (
                          <button
                            onClick={() => fetchPatientResults(lab.patient!)}
                            className="text-blue-600 hover:underline font-medium"
                          >
                            {lab.patient.name} ({lab.patient.emrPatientId})
                          </button>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-2 font-medium">{lab.testName}</td>
                      <td className="px-4 py-2">{lab.analyte}</td>
                      <td className="px-4 py-2 text-right font-mono font-medium">{lab.value}</td>
                      <td className="px-4 py-2 text-slate-500">{lab.unit || '-'}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {lab.refLow != null && lab.refHigh != null ? `${lab.refLow}–${lab.refHigh}` : '-'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${flagColors[lab.flag] || 'bg-slate-100 text-slate-600'}`}>
                          {lab.flag === 'HIGH' && <TrendingUp size={12} />}
                          {lab.flag === 'LOW' && <TrendingDown size={12} />}
                          {lab.flag === 'CRITICAL' && <AlertTriangle size={12} />}
                          {flagLabels[lab.flag] || lab.flag}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > 20 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-50"
          >
            이전
          </button>
          <span className="text-sm text-slate-600">
            {page} / {Math.ceil(total / 20)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / 20)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm disabled:opacity-50 hover:bg-slate-50"
          >
            다음
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && results.length === 0 && (
        <div className="text-center py-12">
          <FlaskConical size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">검사결과가 없습니다.</p>
        </div>
      )}

      {/* 단건 등록 모달 */}
      {showCreate && (
        <CreateLabResultModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchResults(); }}
        />
      )}

      {/* 배치 등록 모달 */}
      {showBatchCreate && (
        <BatchCreateModal
          onClose={() => setShowBatchCreate(false)}
          onCreated={(autoReport) => {
            setShowBatchCreate(false);
            fetchResults();
            if (autoReport) setAutoReportNotice(autoReport);
          }}
        />
      )}
    </div>
  );
}

// ── 검사결과 등록 모달 (단건) ──

function CreateLabResultModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { accessToken } = useAuthStore();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<{ id: string; name: string; emrPatientId: string }[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    testName: '', analyte: '', value: '', unit: '', refLow: '', refHigh: '',
    collectedAt: new Date().toISOString().slice(0, 16),
  });

  async function searchPatients() {
    if (!accessToken || search.length < 1) return;
    try {
      const res = await api<{ items: any[] }>(`/api/admissions?search=${encodeURIComponent(search)}&limit=10`, { token: accessToken });
      const admissions = res.data?.items || [];
      const seen = new Set<string>();
      const pts: { id: string; name: string; emrPatientId: string }[] = [];
      for (const a of admissions) {
        const p = a.patient;
        if (p && !seen.has(p.id)) { seen.add(p.id); pts.push({ id: p.id, name: p.name, emrPatientId: p.emrPatientId }); }
      }
      setPatients(pts);
    } catch { setPatients([]); }
  }

  async function handleCreate() {
    if (!accessToken || !selectedPatient) return;
    if (!form.testName || !form.analyte || !form.value) { alert('검사항목, 분석물, 수치는 필수입니다.'); return; }
    setCreating(true);
    try {
      await api('/api/lab-results', {
        method: 'POST',
        body: {
          patientId: selectedPatient.id,
          collectedAt: new Date(form.collectedAt).toISOString(),
          testName: form.testName, analyte: form.analyte, value: parseFloat(form.value),
          unit: form.unit || undefined,
          refLow: form.refLow ? parseFloat(form.refLow) : undefined,
          refHigh: form.refHigh ? parseFloat(form.refHigh) : undefined,
        },
        token: accessToken,
      });
      onCreated();
    } catch (err: any) { alert(err.message || '등록 실패'); } finally { setCreating(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900 mb-4">검사결과 등록</h3>
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">환자 검색</label>
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchPatients()} placeholder="환자명 또는 EMR ID" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <button onClick={searchPatients} className="px-3 py-2 bg-slate-100 rounded-lg hover:bg-slate-200"><Search size={16} /></button>
          </div>
        </div>
        {patients.length > 0 && !selectedPatient && (
          <div className="mb-4 max-h-32 overflow-y-auto border border-slate-200 rounded-lg">
            {patients.map((p) => (<button key={p.id} onClick={() => setSelectedPatient(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">{p.name} ({p.emrPatientId})</button>))}
          </div>
        )}
        {selectedPatient && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700 flex items-center justify-between">
            <span>선택: <strong>{selectedPatient.name}</strong></span>
            <button onClick={() => setSelectedPatient(null)} className="text-blue-500 hover:underline text-xs">변경</button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">채취일시</label><input type="datetime-local" value={form.collectedAt} onChange={(e) => setForm({ ...form, collectedAt: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">검사항목 *</label><input value={form.testName} onChange={(e) => setForm({ ...form, testName: e.target.value })} placeholder="예: CBC" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">분석물 *</label><input value={form.analyte} onChange={(e) => setForm({ ...form, analyte: e.target.value })} placeholder="예: WBC" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">수치 *</label><input type="number" step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="예: 5.2" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">단위</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="예: 10³/μL" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">참고 하한</label><input type="number" step="any" value={form.refLow} onChange={(e) => setForm({ ...form, refLow: e.target.value })} placeholder="예: 4.0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">참고 상한</label><input type="number" step="any" value={form.refHigh} onChange={(e) => setForm({ ...form, refHigh: e.target.value })} placeholder="예: 10.0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 transition">취소</button>
          <button onClick={handleCreate} disabled={!selectedPatient || creating} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50">{creating ? '등록 중...' : '등록'}</button>
        </div>
      </div>
    </div>
  );
}

// ── 배치 등록 모달 (여러 건 + AI소견서 자동생성) ──

interface BatchRow {
  testName: string;
  analyte: string;
  value: string;
  unit: string;
  refLow: string;
  refHigh: string;
}

function BatchCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (autoReport: { id: string } | null) => void;
}) {
  const { accessToken } = useAuthStore();
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<{ id: string; name: string; emrPatientId: string }[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string; emrPatientId: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [collectedAt, setCollectedAt] = useState(new Date().toISOString().slice(0, 16));

  const [rows, setRows] = useState<BatchRow[]>([
    { testName: '', analyte: '', value: '', unit: '', refLow: '', refHigh: '' },
  ]);

  async function searchPatients() {
    if (!accessToken || search.length < 1) return;
    try {
      const res = await api<{ items: any[] }>(`/api/admissions?search=${encodeURIComponent(search)}&limit=10`, { token: accessToken });
      const admissions = res.data?.items || [];
      const seen = new Set<string>();
      const pts: { id: string; name: string; emrPatientId: string }[] = [];
      for (const a of admissions) {
        const p = a.patient;
        if (p && !seen.has(p.id)) { seen.add(p.id); pts.push({ id: p.id, name: p.name, emrPatientId: p.emrPatientId }); }
      }
      setPatients(pts);
    } catch { setPatients([]); }
  }

  function addRow() {
    setRows([...rows, { testName: '', analyte: '', value: '', unit: '', refLow: '', refHigh: '' }]);
  }

  function removeRow(idx: number) {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, field: keyof BatchRow, value: string) {
    const updated = [...rows];
    updated[idx] = { ...updated[idx], [field]: value };
    setRows(updated);
  }

  async function handleBatchCreate() {
    if (!accessToken || !selectedPatient) return;
    const validRows = rows.filter((r) => r.testName && r.analyte && r.value);
    if (validRows.length === 0) { alert('최소 1건의 검사항목을 입력해주세요.'); return; }

    setCreating(true);
    try {
      const res = await api<{ created: number; abnormalCount: number; autoReport: { id: string; status: string } | null }>('/api/lab-results/batch', {
        method: 'POST',
        body: {
          patientId: selectedPatient.id,
          collectedAt: new Date(collectedAt).toISOString(),
          results: validRows.map((r) => ({
            testName: r.testName,
            analyte: r.analyte,
            value: parseFloat(r.value),
            unit: r.unit || undefined,
            refLow: r.refLow ? parseFloat(r.refLow) : undefined,
            refHigh: r.refHigh ? parseFloat(r.refHigh) : undefined,
          })),
        },
        token: accessToken,
      });

      onCreated(res.data?.autoReport || null);
    } catch (err: any) {
      alert(err.message || '일괄 등록 실패');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900 mb-1">검사결과 일괄 등록</h3>
        <p className="text-xs text-slate-500 mb-4">등록 완료 시 AI 소견서가 자동으로 생성됩니다.</p>

        {/* 환자 검색 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">환자 검색</label>
          <div className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchPatients()} placeholder="환자명 또는 EMR ID" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <button onClick={searchPatients} className="px-3 py-2 bg-slate-100 rounded-lg hover:bg-slate-200"><Search size={16} /></button>
          </div>
        </div>

        {patients.length > 0 && !selectedPatient && (
          <div className="mb-4 max-h-32 overflow-y-auto border border-slate-200 rounded-lg">
            {patients.map((p) => (
              <button key={p.id} onClick={() => setSelectedPatient(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">
                {p.name} ({p.emrPatientId})
              </button>
            ))}
          </div>
        )}

        {selectedPatient && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700 flex items-center justify-between">
            <span>환자: <strong>{selectedPatient.name}</strong> ({selectedPatient.emrPatientId})</span>
            <button onClick={() => setSelectedPatient(null)} className="text-blue-500 hover:underline text-xs">변경</button>
          </div>
        )}

        {/* 채취일시 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">채취일시</label>
          <input type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>

        {/* 검사항목 행 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">검사항목 ({rows.length}건)</label>
            <button onClick={addRow} className="text-xs text-blue-600 hover:underline">+ 행 추가</button>
          </div>
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-7 gap-2 items-center">
                <input value={row.testName} onChange={(e) => updateRow(idx, 'testName', e.target.value)} placeholder="검사항목*" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                <input value={row.analyte} onChange={(e) => updateRow(idx, 'analyte', e.target.value)} placeholder="분석물*" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                <input type="number" step="any" value={row.value} onChange={(e) => updateRow(idx, 'value', e.target.value)} placeholder="수치*" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                <input value={row.unit} onChange={(e) => updateRow(idx, 'unit', e.target.value)} placeholder="단위" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                <input type="number" step="any" value={row.refLow} onChange={(e) => updateRow(idx, 'refLow', e.target.value)} placeholder="참고하한" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                <input type="number" step="any" value={row.refHigh} onChange={(e) => updateRow(idx, 'refHigh', e.target.value)} placeholder="참고상한" className="px-2 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                <button onClick={() => removeRow(idx)} disabled={rows.length <= 1} className="text-red-400 hover:text-red-600 text-xs disabled:opacity-30">삭제</button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 transition">취소</button>
          <button
            onClick={handleBatchCreate}
            disabled={!selectedPatient || creating}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {creating ? '등록 중...' : '일괄 등록 + AI분석'}
          </button>
        </div>
      </div>
    </div>
  );
}
