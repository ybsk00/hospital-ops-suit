/**
 * AI 챗봇 WRITE 함수 처리기 (Phase 7)
 *
 * 플로우: 권한 체크 → 검증 → PendingAction 저장 → 확인 카드 반환
 * confirm 시: DB 저장 → WebSocket 알림
 */
import { prisma } from '../lib/prisma';
import { hasPermissionAsync } from '../middleware/rbac';
import {
  matchPatient,
  matchProcedureCatalog,
  checkTimeConflict,
  matchDoctor,
  parseFrequency,
  matchTherapist,
  autoAssignTherapist,
  autoAssignRfRoom,
} from './chatbot-validators';
import { generateExecutionSchedule } from './schedule-generator';
import { emitToDepartment } from '../websocket/index';
import type { PermissionResource, PermissionAction } from '@prisma/client';

// ═══════════════════════════════════════════════════════════
//  권한 매핑
// ═══════════════════════════════════════════════════════════

const FUNCTION_PERMISSION_MAP: Record<string, { resource: PermissionResource; action: PermissionAction }> = {
  createAppointment: { resource: 'APPOINTMENTS', action: 'WRITE' },
  modifyAppointment: { resource: 'APPOINTMENTS', action: 'WRITE' },
  cancelAppointment: { resource: 'APPOINTMENTS', action: 'WRITE' },
  createProcedurePlan: { resource: 'PROCEDURES', action: 'WRITE' },
  modifyProcedurePlan: { resource: 'PROCEDURES', action: 'WRITE' },
  cancelProcedurePlan: { resource: 'PROCEDURES', action: 'WRITE' },
  createManualTherapySlot: { resource: 'SCHEDULING', action: 'WRITE' },
  modifyManualTherapySlot: { resource: 'SCHEDULING', action: 'WRITE' },
  cancelManualTherapySlot: { resource: 'SCHEDULING', action: 'WRITE' },
  createRfScheduleSlot: { resource: 'SCHEDULING', action: 'WRITE' },
  modifyRfScheduleSlot: { resource: 'SCHEDULING', action: 'WRITE' },
  cancelRfScheduleSlot: { resource: 'SCHEDULING', action: 'WRITE' },
};

// ═══════════════════════════════════════════════════════════
//  응답 타입
// ═══════════════════════════════════════════════════════════

export type WriteHandlerResult =
  | {
      type: 'confirm';
      message: string;
      pendingId: string;
      displayData: Record<string, any>;
    }
  | {
      type: 'conflict';
      message: string;
      alternatives: string[];
      displayData: Record<string, any>;
    }
  | {
      type: 'disambiguation';
      message: string;
      patients: Array<{ id: string; name: string; emrId: string | null; dob: Date | null }>;
    }
  | {
      type: 'permissionDenied';
      message: string;
    }
  | {
      type: 'error';
      message: string;
    };

// ═══════════════════════════════════════════════════════════
//  메인 핸들러
// ═══════════════════════════════════════════════════════════

/**
 * WRITE Function Call 처리 메인 로직
 * ① 권한 체크 → ② 환자 매칭 → ③ 카탈로그 매칭(처치) → ④ 시간 충돌 → ⑤ PendingAction
 */
export async function handleWriteFunction(
  functionName: string,
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  console.log(`[ChatbotWrite] Function: ${functionName}, Args:`, JSON.stringify(args));

  // ① 권한 체크
  const requiredPermission = FUNCTION_PERMISSION_MAP[functionName];
  if (!requiredPermission) {
    return { type: 'error', message: `알 수 없는 함수: ${functionName}` };
  }

  const hasPermission = await hasPermissionAsync(user, requiredPermission.resource, requiredPermission.action);
  if (!hasPermission) {
    return {
      type: 'permissionDenied',
      message: '해당 업무는 원무과, 간호부, 진료과에서 처리 가능합니다. 해당 부서에 요청해 주세요.',
    };
  }

  // 함수별 분기
  switch (functionName) {
    case 'createAppointment':
      return handleCreateAppointment(args, user, sessionId);
    case 'modifyAppointment':
      return handleModifyAppointment(args, user, sessionId);
    case 'cancelAppointment':
      return handleCancelAppointment(args, user, sessionId);
    case 'createProcedurePlan':
      return handleCreateProcedurePlan(args, user, sessionId);
    case 'modifyProcedurePlan':
      return handleModifyProcedurePlan(args, user, sessionId);
    case 'cancelProcedurePlan':
      return handleCancelProcedurePlan(args, user, sessionId);
    case 'createManualTherapySlot':
      return handleCreateManualTherapySlot(args, user, sessionId);
    case 'modifyManualTherapySlot':
      return handleModifyManualTherapySlot(args, user, sessionId);
    case 'cancelManualTherapySlot':
      return handleCancelManualTherapySlot(args, user, sessionId);
    case 'createRfScheduleSlot':
      return handleCreateRfScheduleSlot(args, user, sessionId);
    case 'modifyRfScheduleSlot':
      return handleModifyRfScheduleSlot(args, user, sessionId);
    case 'cancelRfScheduleSlot':
      return handleCancelRfScheduleSlot(args, user, sessionId);
    default:
      return { type: 'error', message: `처리할 수 없는 함수: ${functionName}` };
  }
}

// ═══════════════════════════════════════════════════════════
//  외래예약 생성
// ═══════════════════════════════════════════════════════════

