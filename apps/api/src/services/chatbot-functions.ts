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
//  READ: 도수/고주파 스케줄링 (8개)
// ═══════════════════════════════════════════════════════════

// ─── 15. 도수예약 조회 ───
export async function getManualTherapySchedule(args: Record<string, any>) {
  const dateStr = args.date || new Date().toISOString().slice(0, 10);
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));

  const weekDates: string[] = [];
  for (let i = 0; i < 6; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    weekDates.push(dd.toISOString().slice(0, 10));
  }

  const where: any = {
    deletedAt: null,
    date: { gte: new Date(weekDates[0]), lte: new Date(weekDates[5]) },
    status: { not: 'CANCELLED' },
  };

  if (args.therapistName) {
    where.therapist = { name: { contains: args.therapistName } };
  }

  const slots = await prisma.manualTherapySlot.findMany({
    where,
    include: {
      therapist: { select: { name: true } },
      patient: { select: { name: true, emrPatientId: true } },
    },
    orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
  });

  return {
    week: { start: weekDates[0], end: weekDates[5] },
    total: slots.length,
    slots: slots.map(s => ({
      date: s.date.toISOString().slice(0, 10),
      time: s.timeSlot,
      therapist: s.therapist.name,
      patient: s.patient.name,
      treatmentCodes: s.treatmentCodes,
      sessionMarker: s.sessionMarker,
      patientType: s.patientType,
      status: s.status,
    })),
  };
}

// ─── 16. 고주파예약 조회 ───
export async function getRfSchedule(args: Record<string, any>) {
  const dateStr = args.date || new Date().toISOString().slice(0, 10);

  const where: any = {
    deletedAt: null,
    date: new Date(dateStr),
    status: { not: 'CANCELLED' },
  };

  if (args.roomName) {
    where.room = { name: args.roomName };
  }

  const slots = await prisma.rfScheduleSlot.findMany({
    where,
    include: {
      room: { select: { name: true } },
      patient: { select: { name: true, emrPatientId: true } },
      doctor: { select: { doctorCode: true } },
    },
    orderBy: [{ startTime: 'asc' }],
  });

  return {
    date: dateStr,
    total: slots.length,
    slots: slots.map(s => ({
      room: s.room.name + '번',
      patient: s.patient.name,
      chartNumber: s.patient?.emrPatientId || '',
      doctorCode: s.doctor?.doctorCode || '',
      startTime: s.startTime,
      duration: s.duration,
      patientType: s.patientType,
      status: s.status,
    })),
  };
}

// ─── 17. 치료사 빈 슬롯 확인 ───
export async function getTherapistAvailability(args: Record<string, any>) {
  const dateStr = args.date || new Date().toISOString().slice(0, 10);

  const therapistWhere: any = { deletedAt: null, isActive: true, specialty: '도수' };
  if (args.therapistName) {
    therapistWhere.name = { contains: args.therapistName };
  }

  const therapists = await prisma.therapist.findMany({ where: therapistWhere });

  const timeSlots = [
    '09:00','09:30','10:00','10:30','11:00','11:30',
    '12:00','12:30','13:00','13:30',
    '14:00','14:30','15:00','15:30','16:00','16:30',
    '17:00','17:30',
  ];

  const bookedSlots = await prisma.manualTherapySlot.findMany({
    where: {
      date: new Date(dateStr),
      deletedAt: null,
      status: { not: 'CANCELLED' },
      therapistId: { in: therapists.map(t => t.id) },
    },
    select: { therapistId: true, timeSlot: true },
  });

  const bookedMap = new Set(bookedSlots.map(s => `${s.therapistId}:${s.timeSlot}`));

  return {
    date: dateStr,
    therapists: therapists.map(t => ({
      name: t.name,
      availableSlots: timeSlots.filter(ts => !bookedMap.has(`${t.id}:${ts}`)),
      bookedCount: bookedSlots.filter(s => s.therapistId === t.id).length,
      totalSlots: timeSlots.length,
    })),
  };
}

// ─── 18. 고주파 기계 가용성 ───
export async function checkRfAvailability(args: Record<string, any>) {
  const dateStr = args.date || new Date().toISOString().slice(0, 10);

  const rooms = await prisma.rfTreatmentRoom.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
  });

  const existingSlots = await prisma.rfScheduleSlot.findMany({
    where: {
      date: new Date(dateStr),
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
    select: { roomId: true, startTime: true, duration: true },
  });

  function timeToMin(t: string) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  const checkTime = args.time || '09:00';
  const checkDuration = args.duration || 120;
  const checkStart = timeToMin(checkTime);
  const checkEnd = checkStart + checkDuration + 30; // 30분 버퍼

  const availability = rooms.map(room => {
    const roomSlots = existingSlots.filter(s => s.roomId === room.id);
    const hasConflict = roomSlots.some(s => {
      const sStart = timeToMin(s.startTime);
      const sEnd = sStart + s.duration + 30;
      return checkStart < sEnd && sStart < checkEnd;
    });

    return {
      room: room.name + '번',
      available: !hasConflict,
      bookedSlots: roomSlots.length,
    };
  });

  return {
    date: dateStr,
    requestedTime: checkTime,
    requestedDuration: checkDuration,
    availableRooms: availability.filter(a => a.available).map(a => a.room),
    allRooms: availability,
  };
}

