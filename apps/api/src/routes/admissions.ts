import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/audit';
import { AdmissionStatus } from '@prisma/client';

const router = Router();

// ─── GET /api/admissions/summary ── 요약 (챗봇용) ────────────────────
// NOTE: /summary 는 /:id 보다 먼저 선언해야 라우트 충돌 방지
router.get(
  '/summary',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (_req: Request, res: Response) => {
    const admissions = await prisma.admission.findMany({
      where: { deletedAt: null },
      select: { status: true },
    });

    const byStatus: Record<string, number> = {};
    for (const a of admissions) {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    }

    res.json({
      success: true,
      data: { total: admissions.length, byStatus },
    });
  }),
);

// ─── GET /api/admissions ── 입원 목록 조회 ───────────────────────────
router.get(
  '/',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      status,
      wardId,
      search,
      page: pageRaw,
      limit: limitRaw,
    } = req.query;

    const page = Math.max(1, parseInt(pageRaw as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw as string, 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (status) {
      // 유효한 AdmissionStatus 값인지 확인
      if (!Object.values(AdmissionStatus).includes(status as AdmissionStatus)) {
        throw new AppError(400, 'INVALID_STATUS', `유효하지 않은 상태값입니다: ${status}`);
      }
      where.status = status as AdmissionStatus;
    }

    if (wardId) {
      where.currentBed = {
        room: { wardId: wardId as string },
      };
    }

    if (search) {
      where.patient = {
        name: { contains: search as string, mode: 'insensitive' },
      };
    }

    const [items, total] = await Promise.all([
      prisma.admission.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              emrPatientId: true,
              name: true,
              dob: true,
              sex: true,
              phone: true,
              status: true,
            },
          },
          currentBed: {
            include: {
              room: {
                include: { ward: true },
              },
            },
          },
          attendingDoctor: {
            select: { id: true, name: true, loginId: true },
          },
        },
        orderBy: { admitDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.admission.count({ where }),
    ]);

    res.json({
      success: true,
      data: { items, total, page, limit },
    });
  }),
);

// ─── GET /api/admissions/:id ── 입원 상세 조회 ──────────────────────
router.get(
  '/:id',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const admission = await prisma.admission.findUnique({
      where: { id },
      include: {
        patient: true,
        currentBed: {
          include: {
            room: {
              include: { ward: true },
            },
          },
        },
        attendingDoctor: {
          select: { id: true, name: true, loginId: true, email: true, phone: true },
        },
        bedAssignments: {
          orderBy: { startAt: 'desc' },
          include: {
            bed: {
              include: {
                room: { include: { ward: true } },
              },
            },
          },
        },
        procedurePlans: {
          where: { deletedAt: null },
          include: {
            procedureCatalog: {
              select: { id: true, name: true, category: true },
            },
          },
          orderBy: { startDate: 'desc' },
        },
      },
    });

    if (!admission || admission.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '입원 정보를 찾을 수 없습니다.');
    }

    res.json({ success: true, data: admission });
  }),
);

// ─── POST /api/admissions ── 신규 입원 ──────────────────────────────
const createAdmissionSchema = z.object({
  // 환자 (기존 ID 또는 신규 생성)
  patientId: z.string().uuid().optional(),
  newPatient: z.object({
    name: z.string().min(1).max(100),
    emrPatientId: z.string().min(1).max(50),
    dob: z.string().date().optional(),
    sex: z.enum(['M', 'F', 'U']).optional(),
    phone: z.string().max(20).optional(),
  }).optional(),
  admitDate: z.string().datetime({ offset: true }).or(z.string().date()),
  plannedDischargeDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  attendingDoctorId: z.string().uuid(),
  bedId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  // 예약 상태로 생성 (RESERVED)
  isReservation: z.boolean().optional(),
});

