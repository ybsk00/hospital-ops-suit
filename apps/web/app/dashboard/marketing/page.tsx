'use client';

import { useEffect, useState } from 'react';
import { Megaphone, MessageCircle, FileText, BarChart3, ExternalLink, Copy, Check } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAuthStore } from '../../../stores/auth';

interface MarketingStats {
  faqCount: number;
  docCount: number;
  sessionCount: number;
}

export default function MarketingPage() {
  const { accessToken } = useAuthStore();
  const [stats, setStats] = useState<MarketingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // 챗봇 임베드 URL
  const chatbotUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/patient-chatbot`
    : '';

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const res = await api<{ faqCount: number; docCount: number; sessionCount: number }>('/api/marketing/stats', { token: accessToken || undefined });
      if (res.success && res.data) {
        setStats(res.data);
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(chatbotUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statCards = [
    {
      label: 'FAQ 콘텐츠',
      value: stats?.faqCount ?? '-',
      icon: MessageCircle,
      color: 'bg-blue-500',
      href: '/dashboard/marketing/chatbot',
    },
    {
      label: '마케팅 문서',
      value: stats?.docCount ?? '-',
      icon: FileText,
      color: 'bg-emerald-500',
      href: '/dashboard/marketing/chatbot',
    },
    {
      label: '총 채팅 세션',
      value: stats?.sessionCount ?? '-',
      icon: BarChart3,
      color: 'bg-purple-500',
      href: '/dashboard/marketing/analytics',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-pink-100 rounded-lg">
          <Megaphone className="w-6 h-6 text-pink-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">마케팅 관리</h1>
          <p className="text-sm text-gray-500">환자용 챗봇 콘텐츠 및 통계 관리</p>
        </div>
      </div>

      {/* 챗봇 임베드 URL */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">홈페이지 챗봇 임베드</h2>
        <p className="text-sm text-gray-600 mb-4">
          아래 URL을 홈페이지 제작업체에 전달하여 iframe 또는 플로팅 버튼으로 임베드할 수 있습니다.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-white border border-gray-300 rounded-lg px-4 py-2.5 font-mono text-sm text-gray-700 truncate">
            {chatbotUrl}
          </div>
          <button
            onClick={copyUrl}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? '복사됨' : '복사'}
          </button>
          <a
            href={chatbotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <ExternalLink size={18} />
            미리보기
          </a>
        </div>
        <div className="mt-4 p-4 bg-white/70 rounded-lg">
          <p className="text-xs font-medium text-gray-700 mb-2">iframe 임베드 코드 예시:</p>
          <code className="block text-xs text-gray-600 bg-gray-100 p-2 rounded overflow-x-auto">
            {`<iframe src="${chatbotUrl}" width="400" height="600" frameborder="0"></iframe>`}
          </code>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <a
              key={card.label}
              href={card.href}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">
                    {loading ? '...' : typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
                  </p>
                </div>
                <div className={`p-3 ${card.color} rounded-xl`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </a>
          );
        })}
      </div>

      {/* 빠른 링크 */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">빠른 메뉴</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/dashboard/marketing/chatbot"
            className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="p-2 bg-blue-100 rounded-lg">
              <MessageCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">챗봇 콘텐츠 관리</p>
              <p className="text-sm text-gray-500">FAQ 및 마케팅 문서 관리</p>
            </div>
          </a>
          <a
            href="/dashboard/marketing/analytics"
            className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="p-2 bg-purple-100 rounded-lg">
              <BarChart3 className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">챗봇 통계</p>
              <p className="text-sm text-gray-500">이용 현황 및 분석 데이터</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
