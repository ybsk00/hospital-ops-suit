'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../stores/auth';
import { api } from '../../../lib/api';
import {
  Inbox,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  FlaskConical,
  FileText,
  GitCompare,
  Flag,
  ServerCrash,
  Clock,
  CheckCircle,
  Eye,
} from 'lucide-react';

interface InboxItem {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  entityType: string | null;
  entityId: string | null;
  priority: number;
  comment: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const statusLabels: Record<string, string> = {
  UNREAD: '미확인',
  IN_REVIEW: '검토중',
  RESOLVED: '처리완료',
};

const statusColors: Record<string, string> = {
  UNREAD: 'bg-red-100 text-red-700',
  IN_REVIEW: 'bg-yellow-100 text-yellow-700',
  RESOLVED: 'bg-green-100 text-green-700',
};

const typeLabels: Record<string, string> = {
  RED_ALERT: 'RED 알림',
  ORANGE_ALERT: 'ORANGE 알림',
  LAB_ABNORMAL: '비정상 검사',
  REPORT_PENDING: '의견서 대기',
  SYNC_CONFLICT: '동기화 충돌',
  MANUAL_FLAG: '수동 플래그',
  BATCH_FAILURE: '배치 오류',
};

const typeIconColors: Record<string, string> = {
  RED_ALERT: 'text-red-500 bg-red-50',
  ORANGE_ALERT: 'text-orange-500 bg-orange-50',
  LAB_ABNORMAL: 'text-purple-500 bg-purple-50',
  REPORT_PENDING: 'text-blue-500 bg-blue-50',
  SYNC_CONFLICT: 'text-yellow-600 bg-yellow-50',
  MANUAL_FLAG: 'text-teal-500 bg-teal-50',
  BATCH_FAILURE: 'text-slate-600 bg-slate-100',
};

function TypeIcon({ type }: { type: string }) {
  const size = 18;
  switch (type) {
    case 'RED_ALERT':
      return <AlertCircle size={size} />;
    case 'ORANGE_ALERT':
      return <AlertTriangle size={size} />;
    case 'LAB_ABNORMAL':
      return <FlaskConical size={size} />;
    case 'REPORT_PENDING':
      return <FileText size={size} />;
    case 'SYNC_CONFLICT':
      return <GitCompare size={size} />;
    case 'MANUAL_FLAG':
      return <Flag size={size} />;
    case 'BATCH_FAILURE':
      return <ServerCrash size={size} />;
    default:
      return <AlertCircle size={size} />;
  }
}

const typeFilterOptions = [
  { value: '', label: '전체' },
  { value: 'RED_ALERT', label: 'RED 알림' },
  { value: 'ORANGE_ALERT', label: 'ORANGE 알림' },
  { value: 'LAB_ABNORMAL', label: '비정상 검사결과' },
  { value: 'REPORT_PENDING', label: '의견서 승인대기' },
  { value: 'SYNC_CONFLICT', label: '동기화 충돌' },
  { value: 'MANUAL_FLAG', label: '수동 플래그' },
  { value: 'BATCH_FAILURE', label: '배치 오류' },
];

const statusFilterOptions = [
  { value: '', label: '전체' },
  { value: 'UNREAD', label: '미확인' },
  { value: 'IN_REVIEW', label: '검토중' },
  { value: 'RESOLVED', label: '처리완료' },
];

export default function InboxPage() {
  const { accessToken } = useAuthStore();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchItems = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const query = params.toString() ? `?${params}` : '';

      const res = await api<{ items: InboxItem[]; total: number }>(`/api/inbox${query}`, {
        token: accessToken,
      });
      setItems(res.data?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, typeFilter, statusFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function handleStatusChange(item: InboxItem, newStatus: string) {
    if (!accessToken) return;
    try {
      await api(`/api/inbox/${item.id}/status`, {
        method: 'PATCH',
        body: { status: newStatus },
        token: accessToken,
      });
      await fetchItems();
    } catch (err: any) {
      alert(err.message || '상태 변경에 실패했습니다.');
    }
  }

  const unreadCount = items.filter((i) => i.status === 'UNREAD').length;
  const inReviewCount = items.filter((i) => i.status === 'IN_REVIEW').length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">업무함</h1>
          <p className="text-slate-500 mt-1">업무 알림과 미처리 항목을 확인합니다.</p>
        </div>
        <button
          onClick={fetchItems}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition text-sm"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        >
          {typeFilterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
        >
          {statusFilterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-4 mb-4 px-4 py-3 bg-white rounded-xl border border-slate-200 text-sm">
        <span className="text-slate-600">
          총 <span className="font-bold text-slate-900">{items.length}</span>건
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-red-600">
          미확인 <span className="font-bold">{unreadCount}</span>건
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-yellow-600">
          검토중 <span className="font-bold">{inReviewCount}</span>건
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-slate-400">로딩 중...</div>
      )}

      {/* Item List */}
      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => {
            const iconColor = typeIconColors[item.type] || 'text-slate-500 bg-slate-100';
            return (
              <div
                key={item.id}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200 hover:shadow-sm transition"
              >
                {/* Left: Type Icon */}
                <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${iconColor}`}>
                  <TypeIcon type={item.type} />
                </div>

                {/* Center: Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-slate-400">
                      {typeLabels[item.type] || item.type}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900 truncate">{item.title}</div>
                  {item.summary && (
                    <div className="text-xs text-slate-500 truncate mt-0.5">{item.summary}</div>
                  )}
                  <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                    <Clock size={12} />
                    {new Date(item.createdAt).toLocaleString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>

                {/* Right: Badges & Actions */}
                <div className="flex-shrink-0 flex items-center gap-2">
                  {item.priority >= 8 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      긴급
                    </span>
                  )}
                  {item.priority >= 5 && item.priority < 8 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                      높음
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[item.status] || 'bg-slate-100 text-slate-600'}`}>
                    {statusLabels[item.status] || item.status}
                  </span>

                  {item.status === 'UNREAD' && (
                    <button
                      onClick={() => handleStatusChange(item, 'IN_REVIEW')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition"
                    >
                      <Eye size={12} />
                      검토 시작
                    </button>
                  )}
                  {item.status === 'IN_REVIEW' && (
                    <button
                      onClick={() => handleStatusChange(item, 'RESOLVED')}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 transition"
                    >
                      <CheckCircle size={12} />
                      처리 완료
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && items.length === 0 && (
        <div className="text-center py-12">
          <Inbox size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">업무함에 항목이 없습니다.</p>
        </div>
      )}
    </div>
  );
}
