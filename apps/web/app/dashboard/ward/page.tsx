'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, ChevronLeft, ChevronRight, Users, Bed,
  CalendarCheck, AlertCircle, Filter, LayoutGrid, Link2
} from 'lucide-react';
import { api } from '../../../lib/api';

// ── 타입 ──────────────────────────────────────────────────────────
type WardType = 'SINGLE' | 'DOUBLE' | 'QUAD';
type BedPos = 'SINGLE' | 'DOOR' | 'MIDDLE' | 'INNER_LEFT' | 'INNER_RIGHT' | 'INNER' | 'WINDOW';
type WardAdmissionStatus = 'ADMITTED' | 'PLANNED' | 'WAITING' | 'DISCHARGED' | 'CANCELLED';
type WardSheetRegion = 'CURRENT' | 'PLANNED' | 'SIDE_MEMO';

interface WardAdmission {
  id: string;
  patientId: string | null;
  patient: { id: string; name: string; emrPatientId: string | null; phone: string | null } | null;
  patientNameRaw: string | null;
  diagnosis: string | null;
  admitDate: string | null;
  dischargeDate: string | null;
  dischargeTime: string | null;
  status: WardAdmissionStatus;
  isPlanned: boolean;
  memoRaw: string | null;
  note: string | null;
  sheetTab: string;
  sheetA1: string;
  sheetRegion: WardSheetRegion;
  sheetLineIndex: number;
  sheetSyncedAt: string | null;
  isManualOverride: boolean;
}

interface WardBed {
  id: string;
  bedKey: string;
  wardType: WardType;
  roomNumber: string;
  bedPosition: BedPos;
  name: string | null;
  isActive: boolean;
  admissions: WardAdmission[];
}

interface WardStatusData {
  beds: WardBed[];
  summary: {
    totalBeds: number;
    occupiedCount: number;
    plannedCount: number;
    emptyCount: number;
  };
}

// ── 병상 상태 판별 ─────────────────────────────────────────────────
function getBedColorClass(admissions: WardAdmission[]): string {
  const today = new Date();
  const active = admissions.filter(a => a.status === 'ADMITTED');
  const planned = admissions.filter(a => a.status === 'PLANNED');

  if (active.length > 0) {
    const discharge = active[0].dischargeDate ? new Date(active[0].dischargeDate) : null;
    if (discharge) {
      const daysLeft = Math.ceil((discharge.getTime() - today.getTime()) / (1000 * 86400));
      if (daysLeft <= 3) return 'bg-yellow-50 border-yellow-200';
    }
    return 'bg-blue-50 border-blue-200';
  }
  if (planned.length > 0) return 'bg-green-50 border-green-200';
  return 'bg-white border-gray-200';
}