async function handleCreateAppointment(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  // ② 환자 매칭
  const patientResult = await matchPatient(args.patientName, args.patientId);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${patientResult.searchTerm}" 환자를 찾을 수 없습니다. 정확한 이름을 확인해 주세요.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 ${patientResult.patients.length}명 있습니다. 해당 환자를 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({
        id: p.id,
        name: p.name,
        emrId: p.emrPatientId,
        dob: p.dob,
      })),
    };
  }

  const patient = patientResult.patient;

  // 의사 매칭
  const doctor = await matchDoctor(args.doctorName, args.department);
  if (!doctor) {
    return { type: 'error', message: `"${args.doctorName || args.department}" 담당 의사를 찾을 수 없습니다.` };
  }

  // ④ 시간 충돌 검사
  const conflictResult = await checkTimeConflict({
    patientId: patient.id,
    doctorId: doctor.id,
    date: args.date,
    time: args.time,
    durationMinutes: 30,
  });

  if (conflictResult.hasConflict) {
    const conflictDetails = conflictResult.conflicts
      .map((c) => `${c.type === 'patient' ? '환자' : '의사'} 기존 예약: ${c.existingTime} (${c.existingWith})`)
      .join(', ');

    return {
      type: 'conflict',
      message: `시간이 겹칩니다. ${conflictDetails}. 다른 시간을 선택해 주세요.`,
      alternatives: conflictResult.alternatives.slice(0, 6),
      displayData: {
        patientName: patient.name,
        doctorName: doctor.name,
        requestedDate: args.date,
        requestedTime: args.time,
        conflicts: conflictResult.conflicts,
      },
    };
  }

  // ⑤ PendingAction 저장
  const displayData = {
    actionLabel: '외래예약 생성',
    patientName: patient.name,
    patientEmrId: patient.emrPatientId,
    doctorName: doctor.name,
    department: doctor.specialty,
    date: args.date,
    time: args.time,
    memo: args.memo || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'createAppointment',
      payload: {
        patientId: patient.id,
        doctorId: doctor.id,
        clinicRoomId: doctor.clinicRoomId,
        date: args.date,
        time: args.time,
        memo: args.memo,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10분
    },
  });

  return {
    type: 'confirm',
    message: `${patient.name} 환자의 ${args.date} ${args.time} ${doctor.name} 선생님 외래예약을 생성합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  외래예약 변경
// ═══════════════════════════════════════════════════════════

async function handleModifyAppointment(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  const patientResult = await matchPatient(args.patientName, args.patientId);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${patientResult.searchTerm}" 환자를 찾을 수 없습니다.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  const patient = patientResult.patient;

  // 기존 예약 찾기
  const where: any = {
    patientId: patient.id,
    deletedAt: null,
    status: { in: ['BOOKED', 'CHECKED_IN'] },
  };

  if (args.originalDate) {
    const dayStart = new Date(args.originalDate + 'T00:00:00+09:00');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    where.startAt = { gte: dayStart, lt: dayEnd };
  }

  const existingApt = await prisma.appointment.findFirst({
    where,
    include: { doctor: { select: { name: true, specialty: true } } },
    orderBy: { startAt: 'asc' },
  });

  if (!existingApt) {
    return { type: 'error', message: `${patient.name} 환자의 해당 예약을 찾을 수 없습니다.` };
  }

  // 새 시간 충돌 검사
  if (args.newDate && args.newTime) {
    const conflictResult = await checkTimeConflict({
      patientId: patient.id,
      doctorId: existingApt.doctorId,
      date: args.newDate,
      time: args.newTime,
      durationMinutes: 30,
    });

    if (conflictResult.hasConflict) {
      return {
        type: 'conflict',
        message: `변경하려는 시간에 다른 예약이 있습니다. 대안 시간을 확인해 주세요.`,
        alternatives: conflictResult.alternatives.slice(0, 6),
        displayData: {
          patientName: patient.name,
          requestedDate: args.newDate,
          requestedTime: args.newTime,
        },
      };
    }
  }

  const displayData = {
    actionLabel: '외래예약 변경',
    patientName: patient.name,
    originalDate: new Date(existingApt.startAt).toLocaleDateString('ko-KR'),
    originalTime: new Date(existingApt.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    newDate: args.newDate || new Date(existingApt.startAt).toISOString().split('T')[0],
    newTime: args.newTime || new Date(existingApt.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    doctorName: existingApt.doctor.name,
    reason: args.reason || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'modifyAppointment',
      payload: {
        appointmentId: existingApt.id,
        newDate: args.newDate,
        newTime: args.newTime,
        newDoctor: args.newDoctor,
        reason: args.reason,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patient.name} 환자의 예약을 변경합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  외래예약 취소
// ═══════════════════════════════════════════════════════════

async function handleCancelAppointment(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  const patientResult = await matchPatient(args.patientName, args.patientId);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${patientResult.searchTerm}" 환자를 찾을 수 없습니다.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  const patient = patientResult.patient;

  const where: any = {
    patientId: patient.id,
    deletedAt: null,
    status: { in: ['BOOKED', 'CHECKED_IN'] },
  };

  if (args.date) {
    const dayStart = new Date(args.date + 'T00:00:00+09:00');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    where.startAt = { gte: dayStart, lt: dayEnd };
  }

  const existingApt = await prisma.appointment.findFirst({
    where,
    include: { doctor: { select: { name: true } } },
    orderBy: { startAt: 'asc' },
  });

  if (!existingApt) {
    return { type: 'error', message: `${patient.name} 환자의 해당 예약을 찾을 수 없습니다.` };
  }

  const displayData = {
    actionLabel: '외래예약 취소',
    patientName: patient.name,
    date: new Date(existingApt.startAt).toLocaleDateString('ko-KR'),
    time: new Date(existingApt.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    doctorName: existingApt.doctor.name,
    reason: args.reason || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'cancelAppointment',
      payload: {
        appointmentId: existingApt.id,
        reason: args.reason,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patient.name} 환자의 ${displayData.date} ${displayData.time} 예약을 취소합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  처치계획 생성
// ═══════════════════════════════════════════════════════════

async function handleCreateProcedurePlan(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  // 도수/고주파는 전용 함수로 안내
  const procName = (args.procedureName || '').toLowerCase();
  if (/도수|수기|물리/.test(procName)) {
    return { type: 'error', message: '도수치료 예약은 createManualTherapySlot 함수를 사용해야 합니다. 다시 시도해 주세요.' };
  }
  if (/고주파|rf|온열/.test(procName)) {
    return { type: 'error', message: '고주파(RF) 예약은 createRfScheduleSlot 함수를 사용해야 합니다. 다시 시도해 주세요.' };
  }

  // 환자 매칭
  const patientResult = await matchPatient(args.patientName, args.patientId);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${patientResult.searchTerm}" 환자를 찾을 수 없습니다.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  const patient = patientResult.patient;

  // 처치 카탈로그 매칭
  const catalogResult = await matchProcedureCatalog(args.procedureName);
  if (catalogResult.status === 'notFound') {
    return {
      type: 'error',
      message: `"${catalogResult.searchTerm}" 처치를 찾을 수 없습니다. 등록된 처치: ${catalogResult.suggestions.join(', ')}`,
    };
  }

  const catalog = catalogResult.catalog;

  // 입원 확인 (처치는 입원 환자에게만)
  const admission = await prisma.admission.findFirst({
    where: { patientId: patient.id, deletedAt: null, status: { not: 'DISCHARGED' } },
    orderBy: { createdAt: 'desc' },
  });

  if (!admission) {
    return { type: 'error', message: `${patient.name} 환자는 현재 입원 중이 아닙니다. 처치계획은 입원 환자만 등록 가능합니다.` };
  }

  // 반복 주기 파싱
  const { frequency, note: frequencyNote } = parseFrequency(args.frequency);

  const displayData = {
    actionLabel: '처치계획 생성',
    patientName: patient.name,
    patientEmrId: patient.emrPatientId,
    procedureName: catalog.name,
    procedureCode: catalog.code,
    date: args.date,
    time: args.time || '09:00',
    frequency: args.frequency || '1회',
    frequencyEnum: frequency,
    totalSessions: args.totalSessions || null,
    memo: args.memo || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'createProcedurePlan',
      payload: {
        patientId: patient.id,
        admissionId: admission.id,
        catalogId: catalog.id,
        date: args.date,
        time: args.time || '09:00',
        frequency,
        frequencyNote,
        totalSessions: args.totalSessions,
        memo: args.memo,
        durationMinutes: catalog.defaultDuration || 30,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const freqLabel = args.frequency || '1회';
  return {
    type: 'confirm',
    message: `${patient.name} 환자의 ${catalog.name} ${freqLabel} 처치를 ${args.date}부터 등록합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  처치계획 변경
// ═══════════════════════════════════════════════════════════

async function handleModifyProcedurePlan(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  const patientResult = await matchPatient(args.patientName, args.patientId);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${patientResult.searchTerm}" 환자를 찾을 수 없습니다.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  const patient = patientResult.patient;

  // 기존 처치계획 찾기
  const where: any = {
    admission: { patientId: patient.id },
    deletedAt: null,
  };

  if (args.procedureName) {
    const catalogResult = await matchProcedureCatalog(args.procedureName);
    if (catalogResult.status === 'found') {
      where.procedureCatalogId = catalogResult.catalog.id;
    }
  }

  const existingPlan = await prisma.procedurePlan.findFirst({
    where,
    include: { procedureCatalog: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  if (!existingPlan) {
    return { type: 'error', message: `${patient.name} 환자의 해당 처치계획을 찾을 수 없습니다.` };
  }

  const displayData = {
    actionLabel: '처치계획 변경',
    patientName: patient.name,
    procedureName: existingPlan.procedureCatalog.name,
    newDate: args.newDate || null,
    newTime: args.newTime || null,
    newFrequency: args.newFrequency || null,
    reason: args.reason || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'modifyProcedurePlan',
      payload: {
        planId: existingPlan.id,
        newDate: args.newDate,
        newTime: args.newTime,
        newFrequency: args.newFrequency,
        reason: args.reason,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patient.name} 환자의 ${existingPlan.procedureCatalog.name} 처치계획을 변경합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  처치계획 취소
// ═══════════════════════════════════════════════════════════

async function handleCancelProcedurePlan(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  const patientResult = await matchPatient(args.patientName, args.patientId);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${patientResult.searchTerm}" 환자를 찾을 수 없습니다.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  const patient = patientResult.patient;

  const where: any = {
    admission: { patientId: patient.id },
    deletedAt: null,
  };

  if (args.procedureName) {
    const catalogResult = await matchProcedureCatalog(args.procedureName);
    if (catalogResult.status === 'found') {
      where.procedureCatalogId = catalogResult.catalog.id;
    }
  }

  const existingPlan = await prisma.procedurePlan.findFirst({
    where,
    include: { procedureCatalog: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  if (!existingPlan) {
    return { type: 'error', message: `${patient.name} 환자의 해당 처치계획을 찾을 수 없습니다.` };
  }

  const displayData = {
    actionLabel: '처치계획 취소',
    patientName: patient.name,
    procedureName: existingPlan.procedureCatalog.name,
    reason: args.reason || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'cancelProcedurePlan',
      payload: {
        planId: existingPlan.id,
        reason: args.reason,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patient.name} 환자의 ${existingPlan.procedureCatalog.name} 처치계획을 취소합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  PendingAction 확인 (confirm)
// ═══════════════════════════════════════════════════════════

export async function confirmPendingAction(
  pendingId: string,
  userId: string,
): Promise<{ success: boolean; message: string; resultId?: string; resultType?: string }> {
  const pending = await prisma.pendingAction.findUnique({
    where: { id: pendingId },
  });

  if (!pending) {
    return { success: false, message: '해당 작업을 찾을 수 없습니다.' };
  }

  if (pending.createdBy !== userId) {
    return { success: false, message: '본인이 요청한 작업만 확인할 수 있습니다.' };
  }

  if (pending.status !== 'PENDING') {
    return { success: false, message: `이미 처리된 작업입니다. (상태: ${pending.status})` };
  }

  if (new Date() > pending.expiresAt) {
    await prisma.pendingAction.update({
      where: { id: pendingId },
      data: { status: 'EXPIRED', resolvedAt: new Date() },
    });
    return { success: false, message: '작업 유효시간(10분)이 만료되었습니다. 다시 요청해 주세요.' };
  }

  const payload = pending.payload as Record<string, any>;

  try {
    let resultId: string;
    let resultType: string;

    switch (pending.actionType) {
      case 'createAppointment': {
        const [h, m] = (payload.time as string).split(':').map(Number);
        const startAt = new Date(payload.date + 'T00:00:00+09:00');
        startAt.setHours(h, m, 0, 0);
        const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);

        const apt = await prisma.appointment.create({
          data: {
            patientId: payload.patientId,
            doctorId: payload.doctorId,
            clinicRoomId: payload.clinicRoomId || undefined,
            startAt,
            endAt,
            status: 'BOOKED',
            source: 'CHATBOT',
            chatSessionId: pending.sessionId,
            inputSource: 'TEXT',
            notes: payload.memo || undefined,
          },
        });

        resultId = apt.id;
        resultType = 'Appointment';

        // WebSocket 알림
        notifyDepartments('booking:created', {
          type: 'appointment',
          id: apt.id,
          patientId: payload.patientId,
          date: payload.date,
          time: payload.time,
        });
        break;
      }

      case 'modifyAppointment': {
        const updateData: any = { source: 'CHATBOT' };

        if (payload.newDate && payload.newTime) {
          const [h, m] = (payload.newTime as string).split(':').map(Number);
          const newStart = new Date(payload.newDate + 'T00:00:00+09:00');
          newStart.setHours(h, m, 0, 0);
          updateData.startAt = newStart;
          updateData.endAt = new Date(newStart.getTime() + 30 * 60 * 1000);
        }

        if (payload.newDoctor) {
          const doctor = await prisma.doctor.findFirst({
            where: { name: { contains: payload.newDoctor }, isActive: true },
          });
          if (doctor) updateData.doctorId = doctor.id;
        }

        await prisma.appointment.update({
          where: { id: payload.appointmentId },
          data: updateData,
        });

        resultId = payload.appointmentId;
        resultType = 'Appointment';

        notifyDepartments('booking:modified', {
          type: 'appointment',
          id: payload.appointmentId,
          reason: payload.reason,
        });
        break;
      }

      case 'cancelAppointment': {
        await prisma.appointment.update({
          where: { id: payload.appointmentId },
          data: { status: 'CANCELLED', notes: payload.reason ? `[취소사유] ${payload.reason}` : undefined },
        });

        resultId = payload.appointmentId;
        resultType = 'Appointment';

        notifyDepartments('booking:cancelled', {
          type: 'appointment',
          id: payload.appointmentId,
          reason: payload.reason,
        });
        break;
      }

      case 'createProcedurePlan': {
        const { frequency, note: frequencyNote } = parseFrequency(payload.frequencyNote);

        const plan = await prisma.procedurePlan.create({
          data: {
            admissionId: payload.admissionId,
            procedureCatalogId: payload.catalogId,
            scheduleRule: { frequency: payload.frequency, time: payload.time },
            startDate: new Date(payload.date + 'T00:00:00+09:00'),
            source: 'CHATBOT',
            frequency: payload.frequency,
            frequencyNote: payload.frequencyNote || undefined,
            chatSessionId: pending.sessionId,
            inputSource: 'TEXT',
            notes: payload.memo || undefined,
          },
        });

        // 실행 스케줄 생성
        const scheduleResult = await generateExecutionSchedule({
          planId: plan.id,
          startDate: payload.date,
          time: payload.time || '09:00',
          frequency: payload.frequency,
          totalSessions: payload.totalSessions,
          durationMinutes: payload.durationMinutes || 30,
        });

        resultId = plan.id;
        resultType = 'ProcedurePlan';

        notifyDepartments('booking:created', {
          type: 'procedure',
          id: plan.id,
          patientId: payload.patientId,
          executionCount: scheduleResult.count,
        });
        break;
      }

      case 'modifyProcedurePlan': {
        const updatePlanData: any = {};

        if (payload.newDate) {
          updatePlanData.startDate = new Date(payload.newDate + 'T00:00:00+09:00');
        }
        if (payload.newFrequency) {
          const parsed = parseFrequency(payload.newFrequency);
          updatePlanData.frequency = parsed.frequency;
          updatePlanData.frequencyNote = parsed.note;
        }

        await prisma.procedurePlan.update({
          where: { id: payload.planId },
          data: updatePlanData,
        });

        resultId = payload.planId;
        resultType = 'ProcedurePlan';

        notifyDepartments('booking:modified', {
          type: 'procedure',
          id: payload.planId,
          reason: payload.reason,
        });
        break;
      }

      case 'cancelProcedurePlan': {
        // 계획 소프트 삭제
        await prisma.procedurePlan.update({
          where: { id: payload.planId },
          data: { deletedAt: new Date() },
        });

        // 미실행 스케줄 일괄 취소
        await prisma.procedureExecution.updateMany({
          where: {
            planId: payload.planId,
            status: 'SCHEDULED',
          },
          data: { status: 'CANCELLED' },
        });

        resultId = payload.planId;
        resultType = 'ProcedurePlan';

        notifyDepartments('booking:cancelled', {
          type: 'procedure',
          id: payload.planId,
          reason: payload.reason,
        });
        break;
      }

      case 'createManualTherapySlot': {
        const slot = await prisma.manualTherapySlot.create({
          data: {
            therapistId: payload.therapistId,
            patientId: payload.patientId,
            patientName: payload.patientName,
            date: new Date(payload.date),
            timeSlot: payload.time,
            treatmentCodes: payload.treatmentCodes || [],
            sessionMarker: payload.sessionMarker || null,
            patientType: payload.patientType || 'INPATIENT',
            source: 'CHATBOT',
            chatSessionId: pending.sessionId,
          },
        });

        resultId = slot.id;
        resultType = 'ManualTherapySlot';

        notifyDepartments('booking:created', {
          type: 'manualTherapy',
          id: slot.id,
          patientId: payload.patientId,
          patientName: payload.patientName,
          date: payload.date,
          time: payload.time,
        });
        break;
      }

      case 'modifyManualTherapySlot': {
        const mtUpdateData: any = { version: { increment: 1 } };
        if (payload.newDate) mtUpdateData.date = new Date(payload.newDate);
        if (payload.newTime) mtUpdateData.timeSlot = payload.newTime;
        if (payload.newTherapistId) mtUpdateData.therapistId = payload.newTherapistId;
        if (payload.treatmentCodes) mtUpdateData.treatmentCodes = payload.treatmentCodes;

        await prisma.manualTherapySlot.update({
          where: { id: payload.slotId },
          data: mtUpdateData,
        });

        resultId = payload.slotId;
        resultType = 'ManualTherapySlot';

        notifyDepartments('booking:modified', {
          type: 'manualTherapy',
          id: payload.slotId,
          reason: payload.reason,
        });
        break;
      }

      case 'cancelManualTherapySlot': {
        await prisma.manualTherapySlot.update({
          where: { id: payload.slotId },
          data: { status: 'CANCELLED', deletedAt: new Date() },
        });

        resultId = payload.slotId;
        resultType = 'ManualTherapySlot';

        notifyDepartments('booking:cancelled', {
          type: 'manualTherapy',
          id: payload.slotId,
          reason: payload.reason,
        });
        break;
      }

      case 'createRfScheduleSlot': {
        const rfSlot = await prisma.rfScheduleSlot.create({
          data: {
            roomId: payload.roomId,
            patientId: payload.patientId,
            patientName: payload.patientName,
            doctorCode: payload.doctorCode,
            date: new Date(payload.date),
            startTime: payload.time,
            duration: payload.duration,
            patientType: payload.patientType || 'INPATIENT',
            source: 'CHATBOT',
            chatSessionId: pending.sessionId,
          },
        });

        resultId = rfSlot.id;
        resultType = 'RfScheduleSlot';

        notifyDepartments('booking:created', {
          type: 'rfTherapy',
          id: rfSlot.id,
          patientId: payload.patientId,
          patientName: payload.patientName,
          date: payload.date,
          time: payload.time,
        });
        break;
      }

      case 'modifyRfScheduleSlot': {
        const rfUpdateData: any = { version: { increment: 1 } };
        if (payload.newDate) rfUpdateData.date = new Date(payload.newDate);
        if (payload.newTime) rfUpdateData.startTime = payload.newTime;
        if (payload.newRoomId) rfUpdateData.roomId = payload.newRoomId;
        if (payload.newDuration) rfUpdateData.duration = payload.newDuration;
        if (payload.newDoctorCode) rfUpdateData.doctorCode = payload.newDoctorCode;

        await prisma.rfScheduleSlot.update({
          where: { id: payload.slotId },
          data: rfUpdateData,
        });

        resultId = payload.slotId;
        resultType = 'RfScheduleSlot';

        notifyDepartments('booking:modified', {
          type: 'rfTherapy',
          id: payload.slotId,
          reason: payload.reason,
        });
        break;
      }

      case 'cancelRfScheduleSlot': {
        await prisma.rfScheduleSlot.update({
          where: { id: payload.slotId },
          data: { status: 'CANCELLED', deletedAt: new Date() },
        });

        resultId = payload.slotId;
        resultType = 'RfScheduleSlot';

        notifyDepartments('booking:cancelled', {
          type: 'rfTherapy',
          id: payload.slotId,
          reason: payload.reason,
        });
        break;
      }

      default:
        return { success: false, message: `알 수 없는 작업 유형: ${pending.actionType}` };
    }

    // PendingAction 상태 업데이트
    await prisma.pendingAction.update({
      where: { id: pendingId },
      data: {
        status: 'CONFIRMED',
        resolvedAt: new Date(),
        resultId,
        resultType,
      },
    });

    return { success: true, message: '작업이 완료되었습니다.', resultId, resultType };
  } catch (err) {
    console.error('[ChatbotWriteHandler] confirm 실패:', err);
    return { success: false, message: '작업 처리 중 오류가 발생했습니다.' };
  }
}

// ═══════════════════════════════════════════════════════════
//  PendingAction 거절 (reject)
// ═══════════════════════════════════════════════════════════

export async function rejectPendingAction(
  pendingId: string,
  userId: string,
): Promise<{ success: boolean; message: string }> {
  const pending = await prisma.pendingAction.findUnique({
    where: { id: pendingId },
  });

  if (!pending) {
    return { success: false, message: '해당 작업을 찾을 수 없습니다.' };
  }

  if (pending.createdBy !== userId) {
    return { success: false, message: '본인이 요청한 작업만 취소할 수 있습니다.' };
  }

  if (pending.status !== 'PENDING') {
    return { success: false, message: `이미 처리된 작업입니다. (상태: ${pending.status})` };
  }

  await prisma.pendingAction.update({
    where: { id: pendingId },
    data: { status: 'CANCELLED', resolvedAt: new Date() },
  });

  return { success: true, message: '작업이 취소되었습니다.' };
}

// ═══════════════════════════════════════════════════════════
//  환자 매칭 + 자동생성 공통 함수
// ═══════════════════════════════════════════════════════════

type PatientResolveResult =
  | { status: 'resolved'; patientId: string; patientName: string; patientEmrId: string | null }
  | { status: 'sameNameCheck'; result: WriteHandlerResult }
  | { status: 'disambiguation'; result: WriteHandlerResult };

/**
 * 환자 검색 → 자동생성/동명이인 처리
 * - 0명: 자동 Patient 생성 (이름만, dob 있으면 포함)
 * - 1명 + 미확인: "동명이인인가요?" 질문
 * - 1명 + useExisting: 기존 환자 사용
 * - 1명 + dob 일치: 기존 환자 사용
 * - 1명 + dob 불일치: 새 Patient 생성
 * - 2명+: 생년월일 포함 disambiguation
 */
async function resolvePatient(args: Record<string, any>): Promise<PatientResolveResult> {
  const name = args.patientName || '';

  // DB에서 같은 이름 환자 검색
  const existingPatients = await prisma.patient.findMany({
    where: { name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, name: true, emrPatientId: true, dob: true },
    orderBy: { createdAt: 'asc' },
  });

  // ── Case 0: 미등록 → 자동 Patient 생성 ──
  if (existingPatients.length === 0) {
    const newPatient = await prisma.patient.create({
      data: {
        name,
        dob: args.dob ? new Date(args.dob + 'T00:00:00+09:00') : null,
      },
    });
    console.log(`[PatientResolve] 신규 환자 생성: ${name} (id: ${newPatient.id})`);
    return {
      status: 'resolved',
      patientId: newPatient.id,
      patientName: newPatient.name,
      patientEmrId: newPatient.emrPatientId,
    };
  }

  // ── Case 1: 동명 1명 ──
  if (existingPatients.length === 1) {
    const existing = existingPatients[0];

    // useExistingPatient=true → 같은 사람 확인됨
    if (args.useExistingPatient) {
      return {
        status: 'resolved',
        patientId: existing.id,
        patientName: existing.name,
        patientEmrId: existing.emrPatientId,
      };
    }

    // dob 제공됨 → 비교
    if (args.dob) {
      const inputDob = args.dob; // "YYYY-MM-DD"
      const existingDob = existing.dob ? existing.dob.toISOString().slice(0, 10) : null;

      if (existingDob === inputDob) {
        // 생년월일 일치 → 기존 환자
        return {
          status: 'resolved',
          patientId: existing.id,
          patientName: existing.name,
          patientEmrId: existing.emrPatientId,
        };
      } else {
        // 생년월일 불일치 → 동명이인, 새 Patient 생성
        const newPatient = await prisma.patient.create({
          data: {
            name,
            dob: new Date(args.dob + 'T00:00:00+09:00'),
          },
        });
        console.log(`[PatientResolve] 동명이인 신규 생성: ${name} (dob: ${args.dob}, id: ${newPatient.id})`);
        return {
          status: 'resolved',
          patientId: newPatient.id,
          patientName: newPatient.name,
          patientEmrId: newPatient.emrPatientId,
        };
      }
    }

    // dob도 useExisting도 없음 → 동명이인 질문
    const dobStr = existing.dob
      ? `${existing.dob.getFullYear()}년 ${existing.dob.getMonth() + 1}월 ${existing.dob.getDate()}일생`
      : '생년월일 미등록';
    return {
      status: 'sameNameCheck',
      result: {
        type: 'error',
        message: `"${existing.name}" 환자가 이미 등록되어 있습니다(${dobStr}). 같은 분이면 "같은 사람"이라고 해주세요. 동명이인이라면 생년월일을 알려주세요. (예: 1990-03-15)`,
      },
    };
  }

  // ── Case 2+: 동명 여러 명 ──
  // dob 제공됨 → 일치하는 환자 찾기
  if (args.dob) {
    const inputDob = args.dob;
    const matched = existingPatients.find(
      p => p.dob && p.dob.toISOString().slice(0, 10) === inputDob,
    );
    if (matched) {
      return {
        status: 'resolved',
        patientId: matched.id,
        patientName: matched.name,
        patientEmrId: matched.emrPatientId,
      };
    }
    // dob 일치 환자 없음 → 새로 생성
    const newPatient = await prisma.patient.create({
      data: {
        name,
        dob: new Date(args.dob + 'T00:00:00+09:00'),
      },
    });
    console.log(`[PatientResolve] 동명이인 다수 중 신규 생성: ${name} (dob: ${args.dob}, id: ${newPatient.id})`);
    return {
      status: 'resolved',
      patientId: newPatient.id,
      patientName: newPatient.name,
      patientEmrId: newPatient.emrPatientId,
    };
  }

  // dob 없음 → 생년월일 포함 disambiguation
  return {
    status: 'disambiguation',
    result: {
      type: 'disambiguation',
      message: `"${name}" 이름의 환자가 ${existingPatients.length}명 있습니다. 선택해 주세요.`,
      patients: existingPatients.map(p => ({
        id: p.id,
        name: p.name,
        emrId: p.emrPatientId,
        dob: p.dob,
      })),
    },
  };
}

// ═══════════════════════════════════════════════════════════
//  도수치료 예약 생성
// ═══════════════════════════════════════════════════════════

async function handleCreateManualTherapySlot(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  // 환자 매칭 + 자동생성
  const patientResolve = await resolvePatient(args);
  if (patientResolve.status === 'sameNameCheck' || patientResolve.status === 'disambiguation') {
    return patientResolve.result;
  }

  const { patientId, patientName, patientEmrId } = patientResolve;

  // 치료사 매칭 또는 자동배정
  let therapist: { id: string; name: string } | null = null;
  if (args.therapistName) {
    const tResult = await matchTherapist(args.therapistName);
    if (tResult.status === 'found') therapist = tResult.therapist;
    else if (tResult.status === 'notFound') {
      return { type: 'error', message: `"${args.therapistName}" 치료사를 찾을 수 없습니다.` };
    }
  }

  if (!therapist) {
    therapist = await autoAssignTherapist(args.date, args.time);
    if (!therapist) {
      return { type: 'error', message: `${args.date} ${args.time}에 가용한 치료사가 없습니다.` };
    }
  }

  // 해당 환자 동시간 도수 예약 충돌 검사
  const existingSlot = await prisma.manualTherapySlot.findFirst({
    where: {
      patientId,
      date: new Date(args.date),
      timeSlot: args.time,
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
  });
  if (existingSlot) {
    return { type: 'error', message: `${patientName} 환자가 ${args.date} ${args.time}에 이미 도수 예약이 있습니다.` };
  }

  const displayData = {
    actionLabel: '도수치료 예약',
    patientName,
    patientEmrId,
    therapistName: therapist.name,
    date: args.date,
    time: args.time,
    treatmentCodes: args.treatmentCodes || [],
    sessionMarker: args.sessionMarker || null,
    patientType: args.patientType || 'INPATIENT',
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'createManualTherapySlot',
      payload: {
        patientId,
        therapistId: therapist.id,
        date: args.date,
        time: args.time,
        treatmentCodes: args.treatmentCodes || [],
        sessionMarker: args.sessionMarker || null,
        patientType: args.patientType || 'INPATIENT',
        patientName,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patientName} 환자를 ${args.date} ${args.time}에 도수치료(${therapist.name}) 예약합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  도수치료 예약 변경
// ═══════════════════════════════════════════════════════════

async function handleModifyManualTherapySlot(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  console.log('[ChatbotWrite] Function: modifyManualTherapySlot, Args:', JSON.stringify(args));

  const patientResult = await matchPatient(args.patientName);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${args.patientName}" 환자를 찾을 수 없습니다.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }
  const patient = patientResult.patient;

  // 기존 슬롯 찾기
  const where: any = {
    patientId: patient.id,
    deletedAt: null,
    status: { not: 'CANCELLED' },
  };
  if (args.date) where.date = new Date(args.date);

  const existingSlot = await prisma.manualTherapySlot.findFirst({
    where,
    include: { therapist: { select: { id: true, name: true } } },
    orderBy: { date: 'asc' },
  });

  if (!existingSlot) {
    return { type: 'error', message: `${patient.name} 환자의 도수치료 예약을 찾을 수 없습니다.` };
  }

  const targetDate = args.newDate || existingSlot.date.toISOString().slice(0, 10);
  const targetTime = args.newTime || existingSlot.timeSlot;

  // 치료사 결정
  let newTherapistId = existingSlot.therapistId;
  let newTherapistName = existingSlot.therapist.name;
  if (args.newTherapistName) {
    const therapistResult = await matchTherapist(args.newTherapistName);
    if (therapistResult.status === 'notFound') {
      return { type: 'error', message: `"${args.newTherapistName}" 치료사를 찾을 수 없습니다.` };
    }
    if (therapistResult.status === 'multiple') {
      return { type: 'error', message: `"${args.newTherapistName}" 치료사가 여러 명입니다. 정확한 이름을 입력해주세요.` };
    }
    newTherapistId = therapistResult.therapist.id;
    newTherapistName = therapistResult.therapist.name;
  } else if (args.newTime || args.newDate) {
    // 시간/날짜 변경 시 기존 치료사 가용성 확인
    const conflict = await prisma.manualTherapySlot.findFirst({
      where: {
        therapistId: existingSlot.therapistId,
        date: new Date(targetDate),
        timeSlot: targetTime,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        id: { not: existingSlot.id },
      },
    });
    if (conflict) {
      // 기존 치료사 불가 → 자동 배정
      const autoResult = await autoAssignTherapist(targetDate, targetTime);
      if (!autoResult) {
        return { type: 'error', message: `${targetDate} ${targetTime}에 가용한 치료사가 없습니다.` };
      }
      newTherapistId = autoResult.id;
      newTherapistName = autoResult.name;
    }
  }

  // 충돌 검사 (새 시간에 다른 슬롯)
  if (args.newTime || args.newDate) {
    const slotConflict = await prisma.manualTherapySlot.findFirst({
      where: {
        therapistId: newTherapistId,
        date: new Date(targetDate),
        timeSlot: targetTime,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        id: { not: existingSlot.id },
      },
    });
    if (slotConflict) {
      return { type: 'error', message: `${newTherapistName} 치료사의 ${targetDate} ${targetTime}에 이미 예약이 있습니다.` };
    }
  }

  const displayData: Record<string, any> = {
    actionLabel: '도수치료 예약 변경',
    patientName: patient.name,
    originalDate: existingSlot.date.toISOString().slice(0, 10),
    originalTime: existingSlot.timeSlot,
    originalTherapist: existingSlot.therapist.name,
    newDate: targetDate,
    newTime: targetTime,
    newTherapist: newTherapistName,
    reason: args.reason || null,
  };
  if (args.treatmentCodes) displayData.treatmentCodes = args.treatmentCodes;

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'modifyManualTherapySlot',
      payload: {
        slotId: existingSlot.id,
        newDate: args.newDate || null,
        newTime: args.newTime || null,
        newTherapistId: newTherapistId !== existingSlot.therapistId ? newTherapistId : null,
        treatmentCodes: args.treatmentCodes || null,
        reason: args.reason || null,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patient.name} 환자의 도수치료 예약을 변경합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  도수치료 예약 취소
// ═══════════════════════════════════════════════════════════

async function handleCancelManualTherapySlot(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  let patientId: string | null = null;
  let patientName = args.patientName || '';

  const patientResult = await matchPatient(args.patientName);
  if (patientResult.status === 'found') {
    patientId = patientResult.patient.id;
    patientName = patientResult.patient.name;
  } else if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map(p => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  // DB 환자 또는 이름 기반으로 슬롯 검색
  const where: any = {
    deletedAt: null,
    status: { not: 'CANCELLED' },
  };
  if (patientId) {
    where.patientId = patientId;
  } else {
    where.patientName = patientName;
  }
  if (args.date) where.date = new Date(args.date);
  if (args.time) where.timeSlot = args.time;

  const slot = await prisma.manualTherapySlot.findFirst({
    where,
    include: { therapist: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  if (!slot) {
    return { type: 'error', message: `${patientName} 환자의 도수 예약을 찾을 수 없습니다.` };
  }

  const displayData = {
    actionLabel: '도수치료 취소',
    patientName: slot.patientName || patientName,
    therapistName: slot.therapist.name,
    date: slot.date.toISOString().slice(0, 10),
    time: slot.timeSlot,
    reason: args.reason || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'cancelManualTherapySlot',
      payload: { slotId: slot.id, reason: args.reason },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${displayData.patientName} 환자의 ${displayData.date} ${displayData.time} 도수치료를 취소합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  고주파 예약 생성
// ═══════════════════════════════════════════════════════════

async function handleCreateRfScheduleSlot(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  // 환자 매칭 + 자동생성
  const patientResolve = await resolvePatient(args);
  if (patientResolve.status === 'sameNameCheck' || patientResolve.status === 'disambiguation') {
    return patientResolve.result;
  }

  const { patientId, patientName, patientEmrId } = patientResolve;

  const duration = args.duration || 120;
  const doctorCode = args.doctorCode || 'C';

  // 기계 배정
  let room: { id: string; name: string } | null = null;
  if (args.roomName) {
    const roomObj = await prisma.rfTreatmentRoom.findFirst({
      where: { name: args.roomName, isActive: true },
    });
    if (roomObj) room = { id: roomObj.id, name: roomObj.name };
    else return { type: 'error', message: `${args.roomName}번 기계를 찾을 수 없습니다.` };
  }

  if (!room) {
    room = await autoAssignRfRoom(args.date, args.time, duration);
    if (!room) {
      return { type: 'error', message: `${args.date} ${args.time}에 가용한 고주파 기계가 없습니다.` };
    }
  }

  // 같은 환자 같은 날 중복 검사
  const existingSlot = await prisma.rfScheduleSlot.findFirst({
    where: {
      patientId,
      date: new Date(args.date),
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
  });
  if (existingSlot) {
    return { type: 'error', message: `${patientName} 환자가 ${args.date}에 이미 고주파 예약이 있습니다.` };
  }

  const displayData = {
    actionLabel: '고주파 예약',
    patientName,
    patientEmrId,
    roomName: room.name + '번',
    doctorCode,
    date: args.date,
    time: args.time,
    duration,
    patientType: args.patientType || 'INPATIENT',
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'createRfScheduleSlot',
      payload: {
        patientId,
        roomId: room.id,
        doctorCode,
        date: args.date,
        time: args.time,
        duration,
        patientType: args.patientType || 'INPATIENT',
        patientName,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patientName} 환자를 ${args.date} ${args.time}에 고주파(${room.name}번, ${duration}분, ${doctorCode}) 예약합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  고주파 예약 변경
// ═══════════════════════════════════════════════════════════

async function handleModifyRfScheduleSlot(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  console.log('[ChatbotWrite] Function: modifyRfScheduleSlot, Args:', JSON.stringify(args));

  const patientResult = await matchPatient(args.patientName);
  if (patientResult.status === 'notFound') {
    return { type: 'error', message: `"${args.patientName}" 환자를 찾을 수 없습니다.` };
  }
  if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }
  const patient = patientResult.patient;

  // 기존 슬롯 찾기
  const where: any = {
    patientId: patient.id,
    deletedAt: null,
    status: { not: 'CANCELLED' },
  };
  if (args.date) where.date = new Date(args.date);

  const existingSlot = await prisma.rfScheduleSlot.findFirst({
    where,
    include: { room: { select: { id: true, name: true } } },
    orderBy: { date: 'asc' },
  });

  if (!existingSlot) {
    return { type: 'error', message: `${patient.name} 환자의 고주파 예약을 찾을 수 없습니다.` };
  }

  const targetDate = args.newDate || existingSlot.date.toISOString().slice(0, 10);
  const targetTime = args.newTime || existingSlot.startTime;
  const targetDuration = args.newDuration || existingSlot.duration;
  const targetDoctorCode = args.newDoctorCode || existingSlot.doctorCode;

  // 기계 결정
  let newRoomId = existingSlot.roomId;
  let newRoomName = existingSlot.room.name;
  if (args.newRoomName) {
    const room = await prisma.rfTreatmentRoom.findFirst({
      where: { name: args.newRoomName, isActive: true },
    });
    if (!room) {
      return { type: 'error', message: `${args.newRoomName}번 기계를 찾을 수 없습니다.` };
    }
    newRoomId = room.id;
    newRoomName = room.name;
  } else if (args.newTime || args.newDate || args.newDuration) {
    // 시간/날짜/소요시간 변경 시 기존 기계 충돌 확인
    const newStartMin = timeToMinutes(targetTime);
    const newEndMin = newStartMin + targetDuration;
    const newBufferEnd = newEndMin + 30;

    const existingSlots = await prisma.rfScheduleSlot.findMany({
      where: {
        roomId: existingSlot.roomId,
        date: new Date(targetDate),
        deletedAt: null,
        status: { not: 'CANCELLED' },
        id: { not: existingSlot.id },
      },
    });

    let hasConflict = false;
    for (const es of existingSlots) {
      const esStartMin = timeToMinutes(es.startTime);
      const esEndMin = esStartMin + es.duration;
      const esBufferEnd = esEndMin + 30;
      if (newStartMin < esBufferEnd && esStartMin < newBufferEnd) {
        hasConflict = true;
        break;
      }
    }

    if (hasConflict) {
      // 기존 기계 불가 → 자동 배정
      const autoRoom = await autoAssignRfRoom(targetDate, targetTime, targetDuration);
      if (!autoRoom) {
        return { type: 'error', message: `${targetDate} ${targetTime}에 ${targetDuration}분 가용한 기계가 없습니다.` };
      }
      newRoomId = autoRoom.id;
      newRoomName = autoRoom.name;
    }
  }

  const displayData: Record<string, any> = {
    actionLabel: '고주파 예약 변경',
    patientName: patient.name,
    originalDate: existingSlot.date.toISOString().slice(0, 10),
    originalTime: existingSlot.startTime,
    originalRoom: existingSlot.room.name + '번',
    originalDuration: existingSlot.duration + '분',
    newDate: targetDate,
    newTime: targetTime,
    newRoom: newRoomName + '번',
    newDuration: targetDuration + '분',
    newDoctorCode: targetDoctorCode,
    reason: args.reason || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'modifyRfScheduleSlot',
      payload: {
        slotId: existingSlot.id,
        newDate: args.newDate || null,
        newTime: args.newTime || null,
        newRoomId: newRoomId !== existingSlot.roomId ? newRoomId : null,
        newDuration: args.newDuration || null,
        newDoctorCode: args.newDoctorCode || null,
        reason: args.reason || null,
      },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${patient.name} 환자의 고주파 예약을 변경합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// timeToMinutes 헬퍼 (rfSchedule.ts와 동일)
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ═══════════════════════════════════════════════════════════
//  고주파 예약 취소
// ═══════════════════════════════════════════════════════════

async function handleCancelRfScheduleSlot(
  args: Record<string, any>,
  user: any,
  sessionId: string,
): Promise<WriteHandlerResult> {
  let patientId: string | null = null;
  let patientName = args.patientName || '';

  const patientResult = await matchPatient(args.patientName);
  if (patientResult.status === 'found') {
    patientId = patientResult.patient.id;
    patientName = patientResult.patient.name;
  } else if (patientResult.status === 'multiple') {
    return {
      type: 'disambiguation',
      message: `"${args.patientName}" 이름의 환자가 여러 명입니다. 선택해 주세요.`,
      patients: patientResult.patients.map(p => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  const where: any = {
    deletedAt: null,
    status: { not: 'CANCELLED' },
  };
  if (patientId) {
    where.patientId = patientId;
  } else {
    where.patientName = patientName;
  }
  if (args.date) where.date = new Date(args.date);

  const slot = await prisma.rfScheduleSlot.findFirst({
    where,
    include: { room: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  if (!slot) {
    return { type: 'error', message: `${patientName} 환자의 고주파 예약을 찾을 수 없습니다.` };
  }

  const displayData = {
    actionLabel: '고주파 취소',
    patientName: slot.patientName || patientName,
    roomName: slot.room.name + '번',
    date: slot.date.toISOString().slice(0, 10),
    time: slot.startTime,
    reason: args.reason || null,
  };

  const pending = await prisma.pendingAction.create({
    data: {
      sessionId,
      actionType: 'cancelRfScheduleSlot',
      payload: { slotId: slot.id, reason: args.reason },
      displayData,
      status: 'PENDING',
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return {
    type: 'confirm',
    message: `${displayData.patientName} 환자의 ${displayData.date} ${displayData.time} 고주파를 취소합니다. 확인해 주세요.`,
    pendingId: pending.id,
    displayData,
  };
}

// ═══════════════════════════════════════════════════════════
//  WebSocket 알림 헬퍼
// ═══════════════════════════════════════════════════════════

async function notifyDepartments(event: string, data: Record<string, any>): Promise<void> {
  try {
    // 원무과, 간호부, 진료과에 알림
    const departments = await prisma.department.findMany({
      where: { code: { in: ['ADMIN_OFFICE', 'NURSING', 'MEDICAL'] }, isActive: true },
      select: { id: true },
    });

    for (const dept of departments) {
      emitToDepartment(dept.id, event, data);
    }
  } catch (err) {
    console.error('[ChatbotWriteHandler] WebSocket 알림 실패:', err);
  }
}
