import { parseRfScheduleCsv, parseManualTherapyCsv, PatientResolver } from '../src/parsers';
import type { ParsedRfSlot, ParsedManualSlot, ParseResult } from '../src/parsers';
import { RfScheduleSaver, ManualTherapySaver, SyncLogger, computeRfContentHash, computeManualContentHash } from '../src/services/sheetSync';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const hasFlag = (name: string) => args.includes(`--${name}`);

async function main() {
  const type = getArg('type') || 'rf';
  const filePath = getArg('path');
  const sheetSource = getArg('tab') || `${type}_dryrun`;
  const resolvePatients = hasFlag('resolve');
  const importMode = hasFlag('import');
  const dateStart = getArg('date-start');
  const dateEnd = getArg('date-end');
  const yearOverride = getArg('year') ? parseInt(getArg('year')!, 10) : undefined;

  if (!filePath) {
    console.error('Usage: npx tsx scripts/sheet-sync-dryrun.ts --type rf|manual --path <csv-file> [options]');
    console.error('Options:');
    console.error('  --resolve            Enable patient matching against DB');
    console.error('  --import             Actually save parsed slots to DB');
    console.error('  --date-start DATE    Filter start date (YYYY-MM-DD)');
    console.error('  --date-end DATE      Filter end date (YYYY-MM-DD)');
    console.error('  --tab NAME           Sheet source name (default: type_dryrun)');
    console.error('  --year YYYY          Override year (default: from CSV header)');
    process.exit(1);
  }

  console.log(`\n=== Sheet Sync Dry-Run ===`);
  console.log(`Type: ${type}`);
  console.log(`File: ${filePath}`);
  console.log(`Sheet Source: ${sheetSource}`);
  if (dateStart || dateEnd) console.log(`Date Filter: ${dateStart || '*'} ~ ${dateEnd || '*'}`);
  if (yearOverride) console.log(`Year Override: ${yearOverride}`);
  console.log('');

  const options = {
    sheetSource,
    year: yearOverride,
    dateFilter: (dateStart || dateEnd)
      ? { start: dateStart || '2000-01-01', end: dateEnd || '2099-12-31' }
      : undefined,
  };

  let prisma: PrismaClient | undefined;
  let resolver: PatientResolver | undefined;

  if (resolvePatients || importMode) {
    prisma = new PrismaClient();
    if (resolvePatients) {
      resolver = new PatientResolver(prisma);
      console.log('[DB] Patient resolver enabled');
    }
    if (importMode) console.log('[DB] IMPORT mode — will write to database');
    console.log('');
  }

  try {
    if (type === 'rf') {
      const result = await parseRfScheduleCsv(filePath, options);
      printRfResult(result);
      if (resolver) await resolveRfPatients(result.slots, resolver);
      if (importMode && prisma) await importRfSlots(result.slots, prisma, sheetSource);
    } else if (type === 'manual') {
      const result = await parseManualTherapyCsv(filePath, options);
      printManualResult(result);
      if (resolver) await resolveManualPatients(result.slots, resolver);
      if (importMode && prisma) await importManualSlots(result.slots, prisma, sheetSource);
    } else {
      console.error(`Unknown type: ${type}. Use 'rf' or 'manual'.`);
      process.exit(1);
    }
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

function printRfResult(result: ParseResult<ParsedRfSlot>) {
  const { slots, errors, stats } = result;

  console.log(`--- RF Parse Result ---`);
  console.log(`Total time rows scanned: ${stats.totalRows}`);
  console.log(`Parsed slots: ${stats.parsedSlots}`);
  console.log(`Empty slots skipped: ${stats.emptySlots}`);
  console.log(`Errors: ${stats.errorCount}`);
  if (stats.dateRange) console.log(`Date range: ${stats.dateRange.start} ~ ${stats.dateRange.end}`);
  console.log('');

  console.log('Slots by date:');
  for (const [date, count] of Object.entries(stats.slotsByDate).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${date}: ${count} slots`);
  }
  console.log('');

  // Status/special breakdown
  const statusCounts: Record<string, number> = {};
  const specialCounts: Record<string, number> = {};
  const durationCounts: Record<number, number> = {};
  for (const s of slots) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
    if (s.specialType) specialCounts[s.specialType] = (specialCounts[s.specialType] || 0) + 1;
    durationCounts[s.durationMinutes] = (durationCounts[s.durationMinutes] || 0) + 1;
  }

  console.log('Status:');
  for (const [s, c] of Object.entries(statusCounts)) console.log(`  ${s}: ${c}`);
  if (Object.keys(specialCounts).length > 0) {
    console.log('Special types:');
    for (const [t, c] of Object.entries(specialCounts)) console.log(`  ${t}: ${c}`);
  }
  console.log('Duration distribution:');
  for (const [d, c] of Object.entries(durationCounts).sort(([a], [b]) => +a - +b)) console.log(`  ${d}min: ${c}`);
  console.log('');

  // Unique rooms
  const rooms = [...new Set(slots.map(s => s.roomNumber))].sort((a, b) => a - b);
  console.log(`Rooms used: ${rooms.join(', ')}`);

  // With/without EMR ID
  const withEmr = slots.filter(s => s.patientEmrId).length;
  const withName = slots.filter(s => s.patientNameRaw).length;
  console.log(`Slots with EMR ID: ${withEmr}/${slots.length}`);
  console.log(`Slots with patient name: ${withName}/${slots.length}`);
  console.log('');

  // Sample
  console.log('Sample slots (first 10):');
  for (const s of slots.slice(0, 10)) {
    const parts = [
      s.date, s.startTime + '-' + s.endTime,
      `R${s.roomNumber}`,
      s.patientNameRaw || '(no-name)',
      `[${s.doctorCode || '-'}]`,
      `${s.durationMinutes}min`,
      s.status,
    ];
    if (s.specialType) parts.push(`(${s.specialType})`);
    if (s.patientEmrId) parts.push(`EMR:${s.patientEmrId}`);
    console.log(`  ${parts.join(' ')}`);
  }
  console.log('');

  if (errors.length > 0) {
    console.log(`Errors (first 10):`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  [Row ${e.row}, Col ${e.column}] ${e.message} | raw: "${e.rawValue}"`);
    }
    console.log('');
  }
}