router.post(
  '/',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  auditLog('ADMISSION_CREATE', 'Admission'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createAdmissionSchema.parse(req.body);

    // 환자 ID 또는 신규 환자 정보 중 하나 필요
    if (!body.patientId && !body.newPatient) {
      throw new AppError(400, 'INVALID_REQUEST', '환자 ID 또는 신규 환자 정보가 필요합니다.');
    }

    let patientId = body.patientId;

    // 신규 환자 생성
    if (body.newPatient) {
      // EMR ID 중복 체크
      const existing = await prisma.patient.findUnique({
        where: { emrPatientId: body.newPatient.emrPatientId },
      });
      if (existing && !existing.deletedAt) {
        throw new AppError(400, 'DUPLICATE_EMR_ID', '이미 등록된 차트번호입니다.');
      }

      const newPatient = await prisma.patient.create({
        data: {
          name: body.newPatient.name,
          emrPatientId: body.newPatient.emrPatientId,
          dob: body.newPatient.dob ? new Date(body.newPatient.dob) : new Date('1900-01-01'),
          sex: body.newPatient.sex || 'U',
          phone: body.newPatient.phone || null,
        },
      });
      patientId = newPatient.id;
    } else {
      // 기존 환자 확인
      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
      });
      if (!patient || patient.deletedAt) {
        throw new AppError(404, 'NOT_FOUND', '환자를 찾을 수 없습니다.');
      }
    }

    // 담당의 존재 확인
    const doctor = await prisma.user.findUnique({
      where: { id: body.attendingDoctorId },
    });
    if (!doctor || doctor.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '담당의를 찾을 수 없습니다.');
    }

    // 베드 배정이 있는 경우 처리
    const isReservation = body.isReservation || new Date(body.admitDate) > new Date();

    if (body.bedId) {
      const bed = await prisma.bed.findUnique({ where: { id: body.bedId } });
      if (!bed || bed.deletedAt) {
        throw new AppError(404, 'NOT_FOUND', '베드를 찾을 수 없습니다.');
      }
      if (bed.status !== 'EMPTY' && bed.status !== 'RESERVED') {
        throw new AppError(
          400,
          'BED_NOT_AVAILABLE',
          `해당 베드는 현재 사용할 수 없습니다. (상태: ${bed.status})`,
        );
      }
    }

    const admission = await prisma.$transaction(async (tx) => {
      // 입원 레코드 생성
      const newAdmission = await tx.admission.create({
        data: {
          patientId: patientId!,
          admitDate: new Date(body.admitDate),
          plannedDischargeDate: body.plannedDischargeDate ? new Date(body.plannedDischargeDate) : null,
          attendingDoctorId: body.attendingDoctorId,
          currentBedId: body.bedId ?? null,
          status: isReservation ? AdmissionStatus.DISCHARGE_PLANNED : AdmissionStatus.ADMITTED, // DISCHARGE_PLANNED를 예약용으로 사용
          notes: body.notes ?? null,
        },
        include: {
          patient: true,
          currentBed: { include: { room: { include: { ward: true } } } },
          attendingDoctor: { select: { id: true, name: true, loginId: true } },
        },
      });

      // 베드 상태 갱신 + BedAssignment 생성
      if (body.bedId) {
        await tx.bed.update({
          where: { id: body.bedId },
          data: { status: isReservation ? 'RESERVED' : 'OCCUPIED', version: { increment: 1 } },
        });

        await tx.bedAssignment.create({
          data: {
            admissionId: newAdmission.id,
            bedId: body.bedId,
            startAt: new Date(body.admitDate),
            changedBy: req.user!.id,
          },
        });
      }

      return newAdmission;
    });

    res.locals.auditAfter = { admissionId: admission.id, bedId: body.bedId };

    res.status(201).json({ success: true, data: admission });
  }),
);

// ─── PATCH /api/admissions/:id ── 입원 정보 수정 ────────────────────
const updateAdmissionSchema = z.object({
  status: z.nativeEnum(AdmissionStatus).optional(),
  plannedDischargeDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().date())
    .nullable()
    .optional(),
  attendingDoctorId: z.string().uuid().optional(),
  notes: z.string().max(2000).nullable().optional(),
  version: z.number().int(),
});

router.patch(
  '/:id',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  auditLog('ADMISSION_UPDATE', 'Admission'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = updateAdmissionSchema.parse(req.body);

    const admission = await prisma.admission.findUnique({ where: { id } });
    if (!admission || admission.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '입원 정보를 찾을 수 없습니다.');
    }

    // 낙관적 잠금 버전 확인
    if (admission.version !== body.version) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        '다른 사용자가 이미 변경했습니다. 새로고침 후 재시도하세요.',
      );
    }

    // 담당의 변경 시 존재 확인
    if (body.attendingDoctorId) {
      const doctor = await prisma.user.findUnique({
        where: { id: body.attendingDoctorId },
      });
      if (!doctor || doctor.deletedAt) {
        throw new AppError(404, 'NOT_FOUND', '담당의를 찾을 수 없습니다.');
      }
    }

    res.locals.auditBefore = {
      status: admission.status,
      plannedDischargeDate: admission.plannedDischargeDate,
      attendingDoctorId: admission.attendingDoctorId,
      notes: admission.notes,
      version: admission.version,
    };

    const updateData: any = { version: { increment: 1 } };
    if (body.status !== undefined) updateData.status = body.status;
    if (body.plannedDischargeDate !== undefined) {
      updateData.plannedDischargeDate = body.plannedDischargeDate
        ? new Date(body.plannedDischargeDate)
        : null;
    }
    if (body.attendingDoctorId !== undefined) updateData.attendingDoctorId = body.attendingDoctorId;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const updated = await prisma.admission.update({
      where: { id, version: body.version },
      data: updateData,
      include: {
        patient: true,
        currentBed: { include: { room: { include: { ward: true } } } },
        attendingDoctor: { select: { id: true, name: true, loginId: true } },
      },
    });

    res.locals.auditAfter = {
      status: updated.status,
      plannedDischargeDate: updated.plannedDischargeDate,
      attendingDoctorId: updated.attendingDoctorId,
      notes: updated.notes,
      version: updated.version,
    };

    res.json({ success: true, data: updated });
  }),
);

