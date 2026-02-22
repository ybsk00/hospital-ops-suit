'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import { ChevronLeft, ChevronRight, Calendar, Plus, Printer, Search, X } from 'lucide-react';

type TabType = 'evaluation' | 'round-prep' | 'round-print';

interface EvaluationItem {
  id: string;
  patientId: string;
  patientType: string;
  diagnosis: string | null;
  probeType: string | null;
  outputPercent: number | null;
  temperature: number | null;
  treatmentTime: number | null;
  ivTreatment: string | null;
  patientIssue: string | null;
  doctorCode: string | null;
  roomNumber: string | null;
  evaluatedAt: string;
  patient: { id: string; name: string; emrPatientId: string | null; sex: string | null; dob: string | null };
  createdBy: { name: string } | null;
}

interface RoundPatient {
  slotId: string;
  roomNumber: string;
  chartNumber: string | null;
  name: string | null;
  age: number | null;
  sex: string | null;
  diagnosis: string | null;
  startTime: string;
  duration: number;
  doctorCode: string | null;
  recentEvals: Array<{
    id: string;
    evaluatedAt: string;
    probeType: string | null;
    outputPercent: number | null;
    temperature: number | null;
    treatmentTime: number | null;
    patientIssue: string | null;
  }>;
}

interface PrintPatient {
  roomNumber: string;
  chartNumber: string | null;
  name: string | null;
  ageSex: string;
  diagnosis: string;
  startTime: string;
  endTime: string;
  notes: string;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RfEvaluationPage() {
  const { accessToken } = useAuthStore();
  const [tab, setTab] = useState<TabType>('evaluation');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [loading, setLoading] = useState(false);
  const [searchPatient, setSearchPatient] = useState('');
  const [searchDoctor, setSearchDoctor] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Evaluation list
  const [evaluations, setEvaluations] = useState<EvaluationItem[]>([]);
  const [totalEvals, setTotalEvals] = useState(0);
  const [evalPage, setEvalPage] = useState(1);

  // Round prep
  const [roundPatients, setRoundPatients] = useState<RoundPatient[]>([]);
  const [roundTime, setRoundTime] = useState<string | null>(null);
  const [roundDoctor, setRoundDoctor] = useState('');

  // Round print
  const [printData, setPrintData] = useState<{ title: string; patientCount: number; suggestedRoundTime: string | null; patients: PrintPatient[] } | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    patientName: '', probeType: '', outputPercent: '',
    temperature: '', treatmentTime: '', ivTreatment: '', patientIssue: '',
    doctorCode: 'C', roomNumber: '',
  });

  const fetchEvaluations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date, page: String(evalPage), limit: '30' });
      if (searchPatient) params.set('patient', searchPatient);
      if (searchDoctor) params.set('doctor', searchDoctor);
      const res = await api(`/api/rf-evaluation?${params}`, { token: accessToken || undefined });
      if (res.success) {
        setEvaluations(res.data.evaluations || []);
        setTotalEvals(res.data.total || 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [date, evalPage, searchPatient, searchDoctor, accessToken]);

  const fetchRoundPrep = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (roundDoctor) params.set('doctor', roundDoctor);
      const res = await api(`/api/rf-evaluation/round-prep?${params}`, { token: accessToken || undefined });
      if (res.success) {
        setRoundPatients(res.data.patients || []);
        setRoundTime(res.data.suggestedRoundTime);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [date, roundDoctor, accessToken]);

  const fetchRoundPrint = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (roundDoctor) params.set('doctor', roundDoctor);
      const res = await api(`/api/rf-evaluation/round-print?${params}`, { token: accessToken || undefined });
      if (res.success) setPrintData(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [date, roundDoctor, accessToken]);

  // 날짜/탭 변경 시 즉시 로드
  useEffect(() => {
    if (tab === 'evaluation') fetchEvaluations();
    else if (tab === 'round-prep') fetchRoundPrep();
    else fetchRoundPrint();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, date, evalPage, roundDoctor]);

  // 검색어 변경 시 500ms 디바운스
  useEffect(() => {
    if (tab !== 'evaluation') return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetchEvaluations();
    }, 500);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchPatient, searchDoctor]);

  const navigateDate = (delta: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(toDateStr(d));
  };

  const handleCreate = async () => {
    try {
      const body: any = {
        patientName: createForm.patientName || undefined,
        probeType: createForm.probeType || undefined,
        outputPercent: createForm.outputPercent ? parseInt(createForm.outputPercent) : undefined,
        temperature: createForm.temperature ? parseFloat(createForm.temperature) : undefined,
        treatmentTime: createForm.treatmentTime ? parseInt(createForm.treatmentTime) : undefined,
        ivTreatment: createForm.ivTreatment || undefined,
        patientIssue: createForm.patientIssue || undefined,
        doctorCode: createForm.doctorCode || undefined,
        roomNumber: createForm.roomNumber || undefined,
      };
      const res = await api('/api/rf-evaluation', { method: 'POST', body, token: accessToken || undefined });
      if (res.success) {
        setShowCreate(false);
        setCreateForm({ patientName: '', probeType: '', outputPercent: '', temperature: '', treatmentTime: '', ivTreatment: '', patientIssue: '', doctorCode: 'C', roomNumber: '' });
        fetchEvaluations();
      }
    } catch { /* ignore */ }
  };

  const handlePrint = () => window.print();

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6 print:mb-2">
        <h1 className="text-2xl font-bold text-slate-800 print:text-lg">고주파 치료 평가</h1>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 print:hidden">
          {(['evaluation', 'round-prep', 'round-print'] as TabType[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'evaluation' ? '치료평가' : t === 'round-prep' ? '회진준비' : '회진프린트'}
            </button>
          ))}
        </div>
      </div>

      {/* 날짜 + 액션 */}
      <div className="flex items-center gap-3 mb-4 print:hidden">
        <button onClick={() => navigateDate(-1)} className="p-1.5 rounded hover:bg-slate-100"><ChevronLeft size={18} /></button>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-slate-400" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={() => navigateDate(1)} className="p-1.5 rounded hover:bg-slate-100"><ChevronRight size={18} /></button>

        {(tab === 'round-prep' || tab === 'round-print') && (
          <div className="flex items-center gap-2 ml-4">
            <label className="text-sm text-slate-500">담당의:</label>
            <select value={roundDoctor} onChange={(e) => setRoundDoctor(e.target.value)} className="border rounded px-2 py-1 text-sm">
              <option value="">전체</option>
              <option value="C">최원장</option>
              <option value="J">전원장</option>
            </select>
          </div>
        )}

        <div className="ml-auto flex gap-2">
          {tab === 'evaluation' && (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              <Plus size={16} /> 평가 추가
            </button>
          )}
          {tab === 'round-print' && (
            <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-white rounded-lg text-sm hover:bg-slate-800">
              <Printer size={16} /> 인쇄
            </button>
          )}
        </div>
      </div>

      {loading && <div className="text-center py-8 text-slate-400 print:hidden">불러오는 중...</div>}

      {/* ────── 치료평가 탭 ────── */}
      {tab === 'evaluation' && !loading && (
        <div>
          {/* 검색 필터 */}
          <div className="flex gap-2 mb-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={searchPatient} onChange={(e) => setSearchPatient(e.target.value)}
                placeholder="환자이름" className="pl-8 pr-3 py-1.5 border rounded text-sm w-40" />
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={searchDoctor} onChange={(e) => setSearchDoctor(e.target.value)}
                placeholder="담당의" className="pl-8 pr-3 py-1.5 border rounded text-sm w-32" />
            </div>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="px-3 py-2 text-left">환자</th>
                  <th className="px-3 py-2 text-left">구분</th>
                  <th className="px-3 py-2 text-center">도자</th>
                  <th className="px-3 py-2 text-center">출력%</th>
                  <th className="px-3 py-2 text-center">온도</th>
                  <th className="px-3 py-2 text-center">시간(분)</th>
                  <th className="px-3 py-2 text-left">수액</th>
                  <th className="px-3 py-2 text-left">특이사항</th>
                  <th className="px-3 py-2 text-left">담당</th>
                  <th className="px-3 py-2 text-left">기록자</th>
                  <th className="px-3 py-2 text-left">날짜</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">평가 기록이 없습니다.</td></tr>
                )}
                {evaluations.map((ev) => (
                  <tr key={ev.id} className="border-b hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{ev.patient?.name}</div>
                      <div className="text-xs text-slate-400">{ev.patient?.emrPatientId || ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${ev.patientType === 'INPATIENT' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                        {ev.patientType === 'INPATIENT' ? '입원' : '외래'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-medium">{ev.probeType || '-'}</td>
                    <td className="px-3 py-2 text-center">{ev.outputPercent != null ? `${ev.outputPercent}%` : '-'}</td>
                    <td className="px-3 py-2 text-center">{ev.temperature != null ? `${ev.temperature}℃` : '-'}</td>
                    <td className="px-3 py-2 text-center">{ev.treatmentTime != null ? `${ev.treatmentTime}` : '-'}</td>
                    <td className="px-3 py-2 text-xs">{ev.ivTreatment || '-'}</td>
                    <td className="px-3 py-2 text-xs max-w-[200px] truncate">{ev.patientIssue || '-'}</td>
                    <td className="px-3 py-2">{ev.doctorCode || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{ev.createdBy?.name || '-'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{new Date(ev.evaluatedAt).toLocaleDateString('ko-KR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalEvals > 30 && (
            <div className="flex justify-center gap-2 mt-4">
              <button onClick={() => setEvalPage(Math.max(1, evalPage - 1))} disabled={evalPage <= 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-30">이전</button>
              <span className="px-3 py-1 text-sm">{evalPage} / {Math.ceil(totalEvals / 30)}</span>
              <button onClick={() => setEvalPage(evalPage + 1)} disabled={evalPage >= Math.ceil(totalEvals / 30)}
                className="px-3 py-1 border rounded text-sm disabled:opacity-30">다음</button>
            </div>
          )}
        </div>
      )}

      {/* ────── 회진준비 탭 ────── */}
      {tab === 'round-prep' && !loading && (
        <div>
          {roundTime && (
            <div className="mb-3 px-4 py-2 bg-blue-50 rounded-lg text-sm text-blue-700">
              추천 회진 시간: <strong>{roundTime}</strong> ({roundPatients.length}명)
            </div>
          )}
          <div className="space-y-3">
            {roundPatients.length === 0 && <div className="text-center py-12 text-slate-400">해당 날짜의 고주파 스케줄이 없습니다.</div>}
            {roundPatients.map((p) => (
              <div key={p.slotId} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-slate-400 text-sm ml-2">{p.chartNumber}</span>
                    {p.age != null && <span className="text-slate-400 text-sm ml-2">{p.age}/{p.sex}</span>}
                  </div>
                  <div className="text-sm">
                    <span className="bg-slate-100 px-2 py-0.5 rounded">{p.roomNumber}번</span>
                    <span className="ml-2 text-slate-500">{p.startTime} ({p.duration}분)</span>
                    {p.doctorCode && <span className="ml-2 text-blue-600">{p.doctorCode}</span>}
                  </div>
                </div>
                {p.diagnosis && <div className="text-sm text-slate-600 mb-2">진단: {p.diagnosis}</div>}
                {p.recentEvals.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-400 mb-1">최근 치료 기록</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {p.recentEvals.map((ev) => (
                        <div key={ev.id} className="bg-slate-50 rounded px-3 py-2 text-xs">
                          <div className="text-slate-400">{new Date(ev.evaluatedAt).toLocaleDateString('ko-KR')}</div>
                          <div>
                            {ev.probeType && <span>도자{ev.probeType} </span>}
                            {ev.outputPercent != null && <span>{ev.outputPercent}% </span>}
                            {ev.temperature != null && <span>{ev.temperature}℃ </span>}
                            {ev.treatmentTime != null && <span>{ev.treatmentTime}분</span>}
                          </div>
                          {ev.patientIssue && <div className="text-red-500 mt-0.5">{ev.patientIssue}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ────── 회진프린트 탭 ────── */}
      {tab === 'round-print' && !loading && printData && (
        <div className="print:text-xs">
          <div className="text-center mb-4 print:mb-2">
            <h2 className="text-xl font-bold print:text-base">{printData.title} 고주파 회진</h2>
            {printData.suggestedRoundTime && (
              <div className="text-sm text-slate-500">회진 시간: {printData.suggestedRoundTime} | {printData.patientCount}명</div>
            )}
          </div>
          <table className="w-full text-sm border-collapse print:text-xs">
            <thead>
              <tr className="border-2 border-slate-800">
                <th className="border px-2 py-1.5 bg-slate-100">기계</th>
                <th className="border px-2 py-1.5 bg-slate-100">차트번호</th>
                <th className="border px-2 py-1.5 bg-slate-100">이름</th>
                <th className="border px-2 py-1.5 bg-slate-100">나이/성별</th>
                <th className="border px-2 py-1.5 bg-slate-100">진단</th>
                <th className="border px-2 py-1.5 bg-slate-100">시간</th>
                <th className="border px-2 py-1.5 bg-slate-100 w-1/4">비고</th>
              </tr>
            </thead>
            <tbody>
              {printData.patients.map((p, i) => (
                <tr key={i} className="border">
                  <td className="border px-2 py-1.5 text-center">{p.roomNumber}</td>
                  <td className="border px-2 py-1.5">{p.chartNumber || ''}</td>
                  <td className="border px-2 py-1.5 font-medium">{p.name}</td>
                  <td className="border px-2 py-1.5 text-center">{p.ageSex}</td>
                  <td className="border px-2 py-1.5 text-xs">{p.diagnosis}</td>
                  <td className="border px-2 py-1.5 text-center text-xs">{p.startTime}~{p.endTime}</td>
                  <td className="border px-2 py-1.5 text-xs">{p.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ────── 생성 모달 ────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">고주파 치료 평가 추가</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-slate-100 rounded"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">환자이름 *</label>
                <input type="text" value={createForm.patientName} onChange={(e) => setCreateForm({ ...createForm, patientName: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" placeholder="홍길동" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">도자</label>
                <select value={createForm.probeType} onChange={(e) => setCreateForm({ ...createForm, probeType: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm">
                  <option value="">선택</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">출력 %</label>
                <input type="number" min={0} max={100} value={createForm.outputPercent} onChange={(e) => setCreateForm({ ...createForm, outputPercent: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">온도 ℃</label>
                <input type="number" step={0.1} value={createForm.temperature} onChange={(e) => setCreateForm({ ...createForm, temperature: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">처치시간 (분)</label>
                <input type="number" value={createForm.treatmentTime} onChange={(e) => setCreateForm({ ...createForm, treatmentTime: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">담당의</label>
                <select value={createForm.doctorCode} onChange={(e) => setCreateForm({ ...createForm, doctorCode: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm">
                  <option value="C">최원장</option>
                  <option value="J">전원장</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">기계번호</label>
                <input type="text" value={createForm.roomNumber} onChange={(e) => setCreateForm({ ...createForm, roomNumber: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">수액처치</label>
                <input type="text" value={createForm.ivTreatment} onChange={(e) => setCreateForm({ ...createForm, ivTreatment: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">특이사항</label>
                <textarea value={createForm.patientIssue} onChange={(e) => setCreateForm({ ...createForm, patientIssue: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg text-sm">취소</button>
              <button onClick={handleCreate} disabled={!createForm.patientName}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
