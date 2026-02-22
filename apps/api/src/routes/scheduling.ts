import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── GET /api/scheduling/monthly-summary ── RF+도수 통합 월간 집계 ───
router.get(
  '/monthly-summary',
  requireAuth,
  requirePermission('SCHEDULING', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month as string, 10) || (new Date().getMonth() + 1);
    const filters = ((req.query.filters as string) || 'rf,manual').split(',').map(f => f.trim());
    const showRf = filters.includes('rf');
    const showManual = filters.includes('manual');

    const startDate = new Date(`${year}-${String(month).padStart(2, '0')}-01`);
    const endDate = new Date(year, month, 0);

    const dateRange = { gte: startDate, lte: endDate };

    // Fetch slots in parallel
    const [rfSlots, manualSlots] = await Promise.all([
      showRf
        ? prisma.rfScheduleSlot.findMany({
            where: { deletedAt: null, date: dateRange },
            select: { date: true, status: true, patientId: true, specialType: true },
          })
        : [],
      showManual
        ? prisma.manualTherapySlot.findMany({
            where: { deletedAt: null, date: dateRange },
            select: { date: true, status: true, patientId: true, isAdminWork: true },
          })
        : [],
    ]);

    // Group by date
    const days: Record<string, {
      rfBooked: number;
      rfCompleted: number;
      rfBlocked: number;
      rfUnmatched: number;
      rfTotal: number;
      manualBooked: number;
      manualCompleted: number;
      manualLtu: number;
      manualUnmatched: number;
      manualAdminWork: number;
      manualTotal: number;
    }> = {};

    const initDay = () => ({
      rfBooked: 0, rfCompleted: 0, rfBlocked: 0, rfUnmatched: 0, rfTotal: 0,
      manualBooked: 0, manualCompleted: 0, manualLtu: 0, manualUnmatched: 0, manualAdminWork: 0, manualTotal: 0,
    });

    for (const slot of rfSlots) {
      const dateStr = toDateStr(slot.date);
      if (!days[dateStr]) days[dateStr] = initDay();
      const day = days[dateStr];
      day.rfTotal++;
      if (slot.status === 'BOOKED') day.rfBooked++;
      if (slot.status === 'COMPLETED') day.rfCompleted++;
      if (slot.status === 'BLOCKED') day.rfBlocked++;
      if (!slot.patientId && slot.status !== 'CANCELLED' && slot.status !== 'BLOCKED') day.rfUnmatched++;
    }

    for (const slot of manualSlots) {
      const dateStr = toDateStr(slot.date);
      if (!days[dateStr]) days[dateStr] = initDay();
      const day = days[dateStr];
      day.manualTotal++;
      if (slot.status === 'BOOKED') day.manualBooked++;
      if (slot.status === 'COMPLETED') day.manualCompleted++;
      if (slot.status === 'LTU') day.manualLtu++;
      if (slot.isAdminWork) day.manualAdminWork++;
      if (!slot.patientId && slot.status !== 'CANCELLED' && !slot.isAdminWork) day.manualUnmatched++;
    }

    // OperatingConfig for fill rate calculation
    const config = await prisma.operatingConfig.findFirst({
      where: {
        effectiveFrom: { lte: endDate },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: startDate } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    // Total stats
    const totalRf = rfSlots.filter(s => s.status !== 'CANCELLED').length;
    const totalManual = manualSlots.filter(s => s.status !== 'CANCELLED').length;
    const totalUnmatched = rfSlots.filter(s => !s.patientId && s.status !== 'CANCELLED' && s.status !== 'BLOCKED').length
      + manualSlots.filter(s => !s.patientId && s.status !== 'CANCELLED' && !s.isAdminWork).length;

    res.json({
      success: true,
      data: {
        year,
        month,
        filters,
        days,
        summary: {
          rfTotal: totalRf,
          manualTotal: totalManual,
          totalUnmatched,
        },
        operatingConfig: config
          ? {
              rfSlotDuration: config.type === 'RF' ? config.slotDuration : undefined,
              manualSlotDuration: config.type === 'MANUAL' ? config.slotDuration : undefined,
              rfStartTime: config.type === 'RF' ? config.startTime : undefined,
              rfEndTime: config.type === 'RF' ? config.endTime : undefined,
              manualStartTime: config.type === 'MANUAL' ? config.startTime : undefined,
              manualEndTime: config.type === 'MANUAL' ? config.endTime : undefined,
            }
          : null,
      },
    });
  }),
);

// ─── GET /api/scheduling/operating-config ── OperatingConfig 조회 ───
router.get(
  '/operating-config',
  requireAuth,
  requirePermission('SCHEDULING', 'READ'),
  asyncHandler(async (req: Request, res: Response) => {
    const configs = await prisma.operatingConfig.findMany({
      where: {
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date() } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    res.json({ success: true, data: configs });
  }),
);

export default router;