// ─── POST /api/admissions/:id/transfer ── 전실 (베드 이동) ──────────
const transferSchema = z.object({
  newBedId: z.string().uuid(),
  version: z.number().int(),
});

router.post(
  '/:id/transfer',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  auditLog('ADMISSION_TRANSFER', 'Admission'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = transferSchema.parse(req.body);

    const admission = await prisma.admission.findUnique({
      where: { id },
      include: { currentBed: true },
    });
    if (!admission || admission.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '입원 정보를 찾을 수 없습니다.');
    }

    if (admission.status === AdmissionStatus.DISCHARGED) {
      throw new AppError(400, 'ALREADY_DISCHARGED', '이미 퇴원 처리된 입원입니다.');
    }

    // 낙관적 잠금
    if (admission.version !== body.version) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        '다른 사용자가 이미 변경했습니다. 새로고침 후 재시도하세요.',
      );
    }

    // 새 베드 확인
    const newBed = await prisma.bed.findUnique({ where: { id: body.newBedId } });
    if (!newBed || newBed.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '이동할 베드를 찾을 수 없습니다.');
    }
    if (newBed.status !== 'EMPTY') {
      throw new AppError(
        400,
        'BED_NOT_AVAILABLE',
        `이동할 베드가 비어있지 않습니다. (상태: ${newBed.status})`,
      );
    }

    res.locals.auditBefore = {
      currentBedId: admission.currentBedId,
      version: admission.version,
    };

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      // 1) 기존 베드 → CLEANING
      if (admission.currentBedId) {
        await tx.bed.update({
          where: { id: admission.currentBedId },
          data: { status: 'CLEANING', version: { increment: 1 } },
        });

        // 기존 BedAssignment 종료
        await tx.bedAssignment.updateMany({
          where: {
            admissionId: id,
            bedId: admission.currentBedId,
            endAt: null,
          },
          data: { endAt: now },
        });
      }

      // 2) 새 베드 → OCCUPIED
      await tx.bed.update({
        where: { id: body.newBedId },
        data: { status: 'OCCUPIED', version: { increment: 1 } },
      });

      // 3) 새 BedAssignment 생성
      await tx.bedAssignment.create({
        data: {
          admissionId: id,
          bedId: body.newBedId,
          startAt: now,
          changedBy: req.user!.id,
        },
      });

      // 4) 입원 레코드 갱신
      return tx.admission.update({
        where: { id, version: body.version },
        data: {
          currentBedId: body.newBedId,
          version: { increment: 1 },
        },
        include: {
          patient: true,
          currentBed: { include: { room: { include: { ward: true } } } },
          attendingDoctor: { select: { id: true, name: true, loginId: true } },
        },
      });
    });

    res.locals.auditAfter = {
      currentBedId: updated.currentBedId,
      version: updated.version,
    };

    res.json({ success: true, data: updated });
  }),
);

// ─── POST /api/admissions/:id/discharge ── 퇴원 처리 ────────────────
const dischargeSchema = z.object({
  dischargeDate: z.string().datetime({ offset: true }).or(z.string().date()),
  version: z.number().int(),
});

router.post(
  '/:id/discharge',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  auditLog('ADMISSION_DISCHARGE', 'Admission'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = dischargeSchema.parse(req.body);

    const admission = await prisma.admission.findUnique({
      where: { id },
      include: { currentBed: true },
    });
    if (!admission || admission.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '입원 정보를 찾을 수 없습니다.');
    }

    if (admission.status === AdmissionStatus.DISCHARGED) {
      throw new AppError(400, 'ALREADY_DISCHARGED', '이미 퇴원 처리되었습니다.');
    }

    // 낙관적 잠금
    if (admission.version !== body.version) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        '다른 사용자가 이미 변경했습니다. 새로고침 후 재시도하세요.',
      );
    }

    res.locals.auditBefore = {
      status: admission.status,
      currentBedId: admission.currentBedId,
      dischargeDate: admission.dischargeDate,
      version: admission.version,
    };

    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      // 1) 베드 → CLEANING, BedAssignment 종료
      if (admission.currentBedId) {
        await tx.bed.update({
          where: { id: admission.currentBedId },
          data: { status: 'CLEANING', version: { increment: 1 } },
        });

        await tx.bedAssignment.updateMany({
          where: {
            admissionId: id,
            bedId: admission.currentBedId,
            endAt: null,
          },
          data: { endAt: now },
        });
      }

      // 2) 입원 상태 → DISCHARGED
      return tx.admission.update({
        where: { id, version: body.version },
        data: {
          status: AdmissionStatus.DISCHARGED,
          dischargeDate: new Date(body.dischargeDate),
          currentBedId: null,
          version: { increment: 1 },
        },
        include: {
          patient: true,
          attendingDoctor: { select: { id: true, name: true, loginId: true } },
        },
      });
    });

    res.locals.auditAfter = {
      status: updated.status,
      currentBedId: updated.currentBedId,
      dischargeDate: updated.dischargeDate,
      version: updated.version,
    };

    res.json({ success: true, data: updated });
  }),
);