// ─── 19. 환자 예약 통합 검색 ───
export async function findPatientBookings(args: Record<string, any>) {
  const name = args.patientName || '';
  const dateStr = args.date; // optional YYYY-MM-DD

  // 환자 검색 (이름 부분 매칭)
  const patients = await prisma.patient.findMany({
    where: { name: { contains: name }, deletedAt: null },
    take: 10,
  });

  // patientName으로 직접 저장된 슬롯도 있으므로 이름 기반 검색 병행
  const patientIds = patients.map(p => p.id);

  // 날짜 조건: 지정 시 해당 날짜, 미지정 시 오늘 이후
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let dateFilter: Date | undefined;
  let dateGte: Date | undefined;
  if (dateStr) {
    dateFilter = new Date(dateStr);
  } else {
    dateGte = today;
  }

  const bookings: Array<{
    type: string;
    date: string;
    time: string;
    detail: string;
    id: string;
  }> = [];

  // ① 도수치료 (ManualTherapySlot) - patientId 또는 patientName
  const mtWhere: any = {
    deletedAt: null,
    status: { not: 'CANCELLED' },
    OR: [
      ...(patientIds.length > 0 ? [{ patientId: { in: patientIds } }] : []),
      { patientName: { contains: name } },
    ],
  };
  if (dateFilter) mtWhere.date = dateFilter;
  else if (dateGte) mtWhere.date = { gte: dateGte };

  const manualSlots = await prisma.manualTherapySlot.findMany({
    where: mtWhere,
    include: { therapist: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { timeSlot: 'asc' }],
    take: 10,
  });

  for (const s of manualSlots) {
    bookings.push({
      type: '도수치료',
      date: s.date.toISOString().slice(0, 10),
      time: s.timeSlot,
      detail: `치료사: ${s.therapist.name}`,
      id: s.id,
    });
  }

  // ② 고주파 (RfScheduleSlot)
  const rfWhere: any = {
    deletedAt: null,
    status: { not: 'CANCELLED' },
    OR: [
      ...(patientIds.length > 0 ? [{ patientId: { in: patientIds } }] : []),
      { patientName: { contains: name } },
    ],
  };
  if (dateFilter) rfWhere.date = dateFilter;
  else if (dateGte) rfWhere.date = { gte: dateGte };

  const rfSlots = await prisma.rfScheduleSlot.findMany({
    where: rfWhere,
    include: { room: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    take: 10,
  });

  for (const s of rfSlots) {
    bookings.push({
      type: '고주파',
      date: s.date.toISOString().slice(0, 10),
      time: s.startTime,
      detail: `${s.room.name}번 기계, ${s.duration}분`,
      id: s.id,
    });
  }

  // ③ 외래예약 (Appointment)
  if (patientIds.length > 0) {
    const aptWhere: any = {
      patientId: { in: patientIds },
      deletedAt: null,
      status: { in: ['BOOKED', 'CHECKED_IN'] },
    };
    if (dateFilter) {
      const dayStart = new Date(dateStr + 'T00:00:00+09:00');
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      aptWhere.startAt = { gte: dayStart, lt: dayEnd };
    } else if (dateGte) {
      aptWhere.startAt = { gte: dateGte };
    }

    const appointments = await prisma.appointment.findMany({
      where: aptWhere,
      include: { doctor: { select: { name: true } } },
      orderBy: { startAt: 'asc' },
      take: 10,
    });

    for (const a of appointments) {
      bookings.push({
        type: '외래예약',
        date: new Date(a.startAt).toISOString().slice(0, 10),
        time: new Date(a.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        detail: `담당의: ${a.doctor.name}`,
        id: a.id,
      });
    }
  }

  // ④ 처치 (ProcedureExecution)
  if (patientIds.length > 0) {
    const procWhere: any = {
      plan: { admission: { patientId: { in: patientIds } } },
      deletedAt: null,
      status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
    };
    if (dateFilter) {
      const dayStart = new Date(dateStr + 'T00:00:00+09:00');
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      procWhere.scheduledAt = { gte: dayStart, lt: dayEnd };
    } else if (dateGte) {
      procWhere.scheduledAt = { gte: dateGte };
    }

    const executions = await prisma.procedureExecution.findMany({
      where: procWhere,
      include: { plan: { include: { procedureCatalog: { select: { name: true } } } } },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    });

    for (const e of executions) {
      bookings.push({
        type: '처치',
        date: new Date(e.scheduledAt).toISOString().slice(0, 10),
        time: new Date(e.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        detail: e.plan.procedureCatalog.name,
        id: e.id,
      });
    }
  }

  // 날짜→시간 순 정렬
  bookings.sort((a, b) => {
    const dateComp = a.date.localeCompare(b.date);
    if (dateComp !== 0) return dateComp;
    return a.time.localeCompare(b.time);
  });

  return {
    patientName: name,
    date: dateStr || '오늘 이후',
    total: bookings.length,
    bookings,
  };
}

// ─── 20. 오늘 전체 스케줄 요약 ───
export async function getTodayScheduleOverview() {
  const today = new Date().toISOString().slice(0, 10);
  const todayDate = new Date(today);

  const [manualSlots, rfSlots, appointments] = await Promise.all([
    prisma.manualTherapySlot.count({
      where: { date: todayDate, deletedAt: null, status: { not: 'CANCELLED' } },
    }),
    prisma.rfScheduleSlot.count({
      where: { date: todayDate, deletedAt: null, status: { not: 'CANCELLED' } },
    }),
    prisma.appointment.count({
      where: {
        startAt: { gte: new Date(today + 'T00:00:00+09:00'), lt: new Date(today + 'T23:59:59+09:00') },
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
    }),
  ]);

  return {
    date: today,
    manualTherapy: manualSlots,
    rfTherapy: rfSlots,
    outpatientAppointments: appointments,
    total: manualSlots + rfSlots + appointments,
  };
}

// ═══════════════════════════════════════════════════════════
//  READ: 병실현황 + 인계장 + 고주파평가 (Phase 8E, 7개)
// ═══════════════════════════════════════════════════════════

function toDateStrChat(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── 21. 병실별 일간 스케줄 ───
export async function getRoomBookingDaily(args: Record<string, any>) {
  const dateStr = args.date || toDateStrChat(new Date());
  const targetDate = new Date(dateStr + 'T00:00:00');
  const nextDate = new Date(targetDate);
  nextDate.setDate(nextDate.getDate() + 1);

  const admissions = await prisma.admission.findMany({
    where: {
      status: { in: ['ADMITTED', 'DISCHARGE_PLANNED', 'ON_LEAVE'] },
      admitDate: { lte: nextDate },
      OR: [{ dischargeDate: null }, { dischargeDate: { gte: targetDate } }],
      deletedAt: null,
    },
    include: {
      patient: { select: { id: true, name: true, emrPatientId: true } },
      attendingDoctor: { select: { name: true } },
      currentBed: { include: { room: true } },
    },
  });

  const [manualSlots, rfSlots] = await Promise.all([
    prisma.manualTherapySlot.findMany({
      where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
      include: { therapist: { select: { name: true } } },
    }),
    prisma.rfScheduleSlot.findMany({
      where: { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null },
      include: { room: { select: { name: true } } },
    }),
  ]);

  const schedMap: Record<string, string[]> = {};
  for (const s of manualSlots) {
    if (s.patientId) {
      if (!schedMap[s.patientId]) schedMap[s.patientId] = [];
      schedMap[s.patientId].push(`${s.timeSlot} 도수(${s.therapist.name})`);
    }
  }
  for (const s of rfSlots) {
    if (s.patientId) {
      if (!schedMap[s.patientId]) schedMap[s.patientId] = [];
      schedMap[s.patientId].push(`${s.startTime} 고주파(${s.room.name}번)`);
    }
  }

  const rooms = admissions.map(adm => ({
    room: adm.currentBed?.room?.name || '미배정',
    bed: adm.currentBed?.label || '-',
    patient: adm.patient.name,
    chartNumber: adm.patient.emrPatientId,
    doctor: adm.attendingDoctor?.name,
    schedules: schedMap[adm.patient.id] || [],
  }));

  return { date: dateStr, totalPatients: rooms.length, rooms };
}

// ─── 22. 병실 가용성 ───
export async function getRoomAvailability() {
  const rooms = await prisma.room.findMany({
    where: { isActive: true, deletedAt: null },
    include: {
      beds: {
        where: { isActive: true, deletedAt: null },
        include: {
          currentAdmission: {
            select: { plannedDischargeDate: true, patient: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const result = rooms.map(r => {
    const beds = r.beds.map(b => {
      if (b.status === 'EMPTY') return { bed: b.label, status: '입실 가능' };
      if (b.status === 'OCCUPIED' && b.currentAdmission) {
        const discharge = b.currentAdmission.plannedDischargeDate;
        return {
          bed: b.label,
          status: '입원중',
          patient: b.currentAdmission.patient?.name,
          availableDate: discharge ? toDateStrChat(new Date(discharge)) : '미정',
        };
      }
      return { bed: b.label, status: b.status };
    });
    const empty = beds.filter(b => b.status === '입실 가능').length;
    return { room: r.name, capacity: r.capacity, emptyBeds: empty, beds };
  });

  const totalEmpty = result.reduce((s, r) => s + r.emptyBeds, 0);
  return { totalEmpty, rooms: result };
}

// ─── 23. 월간 입원/퇴원 카운트 ───
export async function getRoomBookingMonthly(args: Record<string, any>) {
  const now = new Date();
  const year = parseInt(args.year) || now.getFullYear();
  const month = parseInt(args.month) || (now.getMonth() + 1);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();

  const admissions = await prisma.admission.findMany({
    where: {
      admitDate: { lt: endDate },
      OR: [{ dischargeDate: null }, { dischargeDate: { gte: startDate } }],
      deletedAt: null,
    },
    select: { admitDate: true, dischargeDate: true },
  });

  const days: Array<{ date: string; inHospital: number; admitted: number; discharged: number }> = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d = toDateStrChat(new Date(year, month - 1, day));
    let inHospital = 0, admitted = 0, discharged = 0;
    for (const a of admissions) {
      const ad = toDateStrChat(new Date(a.admitDate));
      const dd = a.dischargeDate ? toDateStrChat(new Date(a.dischargeDate)) : null;
      if (ad <= d && (!dd || dd >= d)) inHospital++;
      if (ad === d) admitted++;
      if (dd === d) discharged++;
    }
    days.push({ date: d, inHospital, admitted, discharged });
  }

  return { year, month, days };
}

// ─── 24. 인계장 조회 ───
export async function getHandoverDaily(args: Record<string, any>) {
  const dateStr = args.date || toDateStrChat(new Date());
  const targetDate = new Date(dateStr + 'T00:00:00');
  const nextDate = new Date(targetDate);
  nextDate.setDate(nextDate.getDate() + 1);

  const admissions = await prisma.admission.findMany({
    where: {
      status: { in: ['ADMITTED', 'DISCHARGE_PLANNED', 'ON_LEAVE'] },
      admitDate: { lte: nextDate },
      OR: [{ dischargeDate: null }, { dischargeDate: { gte: targetDate } }],
      deletedAt: null,
    },
    include: {
      patient: { select: { id: true, name: true, emrPatientId: true, clinicalInfo: true } },
      attendingDoctor: { select: { name: true } },
      currentBed: { include: { room: true } },
    },
  });

  const entries = await prisma.handoverEntry.findMany({
    where: { date: targetDate, deletedAt: null },
  });
  const entryMap = new Map(entries.map(e => [e.patientId, e]));

  const patients = admissions.map(adm => {
    const e = entryMap.get(adm.patient.id);
    const ci = adm.patient.clinicalInfo;
    return {
      room: adm.currentBed?.room?.name || '미배정',
      name: adm.patient.name,
      chartNumber: adm.patient.emrPatientId,
      doctor: adm.attendingDoctor?.name,
      diagnosis: ci?.diagnosis || '',
      chemoPort: ci?.chemoPort || '',
      bloodDraw: e?.bloodDraw || false,
      chemo: e?.chemoNote || '',
      externalVisit: e?.externalVisit || '',
      outing: e?.outing || '',
      handover: e?.content || '',
    };
  });

  return { date: dateStr, totalPatients: patients.length, patients };
}

// ─── 25. 환자 임상 프로필 조회 ───
export async function getPatientClinicalInfo(args: Record<string, any>) {
  const patient = await prisma.patient.findFirst({
    where: { name: { contains: args.patientName }, deletedAt: null },
    include: { clinicalInfo: true },
  });
  if (!patient) return { error: `"${args.patientName}" 환자를 찾을 수 없습니다.` };
  return {
    name: patient.name,
    chartNumber: patient.emrPatientId,
    clinical: patient.clinicalInfo || { message: '등록된 임상 프로필이 없습니다.' },
  };
}

// ─── 26. 고주파 치료 평가 조회 ───
export async function getRfEvaluations(args: Record<string, any>) {
  const where: any = { deletedAt: null };
  if (args.patientName) {
    where.patient = { name: { contains: args.patientName } };
  }
  if (args.date) {
    const d = new Date(args.date + 'T00:00:00');
    const n = new Date(d); n.setDate(n.getDate() + 1);
    where.evaluatedAt = { gte: d, lt: n };
  }
  if (args.doctor) {
    where.doctorCode = { contains: args.doctor };
  }

  const evals = await prisma.rfTreatmentEvaluation.findMany({
    where,
    include: { patient: { select: { name: true, emrPatientId: true } } },
    orderBy: { evaluatedAt: 'desc' },
    take: 20,
  });

  return {
    total: evals.length,
    evaluations: evals.map(e => ({
      date: e.evaluatedAt.toISOString().slice(0, 10),
      patient: e.patient?.name,
      chartNumber: e.patient?.emrPatientId || '',
      probeType: e.probeType,
      output: e.outputPercent ? `${e.outputPercent}%` : '',
      temperature: e.temperature ? `${e.temperature}℃` : '',
      treatmentTime: e.treatmentTime ? `${e.treatmentTime}분` : '',
      ivTreatment: e.ivTreatment || '',
      patientIssue: e.patientIssue || '',
      doctor: e.doctorCode,
      room: e.roomNumber,
    })),
  };
}

// ─── 27. 회진 준비 데이터 ───
export async function getRoundPrep(args: Record<string, any>) {
  const dateStr = args.date || toDateStrChat(new Date());
  const targetDate = new Date(dateStr + 'T00:00:00');
  const whereSlot: any = { date: targetDate, status: { not: 'CANCELLED' }, deletedAt: null };
  if (args.doctor) whereSlot.doctorCode = { contains: args.doctor };

  const slots = await prisma.rfScheduleSlot.findMany({
    where: whereSlot,
    include: {
      patient: { select: { id: true, name: true, emrPatientId: true, sex: true, dob: true, clinicalInfo: { select: { diagnosis: true } } } },
      room: { select: { name: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  const patientIds = [...new Set(slots.map(s => s.patientId).filter(Boolean))] as string[];
  const recentEvals: Record<string, any[]> = {};
  for (const pid of patientIds) {
    const evals = await prisma.rfTreatmentEvaluation.findMany({
      where: { patientId: pid, deletedAt: null },
      orderBy: { evaluatedAt: 'desc' },
      take: 3,
      select: { evaluatedAt: true, probeType: true, outputPercent: true, temperature: true, patientIssue: true },
    });
    recentEvals[pid] = evals.map(e => ({
      date: e.evaluatedAt.toISOString().slice(0, 10),
      probe: e.probeType, output: e.outputPercent, temp: e.temperature, issue: e.patientIssue,
    }));
  }

  return {
    date: dateStr,
    doctor: args.doctor || '전체',
    patients: slots.map(s => ({
      room: s.room.name,
      name: s.patient?.name,
      chartNumber: s.patient?.emrPatientId,
      diagnosis: s.patient?.clinicalInfo?.diagnosis,
      time: s.startTime,
      duration: s.duration,
      recentEvals: s.patientId ? (recentEvals[s.patientId] || []) : [],
    })),
  };
}

// ═══════════════════════════════════════════════════════════
//  Gemini Function Declarations (45개)
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

// ── 스케줄링 READ 5개 ──
const SCHEDULING_READ_FUNCTIONS = [
  {
    name: 'getManualTherapySchedule',
    description: '도수치료 예약 주간 스케줄을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '기준 날짜 YYYY-MM-DD (해당 주 전체 조회)' },
        therapistName: { type: S.STRING, description: '치료사 이름 필터 (선택)' },
      },
    },
  },
  {
    name: 'getRfSchedule',
    description: '고주파(RF) 치료 예약 일간 스케줄을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (기본: 오늘)' },
        roomName: { type: S.STRING, description: '기계 번호 (선택, 예: "1", "5")' },
      },
    },
  },
  {
    name: 'getTherapistAvailability',
    description: '도수 치료사의 특정 날짜 빈 시간대를 확인합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD' },
        therapistName: { type: S.STRING, description: '치료사 이름 (선택, 없으면 전체)' },
      },
      required: ['date'],
    },
  },
  {
    name: 'checkRfAvailability',
    description: '고주파 기계 가용성을 확인합니다. 빈 기계 목록을 반환.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD' },
        time: { type: S.STRING, description: '시작시간 HH:MM (선택)' },
        duration: { type: S.NUMBER, description: '소요시간(분, 기본 120)' },
      },
      required: ['date'],
    },
  },
  {
    name: 'getTodayScheduleOverview',
    description: '오늘 전체 스케줄 요약 (도수+고주파+외래).',
    parameters: { type: S.OBJECT, properties: {} },
  },
  {
    name: 'findPatientBookings',
    description: '환자의 모든 예약(도수치료, 고주파, 외래예약, 처치)을 통합 검색합니다. 취소/변경 요청 시 예약 유형이 불명확하면 이 함수를 먼저 호출하세요.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (선택, 없으면 오늘 이후 전체)' },
      },
      required: ['patientName'],
    },
  },
];

// ── 스케줄링 WRITE 4개 ──
const SCHEDULING_WRITE_FUNCTIONS = [
  {
    name: 'createManualTherapySlot',
    description: '도수치료 예약을 생성합니다. "도수", "도수치료", "도수 예약" 요청은 반드시 이 함수를 사용하세요. createProcedurePlan이 아닌 이 함수입니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD' },
        time: { type: S.STRING, description: '시간 HH:MM' },
        therapistName: { type: S.STRING, description: '치료사 이름 (선택, 없으면 자동배정)' },
        treatmentCodes: { type: S.ARRAY, items: { type: S.STRING }, description: '치료코드 배열 (선택: 온열,림프,페인,도수,SC)' },
        sessionMarker: { type: S.STRING, description: '세션마커 (선택: IN,IN20,W1,W2,LTU,신환,재진)' },
        patientType: { type: S.STRING, description: 'INPATIENT 또는 OUTPATIENT' },
        dob: { type: S.STRING, description: '환자 생년월일 YYYY-MM-DD (동명이인 구분용, 시스템이 요청했을 때만)' },
        useExistingPatient: { type: S.BOOLEAN, description: '기존 등록 환자와 동일인 확인 (시스템이 동명이인 질문 후 사용자가 같은 사람이라 답했을 때 true)' },
      },
      required: ['patientName', 'date', 'time'],
    },
  },
  {
    name: 'cancelManualTherapySlot',
    description: '도수치료 예약을 취소합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (선택)' },
        time: { type: S.STRING, description: '시간 HH:MM (선택)' },
        reason: { type: S.STRING, description: '취소 사유' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'createRfScheduleSlot',
    description: '고주파(RF) 치료 예약을 생성합니다. "고주파", "RF", "온열" 예약 요청은 반드시 이 함수를 사용하세요. createProcedurePlan이 아닌 이 함수입니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD' },
        time: { type: S.STRING, description: '시작시간 HH:MM' },
        duration: { type: S.NUMBER, description: '소요시간(분, 기본 120)' },
        doctorCode: { type: S.STRING, description: '담당의 코드 C 또는 J (선택)' },
        roomName: { type: S.STRING, description: '기계번호 (선택, 없으면 자동배정)' },
        patientType: { type: S.STRING, description: 'INPATIENT 또는 OUTPATIENT' },
        dob: { type: S.STRING, description: '환자 생년월일 YYYY-MM-DD (동명이인 구분용, 시스템이 요청했을 때만)' },
        useExistingPatient: { type: S.BOOLEAN, description: '기존 등록 환자와 동일인 확인 (시스템이 동명이인 질문 후 사용자가 같은 사람이라 답했을 때 true)' },
      },
      required: ['patientName', 'date', 'time'],
    },
  },
  {
    name: 'cancelRfScheduleSlot',
    description: '고주파(RF) 치료 예약을 취소합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 (선택)' },
        reason: { type: S.STRING, description: '취소 사유' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'modifyManualTherapySlot',
    description: '도수치료 예약을 변경합니다. "변경/수정/옮겨줘/바꿔줘" 키워드 시 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '기존 예약 날짜 YYYY-MM-DD (선택)' },
        newDate: { type: S.STRING, description: '새 날짜 YYYY-MM-DD (선택)' },
        newTime: { type: S.STRING, description: '새 시간 HH:MM (선택)' },
        newTherapistName: { type: S.STRING, description: '새 치료사 이름 (선택)' },
        treatmentCodes: { type: S.ARRAY, items: { type: S.STRING }, description: '새 치료코드 배열 (선택)' },
        reason: { type: S.STRING, description: '변경 사유 (선택)' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'modifyRfScheduleSlot',
    description: '고주파(RF) 예약을 변경합니다. "변경/수정/옮겨줘/바꿔줘" 키워드 시 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '기존 예약 날짜 YYYY-MM-DD (선택)' },
        newDate: { type: S.STRING, description: '새 날짜 YYYY-MM-DD (선택)' },
        newTime: { type: S.STRING, description: '새 시작시간 HH:MM (선택)' },
        newRoomName: { type: S.STRING, description: '새 기계번호 (선택)' },
        newDuration: { type: S.NUMBER, description: '새 소요시간 분 (선택)' },
        newDoctorCode: { type: S.STRING, description: '새 담당의 C/J (선택)' },
        reason: { type: S.STRING, description: '변경 사유 (선택)' },
      },
      required: ['patientName'],
    },
  },
];

