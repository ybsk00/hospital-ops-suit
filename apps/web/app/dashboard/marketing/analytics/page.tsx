'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3,
  MessageSquare,
  Calendar,
  TrendingUp,
  Clock,
  Users,
  Target,
  AlertCircle,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../stores/auth';

interface AnalyticsData {
  totalChats: number;
  bookingIntents: number;
  bookingRate: number;
  avgResponseTime: number;
  categoryStats: Array<{ category: string; _count: number }>;
  dailyStats: Array<{ date: string; count: number }>;
}

export default function ChatbotAnalyticsPage() {
  const { accessToken } = useAuthStore();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    loadAnalytics();
  }, [period]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const res = await api<AnalyticsData>(`/api/marketing/analytics?from=${from}`, { token: accessToken || undefined });
      if (res.success && res.data) {
        setAnalytics(res.data);
      }
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      label: '총 대화',
      value: analytics?.totalChats ?? 0,
      icon: MessageSquare,
      color: 'bg-blue-500',
      suffix: '건',
    },
    {
      label: '예약 의사',
      value: analytics?.bookingIntents ?? 0,
      icon: Target,
      color: 'bg-emerald-500',
      suffix: '건',
    },
    {
      label: '예약 전환율',
      value: analytics?.bookingRate ?? 0,
      icon: TrendingUp,
      color: 'bg-purple-500',
      suffix: '%',
    },
    {
      label: '평균 응답시간',
      value: analytics?.avgResponseTime ?? 0,
      icon: Clock,
      color: 'bg-orange-500',
      suffix: 'ms',
    },
  ];

  const categoryLabels: Record<string, string> = {
    cancer: '암',
    nerve: '자율신경',
    general: '일반',
    auto: '자동분류',
  };

  const categoryColors: Record<string, string> = {
    cancer: 'bg-red-500',
    nerve: 'bg-blue-500',
    general: 'bg-gray-500',
    auto: 'bg-purple-500',
  };

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <BarChart3 className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">챗봇 통계</h1>
            <p className="text-sm text-gray-500">환자 챗봇 이용 현황 분석</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-gray-400" />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as '7d' | '30d' | '90d')}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          >
            <option value="7d">최근 7일</option>
            <option value="30d">최근 30일</option>
            <option value="90d">최근 90일</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* 통계 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="bg-white border border-gray-200 rounded-xl p-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">{card.label}</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">
                        {card.value.toLocaleString()}
                        <span className="text-lg font-normal text-gray-500 ml-1">
                          {card.suffix}
                        </span>
                      </p>
                    </div>
                    <div className={`p-3 ${card.color} rounded-xl`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 차트 영역 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 일별 대화량 */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">일별 대화량</h3>
              {analytics?.dailyStats && analytics.dailyStats.length > 0 ? (
                <div className="space-y-2">
                  {analytics.dailyStats.slice(-14).map((stat) => {
                    const maxCount = Math.max(...analytics.dailyStats.map((s) => s.count));
                    const percentage = maxCount > 0 ? (stat.count / maxCount) * 100 : 0;
                    return (
                      <div key={stat.date} className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-20">
                          {new Date(stat.date).toLocaleDateString('ko-KR', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                          <div
                            className="bg-blue-500 h-full rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-700 w-12 text-right">
                          {stat.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <AlertCircle size={32} />
                  <p className="mt-2 text-sm">데이터가 없습니다</p>
                </div>
              )}
            </div>

            {/* 카테고리별 분포 */}
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">카테고리별 분포</h3>
              {analytics?.categoryStats && analytics.categoryStats.length > 0 ? (
                <div className="space-y-4">
                  {analytics.categoryStats.map((stat) => {
                    const total = analytics.categoryStats.reduce(
                      (sum, s) => sum + s._count,
                      0
                    );
                    const percentage = total > 0 ? (stat._count / total) * 100 : 0;
                    return (
                      <div key={stat.category} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-700">
                            {categoryLabels[stat.category] || stat.category}
                          </span>
                          <span className="text-sm text-gray-500">
                            {stat._count}건 ({percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                          <div
                            className={`${
                              categoryColors[stat.category] || 'bg-gray-500'
                            } h-full rounded-full transition-all`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <AlertCircle size={32} />
                  <p className="mt-2 text-sm">데이터가 없습니다</p>
                </div>
              )}
            </div>
          </div>

          {/* 인사이트 */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">인사이트</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-white rounded-lg">
                  <Users className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">예약 전환</p>
                  <p className="text-sm text-gray-600">
                    {analytics?.bookingIntents || 0}명의 환자가 내원 의사를 표현했습니다.
                    {analytics?.bookingRate && analytics.bookingRate > 10 && (
                      <span className="text-emerald-600"> 전환율이 양호합니다!</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="p-2 bg-white rounded-lg">
                  <Clock className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">응답 속도</p>
                  <p className="text-sm text-gray-600">
                    평균 {analytics?.avgResponseTime || 0}ms로 응답하고 있습니다.
                    {analytics?.avgResponseTime && analytics.avgResponseTime < 2000 && (
                      <span className="text-emerald-600"> 빠른 응답 속도입니다!</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
