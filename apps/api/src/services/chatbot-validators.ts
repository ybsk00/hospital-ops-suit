/**
 * AI 챗봇 WRITE 검증 유틸리티 (Phase 7)
 * - 환자 매칭
 * - 처치 카탈로그 매칭
 * - 시간 충돌 검사
 */
import { prisma } from '../lib/prisma';

// ═══════════════════════════════════════════════════════════
//  1. 환자 매칭
// ═══════════════════════════════════════════════════════════

export interface MatchedPatient {
  id: string;
  name: string;
  emrPatientId: string | null;
  dob: Date | null;
  phone: string | null;
}

export type PatientMatchResult =
  | { status: 'found'; patient: MatchedPatient }
  | { status: 'multiple'; patients: MatchedPatient[] }
  | { status: 'notFound'; searchTerm: string };

/**
 * 환자를 이름 또는 ID로 매칭
 * - patientId가 있으면 정확 매칭
 * - 없으면 이름 검색 → 단일/복수/없음 분기
 */
export async function matchPatient(
  patientName: string,
  patientId?: string,
): Promise<PatientMatchResult> {
  // ID가 주어진 경우: 정확 매칭
  if (patientId) {
    const patient = await prisma.patient.findFirst({
      where: {
        OR: [{ id: patientId }, { emrPatientId: patientId }],
        deletedAt: null,
        status: 'ACTIVE',
      },
    });

    if (patient) {
      return {
        status: 'found',
        patient: {
          id: patient.id,
          name: patient.name,
          emrPatientId: patient.emrPatientId,
          dob: patient.dob,
          phone: patient.phone,
        },
      };
    }
  }

  // 이름 검색
  const patients = await prisma.patient.findMany({
    where: { name: { contains: patientName }, deletedAt: null, status: 'ACTIVE' },
    take: 10,
  });

  if (patients.length === 0) {
    return { status: 'notFound', searchTerm: patientName };
  }

  if (patients.length === 1) {
    const p = patients[0];
    return {
      status: 'found',
      patient: {
        id: p.id,
        name: p.name,
        emrPatientId: p.emrPatientId,
        dob: p.dob,
        phone: p.phone,
      },
    };
  }

  // 동명이인
  return {
    status: 'multiple',
    patients: patients.map((p) => ({
      id: p.id,
      name: p.name,
      emrPatientId: p.emrPatientId,
      dob: p.dob,
      phone: p.phone,
    })),
  };
}

// ═══════════════════════════════════════════════════════════
//  2. 처치 카탈로그 매칭
// ═══════════════════════════════════════════════════════════

/**
 * 자연어 → 처치 카탈로그 코드 매핑 사전
 * 사용자 입력이 다양한 형태로 올 수 있으므로 키워드 기반 매핑
 */
const PROCEDURE_KEYWORD_MAP: Record<string, string[]> = {
  MANUAL_THERAPY: ['도수', '도수치료', '수기치료', '마사지'],
  RF_HYPERTHERMIA: ['고주파', 'RF', '온열', '고주파온열', '고주파치료'],
  O2_THERAPY: ['산소', '산소치료', 'O2'],
  INJECTION: ['수액', '수액주사', '주사', '주사치료', 'IV'],
  LASER: ['레이저', '레이저치료'],
};

export interface MatchedCatalog {
  id: string;
  name: string;
  code: string | null;
  category: string;
  defaultDuration: number | null;
  defaultUnitPrice: number;
}

export type CatalogMatchResult =
  | { status: 'found'; catalog: MatchedCatalog }
  | { status: 'notFound'; searchTerm: string; suggestions: string[] };

/**
 * 처치명을 카탈로그에 매칭
 * 1) 코드 매핑 사전에서 검색
 * 2) DB에서 이름 부분 매칭
 */