// ── 기존 WRITE 6개 ──
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
    description: '처치계획 생성. O2(산소치료), 주사, 레이저 전용. 도수치료는 createManualTherapySlot, 고주파/RF는 createRfScheduleSlot을 사용하세요.',
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

// ── Phase 8E: 병실/인계/평가 (READ 7 + WRITE 5) ──
const PHASE8E_READ_FUNCTIONS = [
  {
    name: 'getRoomBookingDaily',
    description: '특정 날짜의 병실별 치료 스케줄과 환자 현황을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (기본: 오늘)' },
      },
    },
  },
  {
    name: 'getRoomAvailability',
    description: '현재 입실 가능한 병실과 언제 비는지 조회합니다. "빈 방", "입실 가능", "병실 현황" 등의 질문에 사용.',
    parameters: { type: S.OBJECT, properties: {} },
  },
  {
    name: 'getRoomBookingMonthly',
    description: '월간 입원/퇴원/재원 카운트를 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        year: { type: S.NUMBER, description: '연도 (기본: 올해)' },
        month: { type: S.NUMBER, description: '월 (기본: 이번달)' },
      },
    },
  },
  {
    name: 'getHandoverDaily',
    description: '특정 날짜의 인계장(간호 인수인계 기록)을 조회합니다. "인계", "인계사항", "인계장" 등의 질문에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (기본: 오늘)' },
      },
    },
  },
  {
    name: 'getPatientClinicalInfo',
    description: '환자의 임상 프로필(진단명, 수술이력, 항암이력, 케모포트 등)을 조회합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'getRfEvaluations',
    description: '고주파 치료 평가 기록을 조회합니다. "고주파 후기", "치료 평가", "환자 이슈" 등의 질문에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름 (선택)' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (선택)' },
        doctor: { type: S.STRING, description: '담당의 (선택)' },
      },
    },
  },
  {
    name: 'getRoundPrep',
    description: '회진 준비 데이터를 조회합니다. 담당의별 당일 RF 환자 목록 + 최근 3회 치료 후기.',
    parameters: {
      type: S.OBJECT,
      properties: {
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (기본: 오늘)' },
        doctor: { type: S.STRING, description: '담당의 이름/코드' },
      },
    },
  },
];