function getStatusDot(admissions: WardAdmission[]): string {
  const active = admissions.filter(a => a.status === 'ADMITTED');
  const planned = admissions.filter(a => a.status === 'PLANNED');
  if (active.length > 0) {
    const today = new Date();
    const discharge = active[0].dischargeDate ? new Date(active[0].dischargeDate) : null;
    if (discharge) {
      const daysLeft = Math.ceil((discharge.getTime() - today.getTime()) / (1000 * 86400));
      if (daysLeft <= 3) return '🟡';
    }
    return '🔵';
  }
  if (planned.length > 0) return '🟢';
  return '⬜';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function getDaysLeft(dateStr: string | null): string {
  if (!dateStr) return '';
  const discharge = new Date(dateStr);
  const today = new Date();
  const daysLeft = Math.ceil((discharge.getTime() - today.getTime()) / (1000 * 86400));
  if (daysLeft < 0) return '';
  return `D-${daysLeft}`;
}

// ── BedCard (단일 병상) ────────────────────────────────────────────
function BedCard({
  bed,
  onClick,
}: {
  bed: WardBed;
  onClick: (bed: WardBed) => void;
}) {
  const colorClass = getBedColorClass(bed.admissions);
  const dot = getStatusDot(bed.admissions);
  const admitted = bed.admissions.filter(a => a.status === 'ADMITTED');
  const planned = bed.admissions.filter(a => a.status === 'PLANNED');
  const primaryAdmission = admitted[0] ?? planned[0];
  const daysLeft = getDaysLeft(admitted[0]?.dischargeDate ?? null);

  return (
    <div
      className={`border rounded-lg p-2.5 cursor-pointer hover:shadow-md transition-shadow ${colorClass}`}
      onClick={() => onClick(bed)}
    >
      {/* 병실 번호 */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-gray-700">{bed.roomNumber}</span>
        <span className="text-xs">{dot}</span>
      </div>
      {bed.name && <div className="text-xs text-gray-500 mb-1 truncate">{bed.name}</div>}

      {/* 현재 입원 환자 */}
      {primaryAdmission && (
        <div className="mt-1">
          <div className="text-xs font-medium text-gray-800 truncate">
            {primaryAdmission.patient?.name ?? primaryAdmission.patientNameRaw ?? '-'}
            {!primaryAdmission.patientId && (
              <span className="ml-1 text-orange-400 text-xs" title="환자 미매칭">⚠</span>
            )}
          </div>
          {primaryAdmission.diagnosis && (
            <div className="text-xs text-gray-500 truncate">{primaryAdmission.diagnosis}</div>
          )}
          <div className="text-xs text-gray-400 mt-0.5">
            {primaryAdmission.admitDate && `${formatDate(primaryAdmission.admitDate)}~`}
            {primaryAdmission.dischargeDate && formatDate(primaryAdmission.dischargeDate)}
            {daysLeft && <span className="ml-1 text-yellow-600 font-medium">[{daysLeft}]</span>}
          </div>
        </div>
      )}

      {/* 추가 예정 */}
      {planned.length > 0 && primaryAdmission?.status !== 'PLANNED' && (
        <div className="mt-1 pt-1 border-t border-green-200">
          <div className="text-xs text-green-700 truncate">
            🟢 {planned[0].patient?.name ?? planned[0].patientNameRaw}
            {planned[0].admitDate && ` ${formatDate(planned[0].admitDate)}~`}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BedDetailPanel ────────────────────────────────────────────────
function BedDetailPanel({
  bed,
  onClose,
  onMatchPatient,
}: {
  bed: WardBed | null;
  onClose: () => void;
  onMatchPatient: (admissionId: string, patientId: string) => void;
}) {
  if (!bed) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <div>
          <h3 className="font-bold text-gray-800">{bed.roomNumber}호</h3>
          {bed.name && <p className="text-sm text-gray-500">{bed.name}</p>}
          <p className="text-xs text-gray-400 mt-0.5">
            {bed.wardType === 'SINGLE' ? '1인실' : bed.wardType === 'DOUBLE' ? '2인실' : '4인실'}
            {bed.bedPosition !== 'SINGLE' && ` · ${bed.bedPosition}`}
          </p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg">✕</button>
      </div>

      {/* 입원 목록 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {bed.admissions.length === 0 ? (
          <div className="text-center text-gray-400 py-8">공실</div>
        ) : (
          bed.admissions.map((admission) => (
            <div key={admission.id} className="bg-gray-50 rounded-lg p-3 border">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  admission.status === 'ADMITTED' ? 'bg-blue-100 text-blue-700' :
                  admission.status === 'PLANNED' ? 'bg-green-100 text-green-700' :
                  admission.status === 'WAITING' ? 'bg-orange-100 text-orange-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {admission.status === 'ADMITTED' ? '입원 중' :
                   admission.status === 'PLANNED' ? '입원예정' :
                   admission.status === 'WAITING' ? '대기' : admission.status}
                </span>
                <span className="text-xs text-gray-400">
                  {admission.sheetRegion} · L{admission.sheetLineIndex}
                </span>
              </div>

              <div className="text-sm font-medium">
                {admission.patient?.name ?? admission.patientNameRaw ?? '-'}
                {!admission.patientId && (
                  <button
                    className="ml-2 text-xs text-blue-500 hover:underline"
                    onClick={() => {
                      const pid = prompt('환자 ID 입력');
                      if (pid) onMatchPatient(admission.id, pid);
                    }}
                  >
                    <Link2 size={12} className="inline" /> 매칭
                  </button>
                )}
              </div>
              {admission.diagnosis && <div className="text-xs text-gray-600">{admission.diagnosis}</div>}
              <div className="text-xs text-gray-400 mt-1">
                {admission.admitDate && `입원: ${formatDate(admission.admitDate)}`}
                {admission.dischargeDate && ` → 퇴원: ${formatDate(admission.dischargeDate)}`}
                {admission.dischargeTime && ` ${admission.dischargeTime}`}
              </div>
              {admission.note && (
                <div className="text-xs text-gray-500 mt-1 bg-white rounded p-1.5">{admission.note}</div>
              )}
              {admission.sheetSyncedAt && (
                <div className="text-xs text-gray-300 mt-1">
                  시트 동기화: {new Date(admission.sheetSyncedAt).toLocaleString('ko-KR')}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 하단 액션 */}
      <div className="p-4 border-t">
        <div className="text-xs text-gray-400">bedKey: {bed.bedKey}</div>
      </div>
    </div>
  );
}

// ── WardSection (1인실/2인실/4인실) ──────────────────────────────
function WardSection({
  wardType,
  beds,
  onBedClick,
}: {
  wardType: WardType;
  beds: WardBed[];
  onBedClick: (bed: WardBed) => void;
}) {
  const label = wardType === 'SINGLE' ? '1인실' : wardType === 'DOUBLE' ? '2인실' : '4인실';
  const occupied = beds.filter(b => b.admissions.some(a => a.status === 'ADMITTED')).length;

  if (beds.length === 0) return null;

  // 2인실·4인실은 방번호별 그룹핑
  if (wardType === 'SINGLE') {
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-bold text-gray-700">{label}</h3>
          <span className="text-xs text-gray-500">{beds.length}실 / 입원{occupied} / 공실{beds.length - occupied}</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {beds.map(bed => <BedCard key={bed.id} bed={bed} onClick={onBedClick} />)}
        </div>
      </div>
    );
  }

  // 방별 그룹핑
  const rooms = [...new Set(beds.map(b => b.roomNumber))].sort();
  const colCount = wardType === 'DOUBLE' ? 2 : 4;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-bold text-gray-700">{label}</h3>
        <span className="text-xs text-gray-500">{rooms.length}실</span>
      </div>
      <div className="space-y-3">
        {rooms.map(room => {
          const roomBeds = beds.filter(b => b.roomNumber === room);
          return (
            <div key={room} className="border rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-3 py-1.5">
                <span className="text-sm font-semibold text-gray-700">{room}호</span>
              </div>
              <div className={`grid grid-cols-${colCount} gap-2 p-2`}>
                {roomBeds.map(bed => <BedCard key={bed.id} bed={bed} onClick={onBedClick} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export default function WardPage() {
  const [data, setData] = useState<WardStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBed, setSelectedBed] = useState<WardBed | null>(null);
  const [filter, setFilter] = useState<WardType | 'ALL'>('ALL');
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [syncing, setSyncing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/ward/status?month=${currentMonth}`);
      if (res.success) setData(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api('/api/ward/sync', { method: 'POST', body: '{}' });
      if (res.success) {
        alert(`동기화 요청 완료 (${res.data?.mode === 'inline' ? '즉시 실행' : '큐 등록'})`);
        await fetchData();
      }
    } catch (e: any) {
      alert(`동기화 실패: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleMatchPatient = async (admissionId: string, patientId: string) => {
    try {
      const res = await api(`/api/ward/admissions/${admissionId}/match-patient`, {
        method: 'PATCH',
        body: JSON.stringify({ patientId }),
      });
      if (res.success) {
        fetchData();
        setSelectedBed(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const moveMonth = (delta: number) => {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const beds = data?.beds ?? [];
  const filtered = filter === 'ALL' ? beds : beds.filter(b => b.wardType === filter);

  const singleBeds = filtered.filter(b => b.wardType === 'SINGLE');
  const doubleBeds = filtered.filter(b => b.wardType === 'DOUBLE');
  const quadBeds   = filtered.filter(b => b.wardType === 'QUAD');

  return (
    <div className="p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">입원현황표</h1>
          <p className="text-sm text-gray-500">Google Sheets 연동 · 실시간 입원 현황</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 월 네비게이션 */}
          <button onClick={() => moveMonth(-1)} className="p-1.5 hover:bg-gray-100 rounded">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium w-20 text-center">{currentMonth}</span>
          <button onClick={() => moveMonth(1)} className="p-1.5 hover:bg-gray-100 rounded">
            <ChevronRight size={18} />
          </button>

          {/* 필터 */}
          <div className="flex gap-1 ml-2 border rounded-lg overflow-hidden">
            {(['ALL', 'SINGLE', 'DOUBLE', 'QUAD'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === f ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                {f === 'ALL' ? '전체' : f === 'SINGLE' ? '1인실' : f === 'DOUBLE' ? '2인실' : '4인실'}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? '동기화 중...' : '시트 동기화'}
            </button>
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              새로고침
            </button>
          </div>
        </div>
      </div>

      {/* 요약 카드 */}
      {data && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: '전체 병상', value: data.summary.totalBeds, icon: Bed, color: 'text-gray-700' },
            { label: '입원 중', value: data.summary.occupiedCount, icon: Users, color: 'text-blue-600' },
            { label: '입원예정', value: data.summary.plannedCount, icon: CalendarCheck, color: 'text-green-600' },
            { label: '공실', value: data.summary.emptyCount, icon: LayoutGrid, color: 'text-gray-400' },
          ].map(item => (
            <div key={item.label} className="bg-white border rounded-xl p-4 flex items-center gap-3">
              <item.icon size={20} className={item.color} />
              <div>
                <div className="text-2xl font-bold text-gray-800">{item.value}</div>
                <div className="text-xs text-gray-500">{item.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 병상 그리드 */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">
          <RefreshCw size={24} className="animate-spin mr-2" />
          로딩 중...
        </div>
      ) : beds.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <AlertCircle size={32} className="mx-auto mb-2" />
          <p>병상 데이터가 없습니다.</p>
          <p className="text-sm mt-1">Google Sheets 동기화 후 데이터가 표시됩니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-4">
          <WardSection wardType="SINGLE" beds={singleBeds} onBedClick={setSelectedBed} />
          <WardSection wardType="DOUBLE" beds={doubleBeds} onBedClick={setSelectedBed} />
          <WardSection wardType="QUAD"   beds={quadBeds}   onBedClick={setSelectedBed} />
        </div>
      )}

      {/* 상세 패널 */}
      {selectedBed && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedBed(null)}
          />
          <BedDetailPanel
            bed={selectedBed}
            onClose={() => setSelectedBed(null)}
            onMatchPatient={handleMatchPatient}
          />
        </>
      )}
    </div>
  );
}