export async function matchProcedureCatalog(
  procedureName: string,
): Promise<CatalogMatchResult> {
  // 1) 키워드 → 코드 매핑
  const normalizedInput = procedureName.trim().toLowerCase();
  let matchedCode: string | null = null;

  for (const [code, keywords] of Object.entries(PROCEDURE_KEYWORD_MAP)) {
    if (keywords.some((kw) => normalizedInput.includes(kw.toLowerCase()))) {
      matchedCode = code;
      break;
    }
  }

  // 코드로 검색
  if (matchedCode) {
    const catalog = await prisma.procedureCatalog.findFirst({
      where: { code: matchedCode, isActive: true, deletedAt: null },
    });

    if (catalog) {
      return {
        status: 'found',
        catalog: {
          id: catalog.id,
          name: catalog.name,
          code: catalog.code,
          category: catalog.category,
          defaultDuration: catalog.defaultDuration,
          defaultUnitPrice: Number(catalog.defaultUnitPrice),
        },
      };
    }
  }

  // 2) 이름 부분 매칭
  const catalog = await prisma.procedureCatalog.findFirst({
    where: { name: { contains: procedureName }, isActive: true, deletedAt: null },
  });

  if (catalog) {
    return {
      status: 'found',
      catalog: {
        id: catalog.id,
        name: catalog.name,
        code: catalog.code,
        category: catalog.category,
        defaultDuration: catalog.defaultDuration,
        defaultUnitPrice: Number(catalog.defaultUnitPrice),
      },
    };
  }

  // 3) 없음 → 사용 가능한 목록 반환
  const allCatalogs = await prisma.procedureCatalog.findMany({
    where: { isActive: true, deletedAt: null },
    select: { name: true },
  });

  return {
    status: 'notFound',
    searchTerm: procedureName,
    suggestions: allCatalogs.map((c) => c.name),
  };
}

// ═══════════════════════════════════════════════════════════
//  3. 시간 충돌 검사
// ═══════════════════════════════════════════════════════════

export interface TimeConflict {
  type: 'patient' | 'doctor';
  existingAppointmentId: string;
  existingTime: string;
  existingWith: string; // 환자명 또는 의사명
}

export interface TimeConflictResult {
  hasConflict: boolean;
  conflicts: TimeConflict[];
  alternatives: string[]; // 빈 시간대 HH:MM 배열
}

/**
 * 환자/의사 기준 시간 충돌 검사 + 대안 시간 제시
 */