const PHASE8E_WRITE_FUNCTIONS = [
  {
    name: 'createHandoverEntry',
    description: '인계 기록을 생성합니다. "인계 작성", "인계사항 등록" 등의 요청에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (기본: 오늘)' },
        content: { type: S.STRING, description: '인계 내용' },
        bloodDraw: { type: S.BOOLEAN, description: '채혈 여부' },
        chemoNote: { type: S.STRING, description: '항암 메모' },
        externalVisit: { type: S.STRING, description: '외진 예정' },
        outing: { type: S.STRING, description: '외출 메모' },
        returnTime: { type: S.STRING, description: '귀원 시간' },
      },
      required: ['patientName', 'content'],
    },
  },
  {
    name: 'modifyHandoverEntry',
    description: '인계 기록을 수정합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (기본: 오늘)' },
        content: { type: S.STRING, description: '수정할 인계 내용' },
        bloodDraw: { type: S.BOOLEAN, description: '채혈 여부' },
        chemoNote: { type: S.STRING, description: '항암 메모' },
        externalVisit: { type: S.STRING, description: '외진 예정' },
        outing: { type: S.STRING, description: '외출 메모' },
        returnTime: { type: S.STRING, description: '귀원 시간' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'cancelHandoverEntry',
    description: '인계 기록을 삭제합니다.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        date: { type: S.STRING, description: '날짜 YYYY-MM-DD (기본: 오늘)' },
        reason: { type: S.STRING, description: '삭제 사유' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'updateClinicalInfo',
    description: '환자 임상 프로필을 업데이트합니다. "진단명 등록", "케모포트", "항암이력" 등의 요청에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        diagnosis: { type: S.STRING, description: '진단명' },
        referralHospital: { type: S.STRING, description: '전원 병원' },
        chemoPort: { type: S.STRING, description: '케모포트 상태 (IN/OUT/PICC)' },
        surgeryHistory: { type: S.STRING, description: '수술 이력' },
        metastasis: { type: S.STRING, description: '전이 부위' },
        ctxHistory: { type: S.STRING, description: '항암치료 이력' },
        rtHistory: { type: S.STRING, description: '방사선 이력' },
        bloodDrawSchedule: { type: S.STRING, description: '채혈 스케줄' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'createRfEvaluation',
    description: '고주파 치료 평가를 기록합니다. "고주파 평가 기록", "치료 후기 작성" 등의 요청에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름' },
        probeType: { type: S.STRING, description: '도자 유형 (A 또는 B)' },
        outputPercent: { type: S.NUMBER, description: '출력 %' },
        temperature: { type: S.NUMBER, description: '온도 ℃' },
        treatmentTime: { type: S.NUMBER, description: '처치시간 (분)' },
        ivTreatment: { type: S.STRING, description: '수액처치' },
        patientIssue: { type: S.STRING, description: '환자이슈/후기' },
        doctorCode: { type: S.STRING, description: '담당의 코드' },
        roomNumber: { type: S.STRING, description: '방/기계번호' },
        diagnosis: { type: S.STRING, description: '진단명' },
        patientType: { type: S.STRING, description: 'INPATIENT 또는 OUTPATIENT' },
      },
      required: ['patientName'],
    },
  },
];

