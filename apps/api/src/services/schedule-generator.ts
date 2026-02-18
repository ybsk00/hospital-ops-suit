/**
 * 처치 반복 스케줄 생성기 (Phase 7)
 * ProcedurePlan 확인 후 ProcedureExecution 일괄 생성
 */
import { prisma } from '../lib/prisma';
import type { ProcedureFrequency } from '@prisma/client';

interface ScheduleParams {
  planId: string;
  startDate: string;  // YYYY-MM-DD
  time: string;       // HH:MM
  frequency: ProcedureFrequency;
  totalSessions?: number;
  durationMinutes: number;
}

/**
 * 반복 주기에 따라 ProcedureExecution 다건 생성
 *
 * - ONCE: 1회
 * - DAILY: 평일만 (월~금)
 * - THREE_WEEK: 월/수/금
 * - TWICE_WEEK: 화/목
 * - EVERY_OTHER: 격일 (주말 제외)
 * - WEEKLY: 시작 요일 기준 매주
 * - CUSTOM: 1회만 (사용자가 직접 관리)
 *
 * 제한: 최대 30회 또는 90일 이내
 */
export async function generateExecutionSchedule(
  params: ScheduleParams,
): Promise<{ count: number; firstDate: string; lastDate: string }> {
  const { planId, startDate, time, frequency, durationMinutes } = params;
  const maxSessions = Math.min(params.totalSessions || 30, 30);
  const maxDays = 90;

  const [hours, minutes] = time.split(':').map(Number);
  const baseDate = new Date(startDate + 'T00:00:00+09:00');
  baseDate.setHours(hours, minutes, 0, 0);

  const endLimit = new Date(baseDate.getTime() + maxDays * 24 * 60 * 60 * 1000);

  const dates: Date[] = [];

  if (frequency === 'ONCE' || frequency === 'CUSTOM') {
    dates.push(new Date(baseDate));
  } else {
    let current = new Date(baseDate);

    while (dates.length < maxSessions && current <= endLimit) {
      const dayOfWeek = current.getDay(); // 0=일, 1=월, ..., 6=토

      let include = false;

      switch (frequency) {
        case 'DAILY':
          // 평일만
          include = dayOfWeek >= 1 && dayOfWeek <= 5;
          break;
        case 'THREE_WEEK':
          // 월(1), 수(3), 금(5)
          include = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
          break;
        case 'TWICE_WEEK':
          // 화(2), 목(4)
          include = dayOfWeek === 2 || dayOfWeek === 4;
          break;
        case 'EVERY_OTHER':
          // 격일 (주말 제외)
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            // 시작일부터의 날짜 차이를 계산하여 격일 판단
            const diffDays = Math.round(
              (current.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000),
            );
            include = diffDays % 2 === 0;
          }
          break;
        case 'WEEKLY':
          // 시작 요일과 같은 요일
          include = dayOfWeek === baseDate.getDay();
          break;
      }

      if (include) {
        dates.push(new Date(current));
      }

      // 다음 날로 이동
      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
      current.setHours(hours, minutes, 0, 0);
    }
  }

  if (dates.length === 0) {
    return { count: 0, firstDate: startDate, lastDate: startDate };
  }

  // ProcedureExecution 일괄 생성
  await prisma.procedureExecution.createMany({
    data: dates.map((d) => ({
      planId,
      scheduledAt: d,
      status: 'SCHEDULED' as const,
    })),
  });

  return {
    count: dates.length,
    firstDate: dates[0].toISOString().split('T')[0],
    lastDate: dates[dates.length - 1].toISOString().split('T')[0],
  };
}
