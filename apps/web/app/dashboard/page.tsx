'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import {
  BedDouble,
  UserPlus,
  Syringe,
  CalendarClock,
  AlertTriangle,
  Inbox,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface DashboardStats {
  emptyBeds: number;
  admissions: number;
  todayProcedures: number;
  todayAppointments: number;
  unreadInbox: number;
}

interface AlertItem {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  priority: number;
  status: string;
  createdAt: string;
}

interface ScheduleItem {
  id: string;
  time: string;
  patient: string;
  doctor: string;
  status: string;
}

interface TrendItem {
  date: string;
  bedOccupancy: number;
  totalBeds: number;
  newAdmissions: number;
  proceduresCompleted: number;
  appointments: number;
  homecareVisits: number;
}

const typeColors: Record<string, string> = {
  RED_ALERT: 'text-red-600',
  ORANGE_ALERT: 'text-orange-500',
  LAB_ABNORMAL: 'text-yellow-600',
  REPORT_PENDING: 'text-blue-600',
  SYNC_CONFLICT: 'text-purple-600',
  MANUAL_FLAG: 'text-slate-600',
  BATCH_FAILURE: 'text-red-400',
};

const statusBadge: Record<string, string> = {
  BOOKED: 'bg-blue-100 text-blue-700',
  CHECKED_IN: 'bg-green-100 text-green-700',
};

type TrendPeriod = 'daily' | 'weekly' | 'monthly';

const periodLabels: Record<TrendPeriod, string> = {
  daily: '일별',
  weekly: '주별',
  monthly: '월별',
};