// ── Phase 8F: 입원예약 WRITE 함수 (3개) ──
const ADMISSION_WRITE_FUNCTIONS = [
  {
    name: 'createAdmission',
    description: '입원 예약을 생성합니다. "유범석 101호 2/23~2/28 입원 예약해줘", "김아무개 내일 입원 잡아줘" 등의 요청에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름 (필수)' },
        roomName: { type: S.STRING, description: '병실 이름 (예: "101호", "201호")' },
        admitDate: { type: S.STRING, description: '입원일 (YYYY-MM-DD)' },
        plannedDischargeDate: { type: S.STRING, description: '예정 퇴원일 (YYYY-MM-DD)' },
        doctorName: { type: S.STRING, description: '담당의 이름 (미지정 시 자동배정)' },
        notes: { type: S.STRING, description: '비고/메모' },
        dob: { type: S.STRING, description: '생년월일 (YYYY-MM-DD, 동명이인 구분용)' },
        useExistingPatient: { type: S.BOOLEAN, description: '기존 동명 환자 사용 여부' },
      },
      required: ['patientName', 'admitDate'],
    },
  },
  {
    name: 'modifyAdmission',
    description: '기존 입원 예약을 변경합니다. "유범석 입원 3/1로 변경", "유범석 퇴원일 3/5로 수정" 등의 요청에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름 (필수)' },
        newAdmitDate: { type: S.STRING, description: '변경할 입원일 (YYYY-MM-DD)' },
        newDischargeDate: { type: S.STRING, description: '변경할 퇴원예정일 (YYYY-MM-DD)' },
        newRoomName: { type: S.STRING, description: '변경할 병실 이름 (예: "102호")' },
        newDoctorName: { type: S.STRING, description: '변경할 담당의 이름' },
        notes: { type: S.STRING, description: '변경 메모' },
        reason: { type: S.STRING, description: '변경 사유' },
      },
      required: ['patientName'],
    },
  },
  {
    name: 'cancelAdmission',
    description: '입원 예약을 취소(퇴원 처리)합니다. "유범석 입원 취소", "유범석 퇴원 처리해줘" 등의 요청에 사용.',
    parameters: {
      type: S.OBJECT,
      properties: {
        patientName: { type: S.STRING, description: '환자 이름 (필수)' },
        date: { type: S.STRING, description: '입원일 (특정 입원 지정, YYYY-MM-DD)' },
        reason: { type: S.STRING, description: '취소/퇴원 사유' },
      },
      required: ['patientName'],
    },
  },
];

