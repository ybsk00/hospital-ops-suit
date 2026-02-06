'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  BedDouble,
  RefreshCw,
  User,
  Plus,
  Trash2,
  Building2,
  DoorOpen,
  X,
  Settings,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  emrPatientId: string;
  sex: string;
  dob: string;
}

interface Admission {
  id: string;
  status: string;
  admitDate: string;
  plannedDischargeDate: string | null;
  patient: Patient;
}

interface Bed {
  id: string;
  label: string;
  status: string;
  version: number;
  currentAdmission: Admission | null;
}

interface Room {
  id: string;
  name: string;
  capacity: number;
  beds: Bed[];
}

interface Ward {
  id: string;
  name: string;
  floor: number | null;
  rooms: Room[];
}

interface Stats {
  total: number;
  empty: number;
  occupied: number;
  reserved: number;
  cleaning: number;
  isolation: number;
  outOfOrder: number;
}

const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  EMPTY: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300' },
  OCCUPIED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
  RESERVED: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-300' },
  CLEANING: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
  ISOLATION: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300' },
  OUT_OF_ORDER: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-300' },
};

const statusLabels: Record<string, string> = {
  EMPTY: '빈 베드',
  OCCUPIED: '사용중',
  RESERVED: '예약',
  CLEANING: '청소 중',
  ISOLATION: '격리',
  OUT_OF_ORDER: '사용불가',
};