export async function checkTimeConflict(params: {
  patientId: string;
  doctorId?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number;
}): Promise<TimeConflictResult> {
  const { patientId, doctorId, date, time, durationMinutes } = params;

  const [hours, minutes] = time.split(':').map(Number);
  const startAt = new Date(date + 'T00:00:00+09:00');
  startAt.setHours(hours, minutes, 0, 0);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  const dayStart = new Date(date + 'T00:00:00+09:00');
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const conflicts: TimeConflict[] = [];

  // 환자 예약 충돌 검사
  const patientConflicts = await prisma.appointment.findMany({
    where: {
      patientId,
      deletedAt: null,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    include: { doctor: { select: { name: true } } },
  });

  for (const apt of patientConflicts) {
    conflicts.push({
      type: 'patient',
      existingAppointmentId: apt.id,
      existingTime: `${new Date(apt.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} - ${new Date(apt.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
      existingWith: apt.doctor.name,
    });
  }

  // 의사 예약 충돌 검사
  if (doctorId) {
    const doctorConflicts = await prisma.appointment.findMany({
      where: {
        doctorId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      include: { patient: { select: { name: true } } },
    });

    for (const apt of doctorConflicts) {
      conflicts.push({
        type: 'doctor',
        existingAppointmentId: apt.id,
        existingTime: `${new Date(apt.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} - ${new Date(apt.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
        existingWith: apt.patient.name,
      });
    }
  }

  // 빈 시간대 계산 (09:00 ~ 17:00, 30분 단위)
  const alternatives: string[] = [];

  if (conflicts.length > 0) {
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { gte: dayStart, lt: dayEnd },
        ...(doctorId ? { doctorId } : {}),
      },
      select: { startAt: true, endAt: true },
    });

    const bookedTimes = new Set(
      existingAppointments.map(
        (a) => new Date(a.startAt).getHours() * 60 + new Date(a.startAt).getMinutes(),
      ),
    );

    for (let h = 9; h < 17; h++) {
      for (const m of [0, 30]) {
        const mins = h * 60 + m;
        if (!bookedTimes.has(mins)) {
          alternatives.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }
      }
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    alternatives,
  };
}

// ═══════════════════════════════════════════════════════════
//  4. 치료사 매칭 (도수치료)
// ═══════════════════════════════════════════════════════════

export async function matchTherapist(name?: string): Promise<
  | { status: 'found'; therapist: { id: string; name: string } }
  | { status: 'multiple'; therapists: { id: string; name: string }[] }
  | { status: 'notFound' }
> {
  const where: any = { deletedAt: null, isActive: true, specialty: '도수' };
  if (name) where.name = { contains: name };

  const therapists = await prisma.therapist.findMany({ where, take: 10 });

  if (therapists.length === 0) return { status: 'notFound' };
  if (therapists.length === 1) return { status: 'found', therapist: { id: therapists[0].id, name: therapists[0].name } };
  return { status: 'multiple', therapists: therapists.map(t => ({ id: t.id, name: t.name })) };
}

/**
 * 날짜+시간에 빈 치료사 중 예약 적은 순으로 자동배정
 */
export async function autoAssignTherapist(date: string, time: string): Promise<{ id: string; name: string } | null> {
  const therapists = await prisma.therapist.findMany({
    where: { deletedAt: null, isActive: true, specialty: '도수' },
  });

  if (therapists.length === 0) return null;

  // 해당 날짜+시간에 이미 예약된 치료사 제외
  const bookedSlots = await prisma.manualTherapySlot.findMany({
    where: {
      date: new Date(date),
      timeSlot: time,
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
    select: { therapistId: true },
  });

  const bookedIds = new Set(bookedSlots.map(s => s.therapistId));
  const available = therapists.filter(t => !bookedIds.has(t.id));

  if (available.length === 0) return null;

  // 해당 날짜 예약 건수 기준으로 가장 여유있는 치료사
  const dayCounts = await prisma.manualTherapySlot.groupBy({
    by: ['therapistId'],
    where: {
      date: new Date(date),
      deletedAt: null,
      status: { not: 'CANCELLED' },
      therapistId: { in: available.map(t => t.id) },
    },
    _count: { id: true },
  });

  const countMap = new Map(dayCounts.map(c => [c.therapistId, c._count.id]));
  available.sort((a, b) => (countMap.get(a.id) || 0) - (countMap.get(b.id) || 0));

  return { id: available[0].id, name: available[0].name };
}

/**
 * RF 기계 자동배정: 빈 기계 중 번호 낮은 순
 */
export async function autoAssignRfRoom(
  date: string,
  time: string,
  duration: number,
): Promise<{ id: string; name: string } | null> {
  const rooms = await prisma.rfTreatmentRoom.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
  });

  const existingSlots = await prisma.rfScheduleSlot.findMany({
    where: {
      date: new Date(date),
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
    select: { roomId: true, startTime: true, duration: true },
  });

  function timeToMin(t: string) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  const checkStart = timeToMin(time);
  const checkEnd = checkStart + duration + 30;

  for (const room of rooms) {
    const roomSlots = existingSlots.filter(s => s.roomId === room.id);
    const hasConflict = roomSlots.some(s => {
      const sStart = timeToMin(s.startTime);
      const sEnd = sStart + s.duration + 30;
      return checkStart < sEnd && sStart < checkEnd;
    });

    if (!hasConflict) {
      return { id: room.id, name: room.name };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
//  5. 반복 주기 매핑
// ═══════════════════════════════════════════════════════════

import type { ProcedureFrequency } from '@prisma/client';

const FREQUENCY_KEYWORD_MAP: Record<string, ProcedureFrequency> = {
  '매일': 'DAILY',
  '주5회': 'DAILY',
  '일1회': 'DAILY',
  '주3회': 'THREE_WEEK',
  '월수금': 'THREE_WEEK',
  '주2회': 'TWICE_WEEK',
  '화목': 'TWICE_WEEK',
  '격일': 'EVERY_OTHER',
  '이틀에한번': 'EVERY_OTHER',
  '주1회': 'WEEKLY',
  '매주': 'WEEKLY',
  '1회': 'ONCE',
  '단회': 'ONCE',
  '한번': 'ONCE',
};

/**
 * 자연어 반복 주기 → ProcedureFrequency enum 변환
 */
export function parseFrequency(
  input?: string,
): { frequency: ProcedureFrequency; note: string } {
  if (!input) return { frequency: 'ONCE', note: '' };

  const normalized = input.replace(/\s+/g, '').toLowerCase();

  for (const [keyword, freq] of Object.entries(FREQUENCY_KEYWORD_MAP)) {
    if (normalized.includes(keyword.replace(/\s+/g, ''))) {
      return { frequency: freq, note: input };
    }
  }

  return { frequency: 'CUSTOM', note: input };
}

// ═══════════════════════════════════════════════════════════
//  5. 의사 매칭
// ═══════════════════════════════════════════════════════════

export async function matchDoctor(
  doctorName?: string,
  department?: string,
): Promise<{ id: string; name: string; specialty: string | null; clinicRoomId: string | null } | null> {
  if (!doctorName && !department) return null;

  const where: any = { isActive: true, deletedAt: null };
  if (doctorName) where.name = { contains: doctorName };
  if (department) where.specialty = { contains: department };

  const doctor = await prisma.doctor.findFirst({
    where,
    include: { clinicRooms: { where: { isActive: true }, take: 1 } },
  });

  if (!doctor) return null;

  return {
    id: doctor.id,
    name: doctor.name,
    specialty: doctor.specialty,
    clinicRoomId: doctor.clinicRooms[0]?.id || null,
  };
}