// ─── DELETE /api/admissions/:id ── 입원 삭제 (예약 취소) ────────────
router.delete(
  '/:id',
  requireAuth,
  requirePermission('ADMISSIONS', 'WRITE'),
  auditLog('ADMISSION_DELETE', 'Admission'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const admission = await prisma.admission.findUnique({
      where: { id },
      include: { currentBed: true },
    });
    if (!admission || admission.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', '입원 정보를 찾을 수 없습니다.');
    }

    res.locals.auditBefore = {
      id: admission.id,
      patientId: admission.patientId,
      status: admission.status,
      currentBedId: admission.currentBedId,
    };

    await prisma.$transaction(async (tx) => {
      // 베드가 있으면 EMPTY로 변경
      if (admission.currentBedId) {
        await tx.bed.update({
          where: { id: admission.currentBedId },
          data: { status: 'EMPTY', version: { increment: 1 } },
        });
      }

      // BedAssignment 삭제
      await tx.bedAssignment.deleteMany({
        where: { admissionId: id },
      });

      // 입원 레코드 소프트 삭제
      await tx.admission.update({
        where: { id },
        data: { deletedAt: new Date(), currentBedId: null },
      });
    });

    res.json({ success: true, message: '삭제되었습니다.' });
  }),
);

// ─── GET /api/admissions/calendar ── 달력 뷰용 입원 조회 ────────────
router.get(
  '/calendar',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, wardId } = req.query;

    if (!from || !to) {
      throw new AppError(400, 'INVALID_REQUEST', 'from, to 날짜가 필요합니다.');
    }

    const fromDate = new Date(from as string);
    const toDate = new Date(to as string);
    toDate.setHours(23, 59, 59, 999);

    const where: any = {
      deletedAt: null,
      OR: [
        // 입원일이 범위 내
        { admitDate: { gte: fromDate, lte: toDate } },
        // 퇴원예정일이 범위 내
        { plannedDischargeDate: { gte: fromDate, lte: toDate } },
        // 입원중인 경우 (범위 내에 걸쳐있는)
        {
          admitDate: { lte: toDate },
          OR: [
            { plannedDischargeDate: { gte: fromDate } },
            { plannedDischargeDate: null, status: { not: 'DISCHARGED' } },
          ],
        },
      ],
    };

    if (wardId) {
      where.currentBed = { room: { wardId: wardId as string } };
    }

    const admissions = await prisma.admission.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true, emrPatientId: true } },
        currentBed: {
          include: { room: { include: { ward: true } } },
        },
        attendingDoctor: { select: { id: true, name: true } },
      },
      orderBy: { admitDate: 'asc' },
    });

    res.json({ success: true, data: admissions });
  }),
);

// ─── GET /api/admissions/available-beds ── 사용가능 베드 목록 ────────
router.get(
  '/available-beds',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (_req: Request, res: Response) => {
    const beds = await prisma.bed.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: { in: ['EMPTY', 'RESERVED'] },
      },
      include: {
        room: { include: { ward: { select: { id: true, name: true } } } },
      },
      orderBy: [
        { room: { ward: { name: 'asc' } } },
        { room: { name: 'asc' } },
        { label: 'asc' },
      ],
    });

    res.json({ success: true, data: beds });
  }),
);

// ─── GET /api/admissions/doctors ── 담당의 목록 ──────────────────────
router.get(
  '/doctors',
  requireAuth,
  requirePermission('ADMISSIONS', 'READ'),
  asyncHandler(async (_req: Request, res: Response) => {
    // 의사 역할을 가진 사용자 조회
    const doctors = await prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        departments: {
          some: {
            role: 'DOCTOR',
          },
        },
      },
      select: {
        id: true,
        name: true,
        loginId: true,
        departments: {
          select: { role: true, department: { select: { name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: doctors });
  }),
);

export default router;