export default function BedsPage() {
  const { accessToken } = useAuthStore();
  const [wards, setWards] = useState<Ward[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBed, setSelectedBed] = useState<Bed | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // 관리 모드
  const [showManagement, setShowManagement] = useState(false);
  const [createMode, setCreateMode] = useState<'ward' | 'room' | 'bed' | null>(null);

  // 생성 폼
  const [newWardName, setNewWardName] = useState('');
  const [newWardFloor, setNewWardFloor] = useState<number | ''>('');
  const [selectedWardId, setSelectedWardId] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomCapacity, setNewRoomCapacity] = useState(1);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [newBedLabels, setNewBedLabels] = useState('');

  // 삭제 확인
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'ward' | 'room' | 'bed'; id: string; name: string } | null>(null);

  const fetchBeds = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api<{ wards: Ward[]; stats: Stats }>(`/api/beds${query}`, {
        token: accessToken,
      });
      setWards(res.data!.wards);
      setStats(res.data!.stats);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter]);

  useEffect(() => {
    fetchBeds();
  }, [fetchBeds]);

  async function handleStatusChange(bed: Bed, newStatus: string) {
    if (!accessToken) return;
    try {
      await api(`/api/beds/${bed.id}/status`, {
        method: 'PATCH',
        body: { status: newStatus, version: bed.version },
        token: accessToken,
      });
      await fetchBeds();
      setSelectedBed(null);
    } catch (err: any) {
      alert(err.message || '상태 변경에 실패했습니다.');
    }
  }

  // 병동 생성
  async function handleCreateWard() {
    if (!accessToken || !newWardName.trim()) return;
    try {
      await api('/api/beds/wards', {
        method: 'POST',
        body: {
          name: newWardName.trim(),
          floor: newWardFloor || undefined,
        },
        token: accessToken,
      });
      setNewWardName('');
      setNewWardFloor('');
      setCreateMode(null);
      await fetchBeds();
    } catch (err: any) {
      alert(err.message || '병동 생성에 실패했습니다.');
    }
  }

  // 병실 생성
  async function handleCreateRoom() {
    if (!accessToken || !selectedWardId || !newRoomName.trim()) return;
    try {
      await api('/api/beds/rooms', {
        method: 'POST',
        body: {
          wardId: selectedWardId,
          name: newRoomName.trim(),
          capacity: newRoomCapacity,
        },
        token: accessToken,
      });
      setNewRoomName('');
      setNewRoomCapacity(1);
      setCreateMode(null);
      await fetchBeds();
    } catch (err: any) {
      alert(err.message || '병실 생성에 실패했습니다.');
    }
  }

  // 베드 생성
  async function handleCreateBeds() {
    if (!accessToken || !selectedRoomId || !newBedLabels.trim()) return;
    const labels = newBedLabels.split(',').map(l => l.trim()).filter(Boolean);
    if (labels.length === 0) return;

    try {
      await api('/api/beds', {
        method: 'POST',
        body: {
          roomId: selectedRoomId,
          labels,
        },
        token: accessToken,
      });
      setNewBedLabels('');
      setCreateMode(null);
      await fetchBeds();
    } catch (err: any) {
      alert(err.message || '베드 생성에 실패했습니다.');
    }
  }

  // 삭제 핸들러
  async function handleDelete() {
    if (!accessToken || !deleteConfirm) return;
    const { type, id } = deleteConfirm;
    try {
      let endpoint = '';
      if (type === 'ward') endpoint = `/api/beds/wards/${id}`;
      else if (type === 'room') endpoint = `/api/beds/rooms/${id}`;
      else endpoint = `/api/beds/${id}`;

      await api(endpoint, {
        method: 'DELETE',
        token: accessToken,
      });
      setDeleteConfirm(null);
      await fetchBeds();
    } catch (err: any) {
      alert(err.message || '삭제에 실패했습니다.');
    }
  }

  // 전체 병실 목록 (선택용)
  const allRooms = wards.flatMap(w => w.rooms.map(r => ({
    ...r,
    wardName: w.name,
    wardId: w.id,
  })));

  const simpleStats = stats ? {
    total: stats.total,
    reserved: stats.reserved,
    occupied: stats.occupied,
    available: stats.empty,
  } : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">베드 관리</h1>
          <p className="text-slate-500 mt-1">병동별 베드 현황을 확인하고 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManagement(!showManagement)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition text-sm font-medium ${
              showManagement
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Settings size={16} />
            관리
          </button>
          <button
            onClick={fetchBeds}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
          >
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>
      </div>

      {/* Management Panel */}
      {showManagement && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-blue-900">베드 생성/관리</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCreateMode('ward')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                <Plus size={14} />
                병동 추가
              </button>
              <button
                onClick={() => setCreateMode('room')}
                disabled={wards.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
                병실 추가
              </button>
              <button
                onClick={() => setCreateMode('bed')}
                disabled={allRooms.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
                베드 추가
              </button>
            </div>
          </div>

          {/* 현재 구조 요약 */}
          <div className="text-sm text-blue-800">
            현재: {wards.length}개 병동, {allRooms.length}개 병실, {stats?.total || 0}개 베드
          </div>
        </div>
      )}

      {/* Stats */}
      {simpleStats && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { key: 'total', label: '전체', value: simpleStats.total, color: 'bg-slate-600' },
            { key: 'available', label: '빈 베드', value: simpleStats.available, color: 'bg-green-500' },
            { key: 'occupied', label: '사용중', value: simpleStats.occupied, color: 'bg-blue-500' },
            { key: 'reserved', label: '예약', value: simpleStats.reserved, color: 'bg-yellow-500' },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key === 'total' ? '' : s.key === 'available' ? 'EMPTY' : s.key.toUpperCase())}
              className={`p-3 rounded-xl border text-center transition ${
                (statusFilter === '' && s.key === 'total') ||
                (statusFilter === 'EMPTY' && s.key === 'available') ||
                statusFilter === s.key.toUpperCase()
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className={`w-3 h-3 ${s.color} rounded-full mx-auto mb-2`} />
              <div className="text-lg font-bold text-slate-900">{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-slate-400">로딩 중...</div>
      )}

      {/* Ward Grid */}
      {!loading && wards.map((ward) => (
        <div key={ward.id} className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Building2 size={20} className="text-slate-400" />
              {ward.name} {ward.floor && `(${ward.floor}층)`}
            </h2>
            {showManagement && (
              <button
                onClick={() => setDeleteConfirm({ type: 'ward', id: ward.id, name: ward.name })}
                className="text-red-500 hover:text-red-700 p-1"
                title="병동 삭제"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {ward.rooms.map((room) => (
              <div key={room.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-slate-600 flex items-center gap-1.5">
                    <DoorOpen size={14} />
                    {room.name} ({room.capacity}인실)
                  </div>
                  {showManagement && (
                    <button
                      onClick={() => setDeleteConfirm({ type: 'room', id: room.id, name: `${ward.name} - ${room.name}` })}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="병실 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {room.beds.map((bed) => {
                    const colors = statusColors[bed.status] || statusColors.EMPTY;
                    return (
                      <div
                        key={bed.id}
                        className={`p-3 rounded-lg border ${colors.bg} ${colors.border} ${colors.text} text-left transition relative group`}
                      >
                        <button
                          onClick={() => setSelectedBed(bed)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold">{bed.label}</span>
                          </div>
                          <div className="text-xs mb-1">{statusLabels[bed.status]}</div>
                          {bed.currentAdmission && (
                            <div className="flex items-center gap-1 mt-1">
                              <User size={10} />
                              <span className="text-xs font-medium truncate">
                                {bed.currentAdmission.patient.name}
                              </span>
                            </div>
                          )}
                        </button>
                        {showManagement && bed.status !== 'OCCUPIED' && (
                          <button
                            onClick={() => setDeleteConfirm({ type: 'bed', id: bed.id, name: `${room.name} - ${bed.label}` })}
                            className="absolute top-1 right-1 text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 transition"
                            title="베드 삭제"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Empty State */}
      {!loading && wards.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <BedDouble size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500 mb-4">베드 데이터가 없습니다.</p>
          {showManagement && (
            <button
              onClick={() => setCreateMode('ward')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              첫 병동 만들기
            </button>
          )}
        </div>
      )}

      {/* Bed Detail Modal */}
      {selectedBed && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40" onClick={() => setSelectedBed(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">베드 상세</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">베드</span>
                <span className="font-medium">{selectedBed.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">상태</span>
                <span className={`font-medium ${statusColors[selectedBed.status]?.text}`}>
                  {statusLabels[selectedBed.status]}
                </span>
              </div>
              {selectedBed.currentAdmission && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">환자</span>
                    <span className="font-medium">{selectedBed.currentAdmission.patient.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">EMR ID</span>
                    <span>{selectedBed.currentAdmission.patient.emrPatientId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">입원일</span>
                    <span>{new Date(selectedBed.currentAdmission.admitDate).toLocaleDateString('ko-KR')}</span>
                  </div>
                </>
              )}
            </div>

            {/* Status Change */}
            {selectedBed.status !== 'OCCUPIED' && (
              <div className="mt-6">
                <div className="text-xs text-slate-500 mb-2">상태 변경</div>
                <div className="flex flex-wrap gap-2">
                  {['RESERVED', 'OUT_OF_ORDER', 'EMPTY'].filter(s => s !== selectedBed.status).map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(selectedBed, s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statusColors[s]?.bg} ${statusColors[s]?.border} ${statusColors[s]?.text} hover:shadow-sm transition`}
                    >
                      {statusLabels[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setSelectedBed(null)}
              className="mt-4 w-full py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm transition"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Create Ward Modal */}
      {createMode === 'ward' && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40" onClick={() => setCreateMode(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">병동 생성</h3>
              <button onClick={() => setCreateMode(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">병동명 *</label>
                <input
                  type="text"
                  value={newWardName}
                  onChange={(e) => setNewWardName(e.target.value)}
                  placeholder="예: 9층 입원실"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">층수</label>
                <input
                  type="number"
                  value={newWardFloor}
                  onChange={(e) => setNewWardFloor(e.target.value ? parseInt(e.target.value) : '')}
                  placeholder="예: 9"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <button
                onClick={handleCreateWard}
                disabled={!newWardName.trim()}
                className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Room Modal */}
      {createMode === 'room' && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40" onClick={() => setCreateMode(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">병실 생성</h3>
              <button onClick={() => setCreateMode(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">병동 선택 *</label>
                <select
                  value={selectedWardId}
                  onChange={(e) => setSelectedWardId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">병동 선택...</option>
                  {wards.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">병실명 *</label>
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="예: 901호"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">정원 (인실)</label>
                <select
                  value={newRoomCapacity}
                  onChange={(e) => setNewRoomCapacity(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value={1}>1인실</option>
                  <option value={2}>2인실</option>
                  <option value={3}>3인실</option>
                  <option value={4}>4인실</option>
                  <option value={5}>5인실</option>
                  <option value={6}>6인실</option>
                </select>
              </div>
              <button
                onClick={handleCreateRoom}
                disabled={!selectedWardId || !newRoomName.trim()}
                className="w-full py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Bed Modal */}
      {createMode === 'bed' && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40" onClick={() => setCreateMode(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">베드 생성</h3>
              <button onClick={() => setCreateMode(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">병실 선택 *</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">병실 선택...</option>
                  {allRooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.wardName} - {r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">베드 라벨 *</label>
                <input
                  type="text"
                  value={newBedLabels}
                  onChange={(e) => setNewBedLabels(e.target.value)}
                  placeholder="예: A, B, C 또는 1, 2, 3 (쉼표로 구분)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">여러 베드를 쉼표(,)로 구분하여 한번에 생성할 수 있습니다.</p>
              </div>
              <button
                onClick={handleCreateBeds}
                disabled={!selectedRoomId || !newBedLabels.trim()}
                className="w-full py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2 text-red-600">삭제 확인</h3>
            <p className="text-sm text-slate-600 mb-4">
              <span className="font-medium">{deleteConfirm.name}</span>을(를) 삭제하시겠습니까?
              {deleteConfirm.type === 'ward' && ' (포함된 모든 병실과 베드가 함께 삭제됩니다)'}
              {deleteConfirm.type === 'room' && ' (포함된 모든 베드가 함께 삭제됩니다)'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition"
              >
                취소
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg text-sm font-medium transition"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
