import { PrismaClient } from '@prisma/client';
import type { ParsedRfSlot } from '../../parsers/types';
import { PatientResolver } from '../../parsers/patientResolver';
import type { SyncStats } from './syncLogger';

interface RoomMap {
  [roomNumber: number]: string; // roomNumber → roomId
}

export class RfScheduleSaver {
  private prisma: PrismaClient;
  private resolver: PatientResolver;
  private roomMap: RoomMap = {};

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.resolver = new PatientResolver(prisma);
  }

  /** Load room number → room ID mapping */
  async init(): Promise<void> {
    const rooms = await this.prisma.rfTreatmentRoom.findMany({
      where: { isActive: true },
      select: { id: true, roomNumber: true },
    });
    for (const room of rooms) {
      if (room.roomNumber !== null) {
        this.roomMap[room.roomNumber] = room.id;
      }
    }
  }

  /**
   * Upsert RF slots from parsed data.
   * Dedup key: (date, startTime, roomId, deletedAt IS NULL)
   */
  async upsertSlots(slots: ParsedRfSlot[], syncTimestamp: Date): Promise<SyncStats> {
    const stats: SyncStats = {
      rowsProcessed: 0, rowsCreated: 0, rowsUpdated: 0,
      rowsSkipped: 0, rowsFailed: 0,
    };

    for (const slot of slots) {
      stats.rowsProcessed++;

      try {
        const roomId = this.roomMap[slot.roomNumber];
        if (!roomId) {
          stats.rowsFailed++;
          continue; // unknown room
        }

        // Resolve patient
        const { patientId } = await this.resolver.resolve(slot.patientEmrId, slot.patientNameRaw);

        // Resolve doctor by code
        const doctorId = slot.doctorCode
          ? await this.resolveDoctorByCode(slot.doctorCode)
          : undefined;

        // Find existing slot by dedup key
        const existing = await this.prisma.rfScheduleSlot.findFirst({
          where: {
            date: new Date(slot.date),
            startTime: slot.startTime,
            roomId,
            deletedAt: null,
          },
          select: {
            id: true, isManualOverride: true, sheetSyncedAt: true,
            patientId: true, doctorId: true, durationMinutes: true,
            status: true, rawCellValue: true,
          },
        });

        if (!existing) {
          // Create new slot
          await this.prisma.rfScheduleSlot.create({
            data: {
              roomId,
              patientId: patientId || undefined,
              doctorId: doctorId || undefined,
              date: new Date(slot.date),
              startTime: slot.startTime,
              durationMinutes: slot.durationMinutes,
              status: slot.status === 'BLOCKED' ? 'BLOCKED' : 'BOOKED',
              patientNameRaw: slot.patientNameRaw,
              patientEmrId: slot.patientEmrId,
              specialType: slot.specialType,
              rawCellValue: slot.rawCellValue,
              sheetSyncedAt: syncTimestamp,
              sheetSource: slot.sheetSource,
              source: 'MIGRATION',
            },
          });
          stats.rowsCreated++;
          continue;
        }

        // Skip if manually overridden in web UI
        if (existing.isManualOverride) {
          stats.rowsSkipped++;
          continue;
        }

        // Skip if already synced in this run
        if (existing.sheetSyncedAt && existing.sheetSyncedAt >= syncTimestamp) {
          stats.rowsSkipped++;
          continue;
        }

        // Skip if data hasn't changed
        if (
          existing.rawCellValue === slot.rawCellValue &&
          existing.patientId === patientId &&
          existing.durationMinutes === slot.durationMinutes
        ) {
          // Just update sync timestamp
          await this.prisma.rfScheduleSlot.update({
            where: { id: existing.id },
            data: { sheetSyncedAt: syncTimestamp },
          });
          stats.rowsSkipped++;
          continue;
        }

        // Update existing slot (DB-level protection: only if not manually overridden)
        await this.prisma.rfScheduleSlot.updateMany({
          where: { id: existing.id, isManualOverride: false },
          data: {
            patientId: patientId || null,
            doctorId: doctorId || null,
            durationMinutes: slot.durationMinutes,
            status: slot.status === 'BLOCKED' ? 'BLOCKED' : 'BOOKED',
            patientNameRaw: slot.patientNameRaw,
            patientEmrId: slot.patientEmrId,
            specialType: slot.specialType || null,
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

  private async resolveDoctorByCode(code: string): Promise<string | undefined> {
    const doctor = await this.prisma.doctor.findFirst({
      where: { doctorCode: code },
      select: { id: true },
    });
    return doctor?.id;
  }

  getResolverStats() {
    return this.resolver.getStats();
  }
}
