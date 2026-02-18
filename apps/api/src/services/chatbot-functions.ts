/**
 * AI 챗봇 Function Calling 함수 정의 + 구현 (Phase 7)
 * Gemini 2.5 Flash Function Calling 형식
 * READ 14개 + WRITE 6개 = 총 20개
 */
import { SchemaType } from '@google/generative-ai';
import { prisma } from '../lib/prisma';

// ═══════════════════════════════════════════════════════════
//  READ 함수 구현 (14개)
// ═══════════════════════════════════════════════════════════

// ─── 1. 베드 현황 ───
export async function getAvailableBeds(args: Record<string, any> = {}) {
  const where: any = { deletedAt: null, isActive: true };
  if (args.wardName) {
    where.room = { ward: { name: { contains: args.wardName } } };
  }

  const beds = await prisma.bed.findMany({
    where,
    include: { room: { include: { ward: true } } },
  });

  const byStatus: Record<string, number> = {};
  for (const bed of beds) {
    byStatus[bed.status] = (byStatus[bed.status] || 0) + 1;
  }

  const emptyBeds = beds
    .filter((b) => b.status === 'EMPTY')
    .map((b) => `${b.room.ward.name} ${b.room.name}-${b.label}`);

  return { total: beds.length, byStatus, emptyBeds, emptyCount: emptyBeds.length };
}

// ─── 2. 오늘 외래 예약 ───
export async function getTodayAppointments(args: Record<string, any> = {}) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const where: any = { startAt: { gte: todayStart, lt: todayEnd }, deletedAt: null };
  if (args.department) {
    where.doctor = { specialty: { contains: args.department } };
  }

  const appointments = await prisma.appointment.findMany({
    where,
    include: {
      patient: { select: { name: true, emrPatientId: true } },
      doctor: { select: { name: true, specialty: true } },
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
      emrId: a.patient.emrPatientId,
      doctor: a.doctor.name,
      department: a.doctor.specialty,
      room: a.clinicRoom?.name || '-',
      status: a.status,
    })),
  };
}