function formatDateLabel(date: string, period: TrendPeriod): string {
  const d = new Date(date);
  if (period === 'monthly') return `${d.getMonth() + 1}월`;
  if (period === 'weekly') return `${d.getMonth() + 1}/${d.getDate()}주`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 히트맵 색상 강도 계산
function getHeatmapColor(value: number, max: number, baseColor: string): string {
  if (max === 0 || value === 0) return 'bg-slate-100';
  const intensity = Math.min(value / max, 1);

  const colorMap: Record<string, string[]> = {
    blue: ['bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500'],
    purple: ['bg-purple-100', 'bg-purple-200', 'bg-purple-300', 'bg-purple-400', 'bg-purple-500'],
    orange: ['bg-orange-100', 'bg-orange-200', 'bg-orange-300', 'bg-orange-400', 'bg-orange-500'],
    green: ['bg-green-100', 'bg-green-200', 'bg-green-300', 'bg-green-400', 'bg-green-500'],
  };

  const colors = colorMap[baseColor] || colorMap.blue;
  const index = Math.min(Math.floor(intensity * colors.length), colors.length - 1);
  return colors[index];
}

// 월별 달력 히트맵 컴포넌트
function MonthlyCalendarHeatmap({
  data,
  field,
  title,
  color
}: {
  data: TrendItem[];
  field: keyof TrendItem;
  title: string;
  color: string;
}) {
  const maxValue = Math.max(...data.map(d => Number(d[field]) || 0), 1);
  const months = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  // 데이터를 월별로 매핑
  const monthData = new Map<number, number>();
  data.forEach(d => {
    const month = new Date(d.date).getMonth();
    monthData.set(month, (monthData.get(month) || 0) + Number(d[field] || 0));
  });

  const currentMonth = new Date().getMonth();

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h4 className="text-sm font-medium text-slate-700 mb-3">{title}</h4>
      <div className="grid grid-cols-6 gap-2">
        {months.map((month, idx) => {
          const value = monthData.get(idx) || 0;
          const isCurrentMonth = idx === currentMonth;
          return (
            <div
              key={month}
              className={`relative p-3 rounded-lg text-center transition-all hover:scale-105 ${getHeatmapColor(value, maxValue, color)} ${isCurrentMonth ? 'ring-2 ring-blue-500' : ''}`}
              title={`${month}: ${value}`}
            >
              <div className="text-xs font-medium text-slate-600">{month}</div>
              <div className="text-lg font-bold text-slate-800">{value}</div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1 mt-3 text-xs text-slate-500">
        <span>적음</span>
        {['bg-slate-100', ...(['blue', 'purple', 'orange', 'green'].includes(color) ?
          [`bg-${color}-100`, `bg-${color}-200`, `bg-${color}-300`, `bg-${color}-400`, `bg-${color}-500`] :
          ['bg-blue-100', 'bg-blue-200', 'bg-blue-300', 'bg-blue-400', 'bg-blue-500']
        ).slice(0, 5)].map((c, i) => (
          <div key={i} className={`w-4 h-4 rounded ${c}`} />
        ))}
        <span>많음</span>
      </div>
    </div>
  );
}

// 주별 달력 히트맵 컴포넌트
function WeeklyCalendarHeatmap({
  data,
  field,
  title,
  color
}: {
  data: TrendItem[];
  field: keyof TrendItem;
  title: string;
  color: string;
}) {
  const maxValue = Math.max(...data.map(d => Number(d[field]) || 0), 1);
  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  // 최근 12주 데이터를 주별로 그룹핑
  const weeks: { weekStart: string; days: { date: string; value: number; dayOfWeek: number }[] }[] = [];

  // 날짜별 데이터 맵
  const dateMap = new Map<string, number>();
  data.forEach(d => {
    dateMap.set(d.date, Number(d[field]) || 0);
  });

  // 최근 12주 생성
  const today = new Date();
  for (let w = 11; w >= 0; w--) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() - (w * 7));
    weekStart.setHours(0, 0, 0, 0);

    const days: { date: string; value: number; dayOfWeek: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      days.push({
        date: dateStr,
        value: dateMap.get(dateStr) || 0,
        dayOfWeek: d,
      });
    }

    weeks.push({
      weekStart: weekStart.toISOString().slice(0, 10),
      days,
    });
  }

  const todayStr = today.toISOString().slice(0, 10);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h4 className="text-sm font-medium text-slate-700 mb-3">{title}</h4>
      <div className="overflow-x-auto">
        <div className="flex gap-1">
          {/* 요일 레이블 */}
          <div className="flex flex-col gap-1 mr-1">
            {weekDays.map((day, idx) => (
              <div key={day} className="w-6 h-6 flex items-center justify-center text-[10px] text-slate-400">
                {idx % 2 === 0 ? day : ''}
              </div>
            ))}
          </div>

          {/* 주별 데이터 */}
          {weeks.map((week, wIdx) => (
            <div key={week.weekStart} className="flex flex-col gap-1">
              {/* 월 레이블 (첫째 주만) */}
              {wIdx === 0 || new Date(week.weekStart).getDate() <= 7 ? (
                <div className="text-[10px] text-slate-500 text-center mb-1 h-3">
                  {new Date(week.weekStart).getMonth() + 1}월
                </div>
              ) : (
                <div className="h-3 mb-1" />
              )}

              {week.days.map((day) => {
                const isToday = day.date === todayStr;
                const isFuture = new Date(day.date) > today;

                return (
                  <div
                    key={day.date}
                    className={`w-6 h-6 rounded-sm transition-all hover:scale-110 ${
                      isFuture
                        ? 'bg-slate-50'
                        : getHeatmapColor(day.value, maxValue, color)
                    } ${isToday ? 'ring-2 ring-blue-500' : ''}`}
                    title={`${day.date}: ${day.value}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-slate-400">최근 12주</div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>적음</span>
          <div className="w-3 h-3 rounded-sm bg-slate-100" />
          <div className={`w-3 h-3 rounded-sm bg-${color}-200`} />
          <div className={`w-3 h-3 rounded-sm bg-${color}-400`} />
          <span>많음</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, accessToken } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 트렌드 차트
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('daily');
  const [trendData, setTrendData] = useState<TrendItem[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [statsRes, alertsRes, scheduleRes] = await Promise.all([
        api<DashboardStats>('/api/dashboard/stats', { token: accessToken }),
        api<AlertItem[]>('/api/dashboard/recent-alerts', { token: accessToken }),
        api<ScheduleItem[]>('/api/dashboard/today-schedule', { token: accessToken }),
      ]);
      setStats(statsRes.data ?? null);
      setAlerts(Array.isArray(alertsRes.data) ? alertsRes.data : []);
      setSchedule(Array.isArray(scheduleRes.data) ? scheduleRes.data : []);
    } catch {
      // 에러 시 기본값 유지
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  const fetchTrends = useCallback(async () => {
    if (!accessToken) return;
    setTrendLoading(true);
    try {
      const res = await api<{ series: TrendItem[] }>(`/api/dashboard/trends?period=${trendPeriod}`, {
        token: accessToken,
      });
      setTrendData(res.data?.series || []);
    } catch {
      setTrendData([]);
    } finally {
      setTrendLoading(false);
    }
  }, [accessToken, trendPeriod]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  const statCards = [
    { label: '빈 베드', value: stats?.emptyBeds ?? '-', icon: BedDouble, color: 'bg-green-500' },
    { label: '입원 환자', value: stats?.admissions ?? '-', icon: UserPlus, color: 'bg-blue-500' },
    { label: '오늘 처치', value: stats?.todayProcedures ?? '-', icon: Syringe, color: 'bg-purple-500' },
    { label: '오늘 예약', value: stats?.todayAppointments ?? '-', icon: CalendarClock, color: 'bg-orange-500' },
    { label: '미처리 알림', value: stats?.unreadInbox ?? '-', icon: AlertTriangle, color: 'bg-red-500' },
    { label: '업무함', value: alerts.length > 0 ? `${alerts.length}건` : '-', icon: Inbox, color: 'bg-indigo-500' },
  ];

  const chartData = trendData.map((d) => ({
    ...d,
    label: formatDateLabel(d.date, trendPeriod),
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">대시보드</h1>
        <p className="text-slate-500 mt-1">
          안녕하세요, {user?.name}님. 오늘의 업무 현황입니다.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 ${card.color} rounded-lg flex items-center justify-center`}>
                  <Icon size={20} className="text-white" />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900">
                {loading ? '...' : card.value}
              </div>
              <div className="text-xs text-slate-500 mt-1">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* Trend Charts */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">현황 추이</h2>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {(['daily', 'weekly', 'monthly'] as TrendPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setTrendPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  trendPeriod === p
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>
        </div>

        {trendLoading ? (
          <div className="text-center py-12 text-slate-400">차트 로딩 중...</div>
        ) : chartData.length === 0 ? (
          <div className="text-center py-12 text-slate-400">데이터가 없습니다.</div>
        ) : trendPeriod === 'monthly' ? (
          /* 월별 달력 히트맵 */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MonthlyCalendarHeatmap
              data={trendData}
              field="bedOccupancy"
              title="병상 가동 (입원 환자)"
              color="blue"
            />
            <MonthlyCalendarHeatmap
              data={trendData}
              field="newAdmissions"
              title="신규 입원"
              color="blue"
            />
            <MonthlyCalendarHeatmap
              data={trendData}
              field="proceduresCompleted"
              title="처치 완료"
              color="purple"
            />
            <MonthlyCalendarHeatmap
              data={trendData}
              field="appointments"
              title="외래 예약"
              color="orange"
            />
            <MonthlyCalendarHeatmap
              data={trendData}
              field="homecareVisits"
              title="가정방문"
              color="green"
            />
          </div>
        ) : trendPeriod === 'weekly' ? (
          /* 주별 달력 히트맵 */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WeeklyCalendarHeatmap
              data={trendData}
              field="bedOccupancy"
              title="병상 가동 (입원 환자)"
              color="blue"
            />
            <WeeklyCalendarHeatmap
              data={trendData}
              field="newAdmissions"
              title="신규 입원"
              color="blue"
            />
            <WeeklyCalendarHeatmap
              data={trendData}
              field="proceduresCompleted"
              title="처치 완료"
              color="purple"
            />
            <WeeklyCalendarHeatmap
              data={trendData}
              field="appointments"
              title="외래 예약"
              color="orange"
            />
            <WeeklyCalendarHeatmap
              data={trendData}
              field="homecareVisits"
              title="가정방문"
              color="green"
            />
          </div>
        ) : (
          /* 일별 라인/바 차트 */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 병상 가동률 */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">병상 가동</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="bedOccupancy" stroke="#3b82f6" name="입원 수" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="totalBeds" stroke="#e2e8f0" name="전체 병상" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 입원/처치 */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">입원 / 처치</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="newAdmissions" fill="#3b82f6" name="신규 입원" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="proceduresCompleted" fill="#8b5cf6" name="처치 완료" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 외래 예약 */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">외래 예약</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="appointments" stroke="#f59e0b" name="외래 예약" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* 가정방문 */}
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">가정방문 완료</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="homecareVisits" fill="#10b981" name="가정방문" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Bottom sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">최근 알림</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-400">아직 알림이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {alerts.map((item) => (
                <div key={item.id} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
                  <AlertTriangle size={16} className={`mt-0.5 ${typeColors[item.type] || 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{item.title}</div>
                    {item.summary && (
                      <div className="text-xs text-slate-500 truncate">{item.summary}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(item.createdAt).toLocaleString('ko-KR')}
                    </div>
                  </div>
                  {item.priority > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">
                      P{item.priority}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Today Schedule */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">오늘 일정</h2>
          {schedule.length === 0 ? (
            <p className="text-sm text-slate-400">오늘 예정된 일정이 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {schedule.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <div className="text-sm font-mono text-slate-600 w-14">{item.time}</div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-800">{item.patient}</span>
                    <span className="text-xs text-slate-400 ml-2">{item.doctor}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[item.status] || 'bg-slate-100 text-slate-600'}`}>
                    {item.status === 'BOOKED' ? '예약' : item.status === 'CHECKED_IN' ? '접수' : item.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