function printManualResult(result: ParseResult<ParsedManualSlot>) {
  const { slots, errors, stats } = result;

  console.log(`--- Manual Therapy Parse Result ---`);
  console.log(`Total time rows scanned: ${stats.totalRows}`);
  console.log(`Parsed slots: ${stats.parsedSlots}`);
  console.log(`Empty slots skipped: ${stats.emptySlots}`);
  console.log(`Errors: ${stats.errorCount}`);
  if (stats.dateRange) console.log(`Date range: ${stats.dateRange.start} ~ ${stats.dateRange.end}`);
  console.log('');

  console.log('Slots by date:');
  for (const [date, count] of Object.entries(stats.slotsByDate).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${date}: ${count} slots`);
  }
  console.log('');

  const statusCounts: Record<string, number> = {};
  const subtypeCounts: Record<string, number> = {};
  const therapistCounts: Record<string, number> = {};
  let adminCount = 0;
  for (const s of slots) {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
    if (s.treatmentSubtype) subtypeCounts[s.treatmentSubtype] = (subtypeCounts[s.treatmentSubtype] || 0) + 1;
    therapistCounts[s.therapistName] = (therapistCounts[s.therapistName] || 0) + 1;
    if (s.isAdminWork) adminCount++;
  }

  console.log('Status:');
  for (const [s, c] of Object.entries(statusCounts)) console.log(`  ${s}: ${c}`);
  if (Object.keys(subtypeCounts).length > 0) {
    console.log('Treatment subtypes:');
    for (const [t, c] of Object.entries(subtypeCounts)) console.log(`  ${t}: ${c}`);
  }
  console.log(`Admin work entries: ${adminCount}`);
  console.log('');

  console.log('Slots by therapist:');
  for (const [t, c] of Object.entries(therapistCounts).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${t}: ${c}`);
  }
  console.log('');

  console.log('Sample slots (first 10):');
  for (const s of slots.slice(0, 10)) {
    const parts = [
      s.date, s.timeSlot, s.therapistName, '->',
      s.patientNameRaw || s.adminWorkNote || s.statusNote || '?',
      `[${s.doctorCode || '-'}]`,
      s.status,
    ];
    if (s.treatmentSubtype) parts.push(`(${s.treatmentSubtype})`);
    if (s.isAdminWork) parts.push('[ADMIN]');
    console.log(`  ${parts.join(' ')}`);
  }
  console.log('');

  if (errors.length > 0) {
    console.log(`Errors (first 10):`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  [Row ${e.row}, Col ${e.column}] ${e.message} | raw: "${e.rawValue}"`);
    }
    console.log('');
  }
}

async function resolveRfPatients(slots: ParsedRfSlot[], resolver: PatientResolver) {
  console.log(`--- Patient Resolution (RF) ---`);
  let resolved = 0;
  let unresolved = 0;
  const unmatchedNames: Set<string> = new Set();

  for (const slot of slots) {
    if (slot.status === 'BLOCKED') continue;
    const result = await resolver.resolve(slot.patientEmrId, slot.patientNameRaw);
    if (result.isResolved) resolved++;
    else {
      unresolved++;
      if (slot.patientNameRaw) unmatchedNames.add(slot.patientNameRaw);
    }
  }

  const total = resolved + unresolved;
  console.log(`Resolved: ${resolved} / ${total} (${total > 0 ? ((resolved / total) * 100).toFixed(1) : 0}%)`);
  if (unmatchedNames.size > 0) {
    console.log(`Unmatched names (${unmatchedNames.size}, first 20):`);
    for (const name of [...unmatchedNames].sort().slice(0, 20)) console.log(`  - ${name}`);
  }
  console.log('');
}

async function resolveManualPatients(slots: ParsedManualSlot[], resolver: PatientResolver) {
  console.log(`--- Patient Resolution (Manual) ---`);
  let resolved = 0;
  let unresolved = 0;
  const unmatchedNames: Set<string> = new Set();

  for (const slot of slots) {
    if (slot.isAdminWork || !slot.patientNameRaw) continue;
    const result = await resolver.resolve(undefined, slot.patientNameRaw);
    if (result.isResolved) resolved++;
    else {
      unresolved++;
      unmatchedNames.add(slot.patientNameRaw);
    }
  }

  const total = resolved + unresolved;
  console.log(`Resolved: ${resolved} / ${total} (${total > 0 ? ((resolved / total) * 100).toFixed(1) : 0}%)`);
  if (unmatchedNames.size > 0) {
    console.log(`Unmatched names (${unmatchedNames.size}, first 20):`);
    for (const name of [...unmatchedNames].sort().slice(0, 20)) console.log(`  - ${name}`);
  }
  console.log('');
}

async function importRfSlots(slots: ParsedRfSlot[], prisma: PrismaClient, sheetSource: string) {
  console.log(`\n--- RF Import ---`);
  const syncTimestamp = new Date();
  const contentHash = computeRfContentHash(slots);

  // Check if content changed since last sync
  const logger = new SyncLogger(prisma);
  const lastSync = await logger.getLastSync(sheetSource, 'rf');
  if (lastSync?.contentHash === contentHash) {
    console.log(`Content hash unchanged — skipping import.`);
    return;
  }

  // Start sync log
  const logId = await logger.start({
    sheetId: sheetSource, sheetTab: 'rf',
    syncType: 'FULL', direction: 'SHEET_TO_DB', triggeredBy: 'cli_import',
  });

  const saver = new RfScheduleSaver(prisma);
  await saver.init();

  const stats = await saver.upsertSlots(slots, syncTimestamp);

  await logger.complete(logId, stats, contentHash);

  const resolverStats = saver.getResolverStats();
  console.log(`Processed: ${stats.rowsProcessed}`);
  console.log(`Created: ${stats.rowsCreated}`);
  console.log(`Updated: ${stats.rowsUpdated}`);
  console.log(`Skipped: ${stats.rowsSkipped}`);
  console.log(`Failed: ${stats.rowsFailed}`);
  console.log(`Patient resolution: ${resolverStats.resolved}/${resolverStats.total} (${resolverStats.total > 0 ? ((resolverStats.resolved / resolverStats.total) * 100).toFixed(1) : 0}%)`);
  console.log(`Content hash: ${contentHash.substring(0, 16)}...`);
  console.log('');
}

async function importManualSlots(slots: ParsedManualSlot[], prisma: PrismaClient, sheetSource: string) {
  console.log(`\n--- Manual Therapy Import ---`);
  const syncTimestamp = new Date();
  const contentHash = computeManualContentHash(slots);

  const logger = new SyncLogger(prisma);
  const lastSync = await logger.getLastSync(sheetSource, 'manual');
  if (lastSync?.contentHash === contentHash) {
    console.log(`Content hash unchanged — skipping import.`);
    return;
  }

  const logId = await logger.start({
    sheetId: sheetSource, sheetTab: 'manual',
    syncType: 'FULL', direction: 'SHEET_TO_DB', triggeredBy: 'cli_import',
  });

  const saver = new ManualTherapySaver(prisma);
  await saver.init();

  const stats = await saver.upsertSlots(slots, syncTimestamp);

  await logger.complete(logId, stats, contentHash);

  const resolverStats = saver.getResolverStats();
  console.log(`Processed: ${stats.rowsProcessed}`);
  console.log(`Created: ${stats.rowsCreated}`);
  console.log(`Updated: ${stats.rowsUpdated}`);
  console.log(`Skipped: ${stats.rowsSkipped}`);
  console.log(`Failed: ${stats.rowsFailed}`);
  console.log(`Patient resolution: ${resolverStats.resolved}/${resolverStats.total} (${resolverStats.total > 0 ? ((resolverStats.resolved / resolverStats.total) * 100).toFixed(1) : 0}%)`);
  console.log(`Content hash: ${contentHash.substring(0, 16)}...`);
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
