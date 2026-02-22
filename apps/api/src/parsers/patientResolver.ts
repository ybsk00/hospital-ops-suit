import { PrismaClient } from '@prisma/client';

interface ResolvedPatient {
  patientId: string | null;
  isResolved: boolean;
  matchMethod?: 'emrId' | 'name';
}

export class PatientResolver {
  private cache: Map<string, ResolvedPatient> = new Map();
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Resolve a patient by EMR ID or name
   * Priority: emrId exact match > name exact match (ACTIVE only, unique)
   */
  async resolve(emrId?: string, nameRaw?: string): Promise<ResolvedPatient> {
    const cacheKey = `${emrId || ''}:${nameRaw || ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let result: ResolvedPatient = { patientId: null, isResolved: false };

    // 1. Try EMR ID match
    if (emrId) {
      const patient = await this.prisma.patient.findFirst({
        where: { emrPatientId: emrId, deletedAt: null },
        select: { id: true },
      });
      if (patient) {
        result = { patientId: patient.id, isResolved: true, matchMethod: 'emrId' };
        this.cache.set(cacheKey, result);
        return result;
      }
    }

    // 2. Try name match (ACTIVE patients, exact match, single result only)
    if (nameRaw) {
      // Clean name: remove ☆ prefix, trailing number suffix (e.g., ☆홍영훈, 김미나1)
      const cleanedName = nameRaw.replace(/^[☆★]/, '').replace(/\d+$/, '').trim();

      const patients = await this.prisma.patient.findMany({
        where: {
          name: cleanedName,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
        take: 2, // only need to know if exactly 1
      });

      if (patients.length === 1) {
        result = { patientId: patients[0].id, isResolved: true, matchMethod: 'name' };
      }
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  getStats(): { total: number; resolved: number; unresolved: number } {
    let resolved = 0;
    let unresolved = 0;
    for (const [, v] of this.cache) {
      if (v.isResolved) resolved++;
      else unresolved++;
    }
    return { total: this.cache.size, resolved, unresolved };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