// ── 전체 합치기 (48개) ──
export const ALL_FUNCTION_DECLARATIONS = [
  ...READ_FUNCTIONS,
  ...NEW_READ_FUNCTIONS,
  ...SCHEDULING_READ_FUNCTIONS,
  ...PHASE8E_READ_FUNCTIONS,
  ...WRITE_FUNCTIONS,
  ...SCHEDULING_WRITE_FUNCTIONS,
  ...PHASE8E_WRITE_FUNCTIONS,
  ...ADMISSION_WRITE_FUNCTIONS,
];

// ── WRITE 함수명 Set (분기 판별용) ──
export const WRITE_FUNCTION_NAMES = new Set([
  'createAppointment', 'modifyAppointment', 'cancelAppointment',
  'createProcedurePlan', 'modifyProcedurePlan', 'cancelProcedurePlan',
  'createManualTherapySlot', 'modifyManualTherapySlot', 'cancelManualTherapySlot',
  'createRfScheduleSlot', 'modifyRfScheduleSlot', 'cancelRfScheduleSlot',
  // Phase 8E
  'createHandoverEntry', 'modifyHandoverEntry', 'cancelHandoverEntry',
  'updateClinicalInfo', 'createRfEvaluation',
  // Phase 8F: 입원예약
  'createAdmission', 'modifyAdmission', 'cancelAdmission',
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
    case 'getManualTherapySchedule':
      return getManualTherapySchedule(args);
    case 'getRfSchedule':
      return getRfSchedule(args);
    case 'getTherapistAvailability':
      return getTherapistAvailability(args);
    case 'checkRfAvailability':
      return checkRfAvailability(args);
    case 'getTodayScheduleOverview':
      return getTodayScheduleOverview();
    case 'findPatientBookings':
      return findPatientBookings(args);
    // Phase 8E
    case 'getRoomBookingDaily':
      return getRoomBookingDaily(args);
    case 'getRoomAvailability':
      return getRoomAvailability();
    case 'getRoomBookingMonthly':
      return getRoomBookingMonthly(args);
    case 'getHandoverDaily':
      return getHandoverDaily(args);
    case 'getPatientClinicalInfo':
      return getPatientClinicalInfo(args);
    case 'getRfEvaluations':
      return getRfEvaluations(args);
    case 'getRoundPrep':
      return getRoundPrep(args);
    default:
      return { error: `알 수 없는 함수: ${name}` };
  }
}
