import { PrismaClient } from '@prisma/client';
import type { ParsedManualSlot } from '../../parsers/types';
import { PatientResolver } from '../../parsers/patientResolver';
import type { SyncStats } from './syncLogger';

interface TherapistMap {
  [name: string]: string; // name → therapistId
}

export class ManualTherapySaver {
  private prisma: PrismaClient;
  private resolver: PatientResolver;
  private therapistMap: TherapistMap = {};

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.resolver = new PatientResolver(prisma);
  }

  /** Load therapist name → ID mapping */
  async init(): Promise<void> {
    const therapists = await this.prisma.therapist.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const t of therapists) {
      this.therapistMap[t.name] = t.id;
    }
  }

  /**
   * Upsert Manual Therapy slots from parsed data.
   * Dedup key: (therapistId, date, timeSlot, deletedAt IS NULL)
   */
  async upsertSlots(slots: ParsedManualSlot[], syncTimestamp: Date): Promise<SyncStats> {
    const stats: SyncStats = {
      rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0,
      rowsSkipped: 0, rowsFailed: 0,
    };

    for (const slot of slots) {
      stats.rowsProcessed++;

      try {
        const therapistId = this.therapistMap[slot.therapistName];
        if (!therapistId) {
          stats.rowsFailed++;
          continue; // unknown therapist
        }

        // Resolve patient (only for actual patient bookings)
        let patientId: string | null = null;
        if (slot.patientNameRaw && !slot.isAdminWork) {
          const result = await this.resolver.resolve(undefined, slot.patientNameRaw);
          patientId = result.patientId;
        }

        // Find existing slot by dedup key
        const existing = await this.prisma.manualTherapySlot.findFirst({
          where: {
            therapistId,
            date: new Date(slot.date),
            timeSlot: slot.timeSlot,
            deletedAt: null,
          },
          select: {
            id: true, isManualOverride: true, sheetSyncedAt: true,
            patientId: true, status: true, rawCellValue: true,
          },
        });

        if (!existing) {
          await this.prisma.manualTherapySlot.create({
            data: {
              therapistId,
              patientId: patientId || undefined,
              date: new Date(slot.date),
              timeSlot: slot.timeSlot,
              status: slot.status,
              patientNameRaw: slot.patientNameRaw,
              treatmentSubtype: slot.treatmentSubtype,
              statusNote: slot.statusNote,
              isAdminWork: slot.isAdminWork,
              adminWorkNote: slot.adminWorkNote,
              rawCellValue: slot.rawCellValue,
              sheetSyncedAt: syncTimestamp,
              sheetSource: slot.sheetSource,
              source: 'MIGRATION',
            },
          });
          stats.rowsCreated++;
          continue;
        }

        if (existing.isManualOverride) {
          stats.rowsSkipped++;
          continue;
        }

        if (existing.sheetSyncedAt && existing.sheetSyncedAt >= syncTimestamp) {
          stats.rowsSkipped++;
          continue;
        }

        // Skip if data hasn't changed
        if (existing.rawCellValue === slot.rawCellValue && existing.patientId === patientId) {
          await this.prisma.manualTherapySlot.update({
            where: { id: existing.id },
            data: { sheetSyncedAt: syncTimestamp },
          });
          stats.rowsSkipped++;
          continue;
        }

        await this.prisma.manualTherapySlot.updateMany({
          where: { id: existing.id, isManualOverride: false },
          data: {
            patientId: patientId || null,
            status: slot.status,
            patientNameRaw: slot.patientNameRaw,
            treatmentSubtype: slot.treatmentSubtype || null,
            statusNote: slot.statusNote || null,
            isAdminWork: slot.isAdminWork,
            adminWorkNote: slot.adminWorkNote || null,
            rawCellValue: slot.rawCellValue,
            sheetSyncedAt: syncTimestamp,
            sheetSource: slot.sheetSource,
          },
        });
        stats.rowsUpdated++;
      } catch (err) {
        stats.rowsFailed++;
      }
    }

    return stats;
  }

  getResolverStats() {
    return this.resolver.getStats();
  }
}