// ─── 3. 입원 현황 ───
export async function getAdmissionSummary() {
  const admissions = await prisma.admission.findMany({
    where: { deletedAt: null, status: { not: 'DISCHARGED' } },
    include: {
      patient: { select: { name: true, emrPatientId: true } },
      currentBed: { include: { room: { include: { ward: true } } } },
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

// ─── 4. 오늘 처치 현황 ───
export async function getTodayProcedures(args: Record<string, any> = {}) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const where: any = { scheduledAt: { gte: todayStart, lt: todayEnd }, deletedAt: null };
  if (args.procedureType) {
    where.plan = { procedureCatalog: { name: { contains: args.procedureType } } };
  }

  const executions = await prisma.procedureExecution.findMany({
    where,
    include: {
      plan: {
        include: {
          procedureCatalog: { select: { name: true, category: true, code: true } },
          admission: { include: { patient: { select: { name: true } } } },
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

// ─── 5. 미완료 처치 ───
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
          admission: { include: { patient: { select: { name: true } } } },
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

// ─── 6. 승인 대기 의견서 ───
export async function getPendingReports() {
  const reports = await prisma.aiReport.findMany({
    where: { status: { in: ['DRAFT', 'AI_REVIEWED'] }, deletedAt: null },
    include: { patient: { select: { name: true } } },
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

// ─── 7. 환자 검색 ───
export async function searchPatient(args: Record<string, any>) {
  const searchTerm = args.name || '';
  const patients = await prisma.patient.findMany({
    where: { name: { contains: searchTerm }, deletedAt: null },
    include: {
      admissions: {
        where: { deletedAt: null, status: { not: 'DISCHARGED' } },
        include: { currentBed: { include: { room: { include: { ward: true } } } } },
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
        id: p.id,
        name: p.name,
        emrId: p.emrPatientId,
        dob: p.dob,
        status: p.status,
        currentAdmission: adm
          ? {
              admissionId: adm.id,
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

// ─── 8. 업무함 미처리 알림 ───
export async function getUnreadInboxItems(userId: string) {
  const items = await prisma.inboxItem.findMany({
    where: { ownerId: userId, status: { in: ['UNREAD', 'IN_REVIEW'] } },
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

// ─── 9. 특정 날짜 외래예약 ───
export async function getAppointmentsByDate(args: Record<string, any>) {
  const dateStr = args.date;
  const dayStart = new Date(dateStr + 'T00:00:00+09:00');
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const where: any = { startAt: { gte: dayStart, lt: dayEnd }, deletedAt: null };
  if (args.department) {
    where.doctor = { specialty: { contains: args.department } };
  }
  if (args.doctorName) {
    where.doctor = { ...where.doctor, name: { contains: args.doctorName } };
  }

  const appointments = await prisma.appointment.findMany({
    where,
    include: {
      patient: { select: { name: true, emrPatientId: true } },
      doctor: { select: { name: true, specialty: true } },
      clinicRoom: { select: { name: true } },
    },
    orderBy: { startAt: 'asc' },
  });

  return {
    date: dateStr,
    total: appointments.length,
    appointments: appointments.map((a) => ({
      id: a.id,
      time: `${new Date(a.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} - ${new Date(a.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
      patient: a.patient.name,
      doctor: a.doctor.name,
      department: a.doctor.specialty,
      room: a.clinicRoom?.name || '-',
      status: a.status,
    })),
  };
}

// ─── 10. 특정 날짜 처치 ───
export async function getProceduresByDate(args: Record<string, any>) {
  const dateStr = args.date;
  const dayStart = new Date(dateStr + 'T00:00:00+09:00');
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const where: any = { scheduledAt: { gte: dayStart, lt: dayEnd }, deletedAt: null };
  if (args.procedureType) {
    where.plan = { procedureCatalog: { name: { contains: args.procedureType } } };
  }

  const executions = await prisma.procedureExecution.findMany({
    where,
    include: {
      plan: {
        include: {
          procedureCatalog: { select: { name: true, code: true } },
          admission: { include: { patient: { select: { name: true } } } },
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  return {
    date: dateStr,
    total: executions.length,
    executions: executions.map((e) => ({
      time: new Date(e.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      procedure: e.plan.procedureCatalog.name,
      patient: e.plan.admission.patient.name,
      status: e.status,
    })),
  };
}

// ─── 11. 환자별 전체 일정 ───
export async function getPatientSchedule(args: Record<string, any>) {
  const patients = await prisma.patient.findMany({
    where: { name: { contains: args.patientName }, deletedAt: null, status: 'ACTIVE' },
    take: 5,
  });

  if (patients.length === 0) return { error: `"${args.patientName}" 환자를 찾을 수 없습니다.` };
  if (patients.length > 1) {
    return {
      disambiguation: true,
      patients: patients.map((p) => ({ id: p.id, name: p.name, emrId: p.emrPatientId, dob: p.dob })),
    };
  }

  const patient = patients[0];
  const fromDate = args.fromDate ? new Date(args.fromDate + 'T00:00:00+09:00') : new Date();
  const toDate = args.toDate
    ? new Date(args.toDate + 'T23:59:59+09:00')
    : new Date(fromDate.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [appointments, executions] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: patient.id, startAt: { gte: fromDate, lte: toDate }, deletedAt: null, status: { not: 'CANCELLED' } },
      include: { doctor: { select: { name: true } } },
      orderBy: { startAt: 'asc' },
    }),
    prisma.procedureExecution.findMany({
      where: {
        plan: { admission: { patientId: patient.id } },
        scheduledAt: { gte: fromDate, lte: toDate },
        deletedAt: null,
        status: { not: 'CANCELLED' },
      },
      include: { plan: { include: { procedureCatalog: { select: { name: true } } } } },
      orderBy: { scheduledAt: 'asc' },
    }),
  ]);

  return {
    patient: { name: patient.name, emrId: patient.emrPatientId },
    period: { from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] },
    appointments: appointments.map((a) => ({
      date: new Date(a.startAt).toLocaleDateString('ko-KR'),
      time: new Date(a.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      type: '외래',
      doctor: a.doctor.name,
      status: a.status,
    })),
    procedures: executions.map((e) => ({
      date: new Date(e.scheduledAt).toLocaleDateString('ko-KR'),
      time: new Date(e.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      type: '처치',
      procedure: e.plan.procedureCatalog.name,
      status: e.status,
    })),
  };
}

// ─── 12. 의사별 일정 ───
export async function getDoctorSchedule(args: Record<string, any>) {
  const doctors = await prisma.doctor.findMany({
    where: { name: { contains: args.doctorName }, deletedAt: null, isActive: true },
  });

  if (doctors.length === 0) return { error: `"${args.doctorName}" 의사를 찾을 수 없습니다.` };

  const doctor = doctors[0];
  const dateStr = args.date || new Date().toISOString().split('T')[0];
  const dayStart = new Date(dateStr + 'T00:00:00+09:00');
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, startAt: { gte: dayStart, lt: dayEnd }, deletedAt: null, status: { not: 'CANCELLED' } },
    include: { patient: { select: { name: true } }, clinicRoom: { select: { name: true } } },
    orderBy: { startAt: 'asc' },
  });

  return {
    doctor: { name: doctor.name, specialty: doctor.specialty },
    date: dateStr,
    appointments: appointments.map((a) => ({
      time: `${new Date(a.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} - ${new Date(a.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
      patient: a.patient.name,
      room: a.clinicRoom?.name || '-',
      status: a.status,
    })),
    totalAppointments: appointments.length,
  };
}

// ─── 13. 시간대 가용성 확인 ───
export async function checkTimeSlotAvailability(args: Record<string, any>) {
  const dateStr = args.date;
  const dayStart = new Date(dateStr + 'T00:00:00+09:00');
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const where: any = { startAt: { gte: dayStart, lt: dayEnd }, deletedAt: null, status: { notIn: ['CANCELLED', 'NO_SHOW'] } };
  if (args.doctorName) {
    where.doctor = { name: { contains: args.doctorName } };
  }
  if (args.department) {
    where.doctor = { ...where.doctor, specialty: { contains: args.department } };
  }

  const existingAppointments = await prisma.appointment.findMany({
    where,
    select: { startAt: true, endAt: true, doctor: { select: { name: true } } },
    orderBy: { startAt: 'asc' },
  });

  const bookedSlots = existingAppointments.map((a) => ({
    start: new Date(a.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    end: new Date(a.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    doctor: a.doctor.name,
  }));

  // 빈 시간대 계산 (09:00 ~ 17:00, 30분 단위)
  const availableSlots: string[] = [];
  const bookedTimes = new Set(existingAppointments.map((a) => new Date(a.startAt).getHours() * 60 + new Date(a.startAt).getMinutes()));

  for (let h = 9; h < 17; h++) {
    for (const m of [0, 30]) {
      const minutes = h * 60 + m;
      if (!bookedTimes.has(minutes)) {
        availableSlots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
  }

  let requestedAvailable = true;
  if (args.time) {
    const [rh, rm] = args.time.split(':').map(Number);
    requestedAvailable = !bookedTimes.has(rh * 60 + rm);
  }

  return {
    date: dateStr,
    requestedTime: args.time || null,
    requestedAvailable,
    bookedSlots,
    availableSlots,
    totalBooked: bookedSlots.length,
    totalAvailable: availableSlots.length,
  };
}

// ─── 14. 주간 통계 ───
export async function getWeeklyStats(args: Record<string, any>) {
  const baseDate = args.weekOf ? new Date(args.weekOf + 'T00:00:00+09:00') : new Date();
  const dayOfWeek = baseDate.getDay();
  const weekStart = new Date(baseDate);
  weekStart.setDate(baseDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [appointments, procedures] = await Promise.all([
    prisma.appointment.count({
      where: { startAt: { gte: weekStart, lt: weekEnd }, deletedAt: null },
    }),
    prisma.procedureExecution.count({
      where: { scheduledAt: { gte: weekStart, lt: weekEnd }, deletedAt: null },
    }),
  ]);

  const cancelledAppointments = await prisma.appointment.count({
    where: { startAt: { gte: weekStart, lt: weekEnd }, deletedAt: null, status: 'CANCELLED' },
  });

  const completedProcedures = await prisma.procedureExecution.count({
    where: { scheduledAt: { gte: weekStart, lt: weekEnd }, deletedAt: null, status: 'COMPLETED' },
  });

  return {
    period: {
      from: weekStart.toISOString().split('T')[0],
      to: new Date(weekEnd.getTime() - 1).toISOString().split('T')[0],
    },
    appointments: { total: appointments, cancelled: cancelledAppointments },
    procedures: { total: procedures, completed: completedProcedures },
  };
}

// ═══════════════════════════════════════════════════════════
//  Gemini Function Declarations (20개)
// ═══════════════════════════════════════════════════════════

const S = SchemaType;

// ── 기존 READ 8개 ──
const READ_FUNCTIONS = [
  {
    name: 'getAvailableBeds',
    description: '현재 빈 베드(EMPTY 상태) 현황을 병동별로 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        wardName: { type: S.STRING, description: '병동명 필터 (선택)' },
      },
    },
  },
  {
    name: 'getTodayAppointments',
    description: '오늘 외래 예약 목록을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        department: { type: S.STRING, description: '진료과 필터 (선택)' },
      },
    },
  },
  {
    name: 'getAdmissionSummary',
    description: '현재 입원 현황 요약 (재원, 퇴원예정, 전실예정).',
    parameters: { type: S.OBJECT, properties: {} },
  },
  {
    name: 'getTodayProcedures',
    description: '오늘 예정된 처치 목록 (RF, O2, 도수, 주사 등).',
    parameters: {
      type: S.OBJECT,
      properties: {
        procedureType: { type: S.STRING, description: '처치종류 (선택)' },
      },
    },
  },
  {
    name: 'getPendingProcedures',
    description: '지연되거나 대기 중인 처치를 조회합니다.',
    parameters: { type: S.OBJECT, properties: {} },
  },
  {
    name: 'getPendingReports',
    description: '대기 중인 AI 소견서 목록.',
    parameters: { type: S.OBJECT, properties: {} },
  },
  {
    name: 'searchPatient',
    description: '환자를 이름 또는 환자번호로 검색합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        name: { type: S.STRING, description: '환자 이름 또는 환자번호' },
      },
      required: ['name'],
    },
  },
  {
    name: 'getUnreadInboxItems',
    description: '현재 사용자의 미읽은 업무함 항목.',
    parameters: { type: S.OBJECT, properties: {} },
  },
];

// ── 신규 READ 6개 ──
const NEW_READ_FUNCTIONS = [
  {
    name: 'getAppointmentsByDate',
    description: '특정 날짜의 외래예약 목록을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD' },
        department: { type: S.STRING, description: '진료과 (선택)' },
        doctorName: { type: S.STRING, description: '담당의 (선택)' },
      },
      required: ['date'],
    },
  },
  {
    name: 'getProceduresByDate',
    description: '특정 날짜의 처치예약 목록을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD' },
        procedureType: { type: S.STRING, description: '처치종류 (선택)' },
      },
      required: ['date'],
    },
  },
  {
    name: 'getPatientSchedule',
    description: '환자의 외래예약 + 처치예약 전체 일정을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        fromDate: { type: S.STRING, description: '시작일 (기본: 오늘)' },
        toDate: { type: S.STRING, description: '종료일 (기본: 2주 후)' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'getDoctorSchedule',
    description: '의사의 진료 + 처치 일정을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        doctorName: { type: S.STRING, description: '의사 이름' },
        date: { type: S.STRING, description: '날짜 (기본: 오늘)' },
      },
      required: ['doctorName'],
    },
  },
  {
    name: 'checkTimeSlotAvailability',
    description: '날짜/시간에 예약 가능한지 확인. 충돌 시 빈 시간대 제안.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD' },
        time: { type: S.STRING, description: '시간 HH:MM (선택)' },
        doctorName: { type: S.STRING, description: '의사 (선택)' },
        department: { type: S.STRING, description: '진료과 (선택)' },
      },
      required: ['date'],
    },
  },
  {
    name: 'getWeeklyStats',
    description: '주간 예약/처치 통계 요약.',
    parameters: {
      type: S.OBJECT,
      properties: {
        weekOf: { type: S.STRING, description: '기준 날짜 (기본: 이번주)' },
      },
    },
  },
];

// ── WRITE 6개 ──
const WRITE_FUNCTIONS = [
  {
    name: 'createAppointment',
    description: '외래 진료예약 생성. 정보 부족 시 사용자에게 물어보세요.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        patientId: { type: S.STRING, description: '환자번호 (있으면)' },
        date: { type: S.STRING, description: '예약 날짜 YYYY-MM-DD' },
        time: { type: S.STRING, description: '예약 시간 HH:MM' },
        department: { type: S.STRING, description: '진료과' },
        doctorName: { type: S.STRING, description: '담당의 (선택)' },
        memo: { type: S.STRING, description: '특이사항 (선택)' },
      },
      required: ['patientName', 'date', 'time', 'department'],
    },
  },
  {
    name: 'modifyAppointment',
    description: '외래예약 변경 (날짜, 시간, 담당의).',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        originalDate: { type: S.STRING, description: '원래 예약 날짜' },
        newDate: { type: S.STRING, description: '새 날짜' },
        newTime: { type: S.STRING, description: '새 시간' },
        newDoctor: { type: S.STRING, description: '새 담당의' },
        reason: { type: S.STRING, description: '변경 사유' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'cancelAppointment',
    description: '외래예약 취소.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '예약 날짜' },
        reason: { type: S.STRING, description: '취소 사유' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'createProcedurePlan',
    description: '처치예약 생성. 도수/RF/O2/주사 등.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        procedureName: { type: S.STRING, description: '처치명' },
        date: { type: S.STRING, description: '시작일 YYYY-MM-DD' },
        time: { type: S.STRING, description: '시간 HH:MM' },
        frequency: { type: S.STRING, description: '반복 (매일,주3회,격일 등)' },
        totalSessions: { type: S.NUMBER, description: '총 횟수 (선택)' },
        memo: { type: S.STRING, description: '특이사항 (선택)' },
      },
      required: ['patientName', 'procedureName', 'date'],
    },
  },
  {
    name: 'modifyProcedurePlan',
    description: '처치예약 변경.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        procedureName: { type: S.STRING, description: '처치명' },
        newDate: { type: S.STRING, description: '새 날짜' },
        newTime: { type: S.STRING, description: '새 시간' },
        newFrequency: { type: S.STRING, description: '새 반복 주기' },
        reason: { type: S.STRING, description: '변경 사유' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'cancelProcedurePlan',
    description: '처치예약 취소.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        procedureName: { type: S.STRING, description: '처치명' },
        date: { type: S.STRING, description: '예약 날짜' },
        reason: { type: S.STRING, description: '취소 사유' },
      },
      required: ['patientName'],
    },
  },
];

// ── 전체 합치기 ──
export const ALL_FUNCTION_DECLARATIONS = [
  ...READ_FUNCTIONS,
  ...NEW_READ_FUNCTIONS,
  ...WRITE_FUNCTIONS,
];

// ── WRITE 함수명 Set (분기 판별용) ──
export const WRITE_FUNCTION_NAMES = new Set([
  'createAppointment', 'modifyAppointment', 'cancelAppointment',
  'createProcedurePlan', 'modifyProcedurePlan', 'cancelProcedurePlan',
]);

// ═══════════════════════════════════════════════════════════
//  READ Function 실행기
// ═══════════════════════════════════════════════════════════

export async function executeFunction(
  name: string,
  args: Record<string, any>,
  userId: string,
): Promise<any> {
  switch (name) {
    case 'getAvailableBeds':
      return getAvailableBeds(args);
    case 'getTodayAppointments':
      return getTodayAppointments(args);
    case 'getAdmissionSummary':
      return getAdmissionSummary();
    case 'getTodayProcedures':
      return getTodayProcedures(args);
    case 'getPendingProcedures':
      return getPendingProcedures();
    case 'getPendingReports':
      return getPendingReports();
    case 'searchPatient':
      return searchPatient(args);
    case 'getUnreadInboxItems':
      return getUnreadInboxItems(userId);
    case 'getAppointmentsByDate':
      return getAppointmentsByDate(args);
    case 'getProceduresByDate':
      return getProceduresByDate(args);
    case 'getPatientSchedule':
      return getPatientSchedule(args);
    case 'getDoctorSchedule':
      return getDoctorSchedule(args);
    case 'checkTimeSlotAvailability':
      return checkTimeSlotAvailability(args);
    case 'getWeeklyStats':
      return getWeeklyStats(args);
    default:
      return { error: `알 수 없는 함수: ${name}` };
  }
}
