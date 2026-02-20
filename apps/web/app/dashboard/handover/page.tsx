'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import { ChevronLeft, ChevronRight, Calendar, Save, Plus, Search } from 'lucide-react';

type TabType = 'room' | 'doctor' | 'discharged';

interface HandoverPatient {
  patientId: string;
  patientName: string;
  emrPatientId: string | null;
  roomNumber: string | null;
  bedName: string | null;
  sex: string | null;
  age: number | null;
  doctorCode: string | null;
  admissionStatus: string | null;
  admitDate: string | null;
  diagnosis: string | null;
  clinicalInfo: {
    referralHospital?: string;
    chemoPort?: string;
    metastasis?: string;
    bloodDrawSchedule?: string;
    guardianInfo?: string;
  } | null;
  handover: {
    id: string;
    bloodDraw: boolean;
    bloodDrawNote: string | null;
    chemoNote: string | null;
    externalVisit: string | null;
    outing: string | null;
    returnTime: string | null;
    content: string | null;
  } | null;
  todayTreatments: Array<{ type: string; time: string }>;
}

interface SummaryData {
  currentCount: number;
  admitCount: number;
  dischargeCount: number;
  readmitCount: number;
}

interface DischargedPatient {
  id: string;
  name: string;
  emrPatientId: string | null;
  dischargeDate: string;
  roomName: string | null;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HandoverPage() {
  const { accessToken } = useAuthStore();
  const [tab, setTab] = useState<TabType>('room');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [loading, setLoading] = useState(false);

  // Data
  const [patients, setPatients] = useState<HandoverPatient[]>([]);
  const [summary, setSummary] = useState<SummaryData>({ currentCount: 0, admitCount: 0, dischargeCount: 0, readmitCount: 0 });
  const [doctors, setDoctors] = useState<string[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [discharged, setDischarged] = useState<DischargedPatient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api(`/api/handover/summary?date=${date}`, { token: accessToken || undefined });
      if (res.success) setSummary(res.data);
    } catch { /* ignore */ }
  }, [date, accessToken]);

  const fetchDaily = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/handover/daily?date=${date}`, { token: accessToken || undefined });
      if (res.success) setPatients(res.data.patients || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [date, accessToken]);

  const fetchByDoctor = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedDoctor ? `&doctor=${selectedDoctor}` : '';
      const res = await api(`/api/handover/by-doctor?date=${date}${q}`, { token: accessToken || undefined });
      if (res.success) {
        setPatients(res.data.patients || []);
        setDoctors(res.data.doctors || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [date, selectedDoctor, accessToken]);

  const fetchDischarged = useCallback(async () => {
    setLoading(true);
    try {
      const q = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';
      const res = await api(`/api/handover/discharged${q}`, { token: accessToken || undefined });
      if (res.success) setDischarged(res.data.patients || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [searchTerm, accessToken]);

  useEffect(() => {
    fetchSummary();
    if (tab === 'room') fetchDaily();
    else if (tab === 'doctor') fetchByDoctor();
    else fetchDischarged();
  }, [tab, fetchSummary, fetchDaily, fetchByDoctor, fetchDischarged]);

  const navigateDate = (delta: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(toDateStr(d));
  };

  const dayLabel = (() => {
    const d = new Date(date + 'T00:00:00');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `(${days[d.getDay()]})`;
  })();

  const saveHandover = async (patientId: string, content: string) => {
    setSaving(true);
    try {
      await api('/api/handover/entry', { method: 'POST', body: { patientId, date, content }, token: accessToken || undefined });
      setEditingId(null);
      if (tab === 'room') fetchDaily();
      else fetchByDoctor();
    } catch { /* ignore */ }
    setSaving(false);
  };

  // Group patients by room
  const groupedByRoom = patients.reduce<Record<string, HandoverPatient[]>>((acc, p) => {
    const room = p.roomNumber || '미배정';
    if (!acc[room]) acc[room] = [];
    acc[room].push(p);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">서울온케어 인계장</h1>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['room', 'doctor', 'discharged'] as TabType[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                tab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'room' ? '병실별' : t === 'doctor' ? '의사별' : '퇴원자'}
            </button>
          ))}
        </div>
      </div>

      {/* 서브헤더 - 요약 */}
      <div className="flex items-center gap-6 mb-4 bg-slate-50 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigateDate(-1)} className="p-1 rounded hover:bg-slate-200"><ChevronLeft size={18} /></button>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-slate-400" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
            <span className="text-sm text-slate-500">{dayLabel}</span>
          </div>
          <button onClick={() => navigateDate(1)} className="p-1 rounded hover:bg-slate-200"><ChevronRight size={18} /></button>
          <button onClick={() => setDate(toDateStr(new Date()))} className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">오늘</button>
        </div>
        <div className="flex items-center gap-4 text-sm ml-auto">
          <span>재원 <strong className="text-blue-600">{summary.currentCount}</strong></span>
          <span>입원 <strong className="text-green-600">{summary.admitCount}</strong></span>
          <span>퇴원 <strong className="text-red-500">{summary.dischargeCount}</strong></span>
          <span>재입 <strong className="text-orange-500">{summary.readmitCount}</strong></span>
          <span className="font-semibold">Total {summary.currentCount + summary.admitCount}</span>
        </div>
      </div>

      {/* 의사별 필터 */}
      {tab === 'doctor' && doctors.length > 0 && (
        <div className="flex gap-2 mb-4">
          <button onClick={() => setSelectedDoctor('')}
            className={`px-3 py-1.5 rounded text-sm ${!selectedDoctor ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            전체
          </button>
          {doctors.map((d) => (
            <button key={d} onClick={() => setSelectedDoctor(d)}
              className={`px-3 py-1.5 rounded text-sm ${selectedDoctor === d ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {d}
            </button>
          ))}
        </div>
      )}

      {/* 퇴원자 검색 */}
      {tab === 'discharged' && (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="환자이름 검색"
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
            />
          </div>
        </div>
      )}

      {loading && <div className="text-center py-8 text-slate-400">불러오는 중...</div>}

      {/* ────── 병실별/의사별 뷰 ────── */}
      {(tab === 'room' || tab === 'doctor') && !loading && (
        <div className="space-y-4">
          {Object.keys(groupedByRoom).length === 0 && (
            <div className="text-center py-12 text-slate-400">인계 데이터가 없습니다.</div>
          )}
          {Object.entries(groupedByRoom).sort(([a], [b]) => a.localeCompare(b)).map(([room, pts]) => (
            <div key={room} className="border rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b font-semibold text-sm">
                {room} <span className="text-slate-400 font-normal">({pts.length}명)</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/50">
                    <th className="px-3 py-2 text-left w-20">환자</th>
                    <th className="px-3 py-2 text-left w-16">나이/성별</th>
                    <th className="px-3 py-2 text-left w-24">진단</th>
                    <th className="px-3 py-2 text-left w-16">채혈</th>
                    <th className="px-3 py-2 text-left w-24">오늘치료</th>
                    <th className="px-3 py-2 text-left">인계사항</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {pts.map((p) => (
                    <tr key={p.patientId} className="border-b hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.patientName}</div>
                        {p.emrPatientId && <div className="text-xs text-slate-400">{p.emrPatientId}</div>}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {p.age != null ? `${p.age}/${p.sex || ''}` : '-'}
                      </td>
                      <td className="px-3 py-2 text-xs">{p.diagnosis || '-'}</td>
                      <td className="px-3 py-2">
                        {p.handover?.bloodDraw ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-xs font-medium">
                            채혈 {p.handover.bloodDrawNote || ''}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        {p.todayTreatments.length > 0 ? (
                          <div className="space-y-0.5">
                            {p.todayTreatments.map((t, i) => (
                              <span key={i} className="inline-block mr-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                                {t.type} {t.time}
                              </span>
                            ))}
                          </div>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        {editingId === p.patientId ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="flex-1 border rounded px-2 py-1 text-sm"
                              placeholder="인계사항 입력..."
                              autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') saveHandover(p.patientId, editContent); }}
                            />
                            <button onClick={() => saveHandover(p.patientId, editContent)} disabled={saving}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Save size={16} /></button>
                          </div>
                        ) : (
                          <div className="text-slate-600 cursor-pointer hover:text-blue-600"
                            onClick={() => { setEditingId(p.patientId); setEditContent(p.handover?.content || ''); }}>
                            {p.handover?.content || <span className="text-slate-300 italic">클릭하여 입력</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editingId !== p.patientId && (
                          <button onClick={() => { setEditingId(p.patientId); setEditContent(p.handover?.content || ''); }}
                            className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50">
                            <Plus size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ────── 퇴원자 뷰 ────── */}
      {tab === 'discharged' && !loading && (
        <div className="border rounded-lg overflow-hidden">
          {discharged.length === 0 ? (
            <div className="text-center py-12 text-slate-400">퇴원자 데이터가 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="px-4 py-2 text-left">이름</th>
                  <th className="px-4 py-2 text-left">차트번호</th>
                  <th className="px-4 py-2 text-left">병실</th>
                  <th className="px-4 py-2 text-left">퇴원일</th>
                </tr>
              </thead>
              <tbody>
                {discharged.map((p) => (
                  <tr key={p.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2 text-slate-500">{p.emrPatientId || '-'}</td>
                    <td className="px-4 py-2">{p.roomName || '-'}</td>
                    <td className="px-4 py-2 text-slate-500">{p.dischargeDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
