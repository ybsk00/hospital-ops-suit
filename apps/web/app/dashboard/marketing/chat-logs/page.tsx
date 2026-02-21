'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ScrollText,
  Calendar,
  Search,
  MessageSquare,
  User,
  Bot,
  ChevronLeft,
  ChevronRight,
  Target,
  AlertCircle,
  X,
  ExternalLink,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../stores/auth';

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  category: string | null;
  metadata: any;
  createdAt: string;
}

interface ChatSession {
  id: string;
  ipHash: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  firstQuery: string;
  lastQuery: string;
  categories: string[];
  hasBookingIntent: boolean;
  avgResponseTime: number | null;
}

interface SessionDetail {
  session: {
    id: string;
    ipHash: string | null;
    createdAt: string;
    updatedAt: string;
    messages: ChatMessage[];
  };
  analytics: Array<{
    id: string;
    query: string;
    category: string | null;
    responseTime: number | null;
    hadSources: boolean;
    isBooking: boolean;
    isFallback: boolean;
    createdAt: string;
  }>;
}

const categoryLabels: Record<string, string> = {
  CANCER: '암',
  NERVE: '자율신경',
  GENERAL: '일반',
  cancer: '암',
  nerve: '자율신경',
  general: '일반',
};

const categoryColors: Record<string, string> = {
  CANCER: 'bg-red-100 text-red-700',
  NERVE: 'bg-blue-100 text-blue-700',
  GENERAL: 'bg-gray-100 text-gray-700',
  cancer: 'bg-red-100 text-red-700',
  nerve: 'bg-blue-100 text-blue-700',
  general: 'bg-gray-100 text-gray-700',
};

export default function ChatLogsPage() {
  const { accessToken } = useAuthStore();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [bookingOnly, setBookingOnly] = useState(false);

  // 세션 상세
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const limit = 15;

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      let url = `/api/marketing/chat-logs?page=${page}&limit=${limit}&from=${from}`;
      if (category !== 'all') url += `&category=${category}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (bookingOnly) url += `&hasBooking=true`;

      const res = await api<{ sessions: ChatSession[]; total: number }>(url, {
        token: accessToken || undefined,
      });
      if (res.success && res.data) {
        setSessions(res.data.sessions);
        setTotal(res.data.total);
      }
    } catch (err) {
      console.error('Failed to load chat logs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, period, category, search, bookingOnly, accessToken]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadSessionDetail = async (sessionId: string) => {
    setDetailLoading(true);
    try {
      const res = await api<SessionDetail>(`/api/marketing/chat-logs/${sessionId}`, {
        token: accessToken || undefined,
      });
      if (res.success && res.data) {
        setSelectedSession(res.data);
      }
    } catch (err) {
      console.error('Failed to load session detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const totalPages = Math.ceil(total / limit);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <ScrollText className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">대화 로그</h1>
            <p className="text-sm text-gray-500">환자 챗봇 상담 내역 조회</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-gray-400" />
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as '7d' | '30d' | '90d');
              setPage(1);
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="7d">최근 7일</option>
            <option value="30d">최근 30일</option>
            <option value="90d">최근 90일</option>
          </select>
        </div>
      </div>

      {/* 필터바 */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-xl p-4">
        {/* 카테고리 */}
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">전체 카테고리</option>
          <option value="CANCER">암</option>
          <option value="NERVE">자율신경</option>
          <option value="GENERAL">일반</option>
        </select>

        {/* 검색 */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="대화 내용 검색..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition"
          >
            검색
          </button>
        </div>

        {/* 예약의사 필터 */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={bookingOnly}
            onChange={(e) => {
              setBookingOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          예약의사만
        </label>

        {/* 총 건수 */}
        <span className="text-sm text-gray-500 ml-auto">
          총 {total.toLocaleString()}건
        </span>
      </div>

      {/* 메인 영역 */}
      <div className="flex gap-6">
        {/* 세션 목록 */}
        <div className={`${selectedSession ? 'w-1/2' : 'w-full'} transition-all`}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">해당 조건의 대화 로그가 없습니다</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">시간</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">첫 질문</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">메시지</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">카테고리</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">예약</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      onClick={() => loadSessionDetail(session.id)}
                      className={`cursor-pointer hover:bg-indigo-50 transition ${
                        selectedSession?.session.id === session.id ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {formatDate(session.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 max-w-[300px] truncate">
                        {session.firstQuery || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">
                          <MessageSquare size={12} />
                          {session.messageCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          {session.categories.length > 0 ? (
                            session.categories.slice(0, 2).map((cat) => (
                              <span
                                key={cat}
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  categoryColors[cat || ''] || 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {categoryLabels[cat || ''] || cat}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {session.hasBookingIntent && (
                          <Target size={16} className="inline text-emerald-500" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
                  <span className="text-sm text-gray-500">
                    {(page - 1) * limit + 1}-{Math.min(page * limit, total)} / {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(Math.max(1, page - 1))}
                      disabled={page === 1}
                      className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                      const p = start + i;
                      if (p > totalPages) return null;
                      return (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`w-8 h-8 rounded-lg text-sm ${
                            p === page
                              ? 'bg-indigo-600 text-white'
                              : 'hover:bg-gray-200 text-gray-600'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                      disabled={page === totalPages}
                      className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 대화 상세 패널 */}
        {selectedSession && (
          <div className="w-1/2 bg-white border border-gray-200 rounded-xl flex flex-col max-h-[calc(100vh-240px)] sticky top-6">
            {/* 패널 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-indigo-600" />
                <span className="text-sm font-medium text-gray-900">대화 상세</span>
                <span className="text-xs text-gray-500">
                  {formatDate(selectedSession.session.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selectedSession.analytics.some(a => a.isBooking) && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                    예약의사
                  </span>
                )}
                <button
                  onClick={() => setSelectedSession(null)}
                  className="p-1 hover:bg-gray-200 rounded-lg transition"
                >
                  <X size={16} className="text-gray-500" />
                </button>
              </div>
            </div>

            {/* 대화 메시지 */}
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-6 h-6 border-3 border-indigo-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {selectedSession.session.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-1">
                        <Bot size={14} className="text-indigo-600" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <div className={`flex items-center gap-2 mt-1 text-xs ${
                        msg.role === 'user' ? 'text-indigo-200' : 'text-gray-400'
                      }`}>
                        <span>{formatTime(msg.createdAt)}</span>
                        {msg.category && (
                          <span className={`px-1.5 py-0.5 rounded ${
                            msg.role === 'user'
                              ? 'bg-indigo-500/30'
                              : categoryColors[msg.category] || 'bg-gray-200 text-gray-600'
                          }`}>
                            {categoryLabels[msg.category] || msg.category}
                          </span>
                        )}
                      </div>
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-1">
                        <User size={14} className="text-gray-600" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 분석 요약 */}
            {selectedSession.analytics.length > 0 && (
              <div className="border-t border-gray-200 px-4 py-3 bg-gray-50 rounded-b-xl">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>
                    응답시간: {
                      Math.round(
                        selectedSession.analytics.reduce((s, a) => s + (a.responseTime || 0), 0) /
                        selectedSession.analytics.length
                      )
                    }ms
                  </span>
                  <span>
                    RAG 매칭: {selectedSession.analytics.filter(a => a.hadSources).length}/{selectedSession.analytics.length}
                  </span>
                  <span>
                    폴백: {selectedSession.analytics.filter(a => a.isFallback).length}건
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
