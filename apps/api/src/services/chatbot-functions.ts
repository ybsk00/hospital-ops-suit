/**
 * AI 챗봇이 호출할 수 있는 DB 조회 함수들
 * OpenAI Function Calling을 통해 자동 선택됨
 */
import { prisma } from '../lib/prisma';

// ─── 베드 현황 ───
export async function getAvailableBeds() {
  const beds = await prisma.bed.findMany({
    where: { deletedAt: null, isActive: true },
    include: { room: { include: { ward: true } } },
  });

  const byStatus: Record<string, number> = {};
  for (const bed of beds) {
    byStatus[bed.status] = (byStatus[bed.status] || 0) + 1;
  }

  const emptyBeds = beds
    .filter((b) => b.status === 'EMPTY')
    .map((b) => `${b.room.ward.name} ${b.room.name}-${b.label}`);

  return {
    total: beds.length,
    byStatus,
    emptyBeds,
    emptyCount: emptyBeds.length,
  };
}

// ─── 오늘 외래 예약 ───
export async function getTodayAppointments() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: todayStart, lt: todayEnd },
      deletedAt: null,
    },
    include: {
      patient: { select: { name: true, emrPatientId: true } },
      doctor: { select: { name: true } },
      clinicRoom: { select: { name: true } },
    },
    orderBy: { startAt: 'asc' },
  });

  const byStatus: Record<string, number> = {};
  for (const apt of appointments) {
    byStatus[apt.status] = (byStatus[apt.status] || 0) + 1;
  }

  return {
    total: appointments.length,
    byStatus,
    appointments: appointments.map((a) => ({
      time: `${new Date(a.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} - ${new Date(a.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
      patient: a.patient.name,
      doctor: a.doctor.name,
      room: a.clinicRoom?.name || '-',
      status: a.status,
    })),
  };
}

// ─── 입원 현황 ───
export async function getAdmissionSummary() {
  const admissions = await prisma.admission.findMany({
    where: { deletedAt: null, status: { not: 'DISCHARGED' } },
    include: {
      patient: { select: { name: true, emrPatientId: true } },
      currentBed: {
        include: { room: { include: { ward: true } } },
      },
      attendingDoctor: { select: { name: true } },
    },
  });

  const byStatus: Record<string, number> = {};
  for (const adm of admissions) {
    byStatus[adm.status] = (byStatus[adm.status] || 0) + 1;
  }

  return {
    total: admissions.length,
    byStatus,
    patients: admissions.map((a) => ({
      name: a.patient.name,
      emrId: a.patient.emrPatientId,
      status: a.status,
      bed: a.currentBed
        ? `${a.currentBed.room.ward.name} ${a.currentBed.room.name}-${a.currentBed.label}`
        : '미배정',
      doctor: a.attendingDoctor.name,
    })),
  };
}

// ─── 오늘 처치 현황 ───
export async function getTodayProcedures() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const executions = await prisma.procedureExecution.findMany({
    where: {
      scheduledAt: { gte: todayStart, lt: todayEnd },
      deletedAt: null,
    },
    include: {
      plan: {
        include: {
          procedureCatalog: { select: { name: true, category: true } },
          admission: {
            include: { patient: { select: { name: true } } },
          },
        },
      },
      executedBy: { select: { name: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const byStatus: Record<string, number> = {};
  for (const exec of executions) {
    byStatus[exec.status] = (byStatus[exec.status] || 0) + 1;
  }

  return {
    total: executions.length,
    byStatus,
    executions: executions.map((e) => ({
      time: new Date(e.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      procedure: e.plan.procedureCatalog.name,
      category: e.plan.procedureCatalog.category,
      patient: e.plan.admission.patient.name,
      status: e.status,
      executedBy: e.executedBy?.name || null,
    })),
  };
}

// ─── 미완료 처치 ───
export async function getPendingProcedures() {
  const now = new Date();

  const executions = await prisma.procedureExecution.findMany({
    where: {
      scheduledAt: { lte: now },
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      deletedAt: null,
    },
    include: {
      plan: {
        include: {
          procedureCatalog: { select: { name: true } },
          admission: {
            include: { patient: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  return {
    total: executions.length,
    executions: executions.map((e) => ({
      scheduledAt: new Date(e.scheduledAt).toLocaleString('ko-KR'),
      procedure: e.plan.procedureCatalog.name,
      patient: e.plan.admission.patient.name,
      status: e.status,
    })),
  };
}

// ─── 승인 대기 의견서 ───
export async function getPendingReports() {
  const reports = await prisma.aiReport.findMany({
    where: {
      status: { in: ['DRAFT', 'AI_REVIEWED'] },
      deletedAt: null,
    },
    include: {
      patient: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    total: reports.length,
    reports: reports.map((r) => ({
      patient: r.patient.name,
      status: r.status,
      createdAt: new Date(r.createdAt).toLocaleString('ko-KR'),
    })),
  };
}

// ─── 환자 검색 ───
export async function searchPatient(name: string) {
  const patients = await prisma.patient.findMany({
    where: {
      name: { contains: name },
      deletedAt: null,
    },
    include: {
      admissions: {
        where: { deletedAt: null, status: { not: 'DISCHARGED' } },
        include: {
          currentBed: { include: { room: { include: { ward: true } } } },
        },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    take: 10,
  });

  return {
    total: patients.length,
    patients: patients.map((p) => {
      const adm = p.admissions[0];
      return {
        name: p.name,
        emrId: p.emrPatientId,
        status: p.status,
        currentAdmission: adm
          ? {
              status: adm.status,
              bed: adm.currentBed
                ? `${adm.currentBed.room.ward.name} ${adm.currentBed.room.name}-${adm.currentBed.label}`
                : '미배정',
            }
          : null,
      };
    }),
  };
}

// ─── 업무함 미처리 알림 ───
export async function getUnreadInboxItems(userId: string) {
  const items = await prisma.inboxItem.findMany({
    where: {
      ownerId: userId,
      status: { in: ['UNREAD', 'IN_REVIEW'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return {
    total: items.length,
    items: items.map((i) => ({
      type: i.type,
      title: i.title,
      summary: i.summary,
      priority: i.priority,
      createdAt: new Date(i.createdAt).toLocaleString('ko-KR'),
    })),
  };
}

// ─── Function Definitions (OpenAI 스키마) ───
export const chatFunctionDefinitions = [
  {
    name: 'getAvailableBeds',
    description: '현재 병원 베드 현황을 조회합니다. 빈 베드, 점유 베드, 격리 베드 등의 상태를 확인합니다.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'getTodayAppointments',
    description: '오늘 외래 예약 목록을 조회합니다. 환자명, 담당의, 시간, 상태를 확인합니다.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'getAdmissionSummary',
    description: '현재 입원 환자 현황을 조회합니다. 입원중, 퇴원예정, 전실예정 등의 상태를 확인합니다.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'getTodayProcedures',
    description: '오늘 예정된 처치 현황을 조회합니다. 처치명, 환자, 상태를 확인합니다.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'getPendingProcedures',
    description: '미완료된 처치(예정 시간이 지났으나 완료되지 않은 처치)를 조회합니다.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'getPendingReports',
    description: '승인 대기 중인 AI 의견서를 조회합니다.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'searchPatient',
    description: '환자명으로 환자를 검색합니다. 입원 상태, 배정된 베드 정보를 포함합니다.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '검색할 환자 이름' },
      },
      required: ['name'],
    },
  },
  {
    name: 'getUnreadInboxItems',
    description: '사용자의 미처리 업무함 알림을 조회합니다.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

// ─── Function 실행기 ───
export async function executeFunction(
  name: string,
  args: Record<string, any>,
  userId: string,
): Promise<any> {
  switch (name) {
    case 'getAvailableBeds':
      return getAvailableBeds();
    case 'getTodayAppointments':
      return getTodayAppointments();
    case 'getAdmissionSummary':
      return getAdmissionSummary();
    case 'getTodayProcedures':
      return getTodayProcedures();
    case 'getPendingProcedures':
      return getPendingProcedures();
    case 'getPendingReports':
      return getPendingReports();
    case 'searchPatient':
      return searchPatient(args.name);
    case 'getUnreadInboxItems':
      return getUnreadInboxItems(userId);
    default:
      return { error: `알 수 없는 함수: ${name}` };
  }
}
