/**
 * CSV → DB 마이그레이션 스크립트 (Prisma 직접 사용)
 *
 * 새 폴더의 고주파/도수/외래 CSV를 파싱하여 DB에 직접 INSERT
 *
 * 사용법: npx tsx scripts/parse-csv-migration.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ============================================================
// CSV 파서 (멀티라인 셀 지원)
// ============================================================
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\n' || (ch === '\r' && content[i + 1] === '\n')) {
        if (ch === '\r') i++;
        row.push(current);
        current = '';
        rows.push(row);
        row = [];
      } else {
        current += ch;
      }
    }
  }
  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

// ============================================================
// 유틸리티
// ============================================================
function padTime(t: string): string {
  const parts = t.split(':');
  if (parts.length === 2) {
    return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
  }
  return t;
}

function parseTimeFromLabel(label: string): string | null {
  label = label.trim();
  // 고주파 format: "9:00~\n9:30" → "09:00"
  const rfMatch = label.match(/^(\d{1,2}:\d{2})/);
  if (rfMatch) return padTime(rfMatch[1]);
  // 도수/외래 format: "오전 09:00" or "오후 01:00"
  const korMatch = label.match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (korMatch) {
    let h = parseInt(korMatch[2]);
    const m = korMatch[3];
    if (korMatch[1] === '오후' && h < 12) h += 12;
    if (korMatch[1] === '오전' && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + m;
  }
  return null;
}

// ============================================================
// 1. 고주파 (RF Schedule) 파서
// ============================================================
interface RfSlot {
  date: string;
  machineNum: number;
  startTime: string;
  duration: number;
  chartNumber: string;
  patientName: string;
  doctorCode: string;
  patientType: 'INPATIENT' | 'OUTPATIENT';
}

function parseRfCsv(content: string, year: number, month: number): RfSlot[] {
  const rows = parseCSV(content);
  const slots: RfSlot[] = [];
  const monthStr = String(month).padStart(2, '0');
  const dateHeaderPattern = new RegExp(`0?${month}\\.\\d{1,2}\\s*\\(`);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowText = row.join(',');
    if (!dateHeaderPattern.test(rowText)) continue;

    // Extract dates
    const dates: { date: string }[] = [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c].trim();
      const dateMatch = cell.match(/(\d{1,2})\.(\d{1,2})\s*\(/);
      if (dateMatch && parseInt(dateMatch[1]) === month) {
        const d = parseInt(dateMatch[2]);
        dates.push({ date: `${year}-${monthStr}-${String(d).padStart(2, '0')}` });
      }
    }
    if (dates.length === 0) continue;

    // Column headers row
    const headerRow = rows[r + 1];
    if (!headerRow) continue;

    // Find day blocks by FALSE markers
    const dayBlocks: { startCol: number; machineCount: number; date: string }[] = [];
    let dateIdx = 0;
    for (let c = 0; c < headerRow.length && dateIdx < dates.length; c++) {
      if (headerRow[c].trim() === 'FALSE') {
        let machineCount = 0;
        for (let mc = c + 1; mc < headerRow.length; mc++) {
          if (headerRow[mc].trim() && /^\d+$/.test(headerRow[mc].trim())) machineCount++;
          else break;
        }
        if (machineCount > 0) {
          dayBlocks.push({ startCol: c, machineCount, date: dates[dateIdx].date });
          dateIdx++;
        }
      }
    }

    // Parse time slot rows
    for (let tr = r + 2; tr < rows.length; tr++) {
      const timeRow = rows[tr];
      if (!timeRow || timeRow.length < 5) break;

      const firstCell = timeRow[0]?.trim();
      if (!firstCell) {
        if (timeRow.every(c => !c.trim())) break;
        continue;
      }
      if (dateHeaderPattern.test(timeRow.join(','))) break;
      if (firstCell.startsWith('비고') || firstCell === '비고') break;

      // Get time
      let timeStr: string | null = null;
      for (const block of dayBlocks) {
        const cellVal = timeRow[block.startCol]?.trim();
        if (cellVal) { const t = parseTimeFromLabel(cellVal); if (t) { timeStr = t; break; } }
      }
      if (!timeStr) continue;

      // Extract bookings
      for (const block of dayBlocks) {
        for (let m = 1; m <= block.machineCount; m++) {
          const colIdx = block.startCol + m;
          const cellVal = timeRow[colIdx]?.trim();
          if (!cellVal) continue;

          const lines = cellVal.split('\n').map(l => l.trim()).filter(l => l);
          if (lines.length < 2) continue;

          const chartMatch = lines[0].match(/^(\d{4,6})/);
          if (!chartMatch) continue;

          const chartNumber = chartMatch[1];
          let patientName = lines[1].replace(/\d+$/, '').trim();
          let doctorCode = 'C';
          let duration = 60;

          for (const line of lines) {
            const dcMatch = line.match(/\(([CJ])\)/);
            if (dcMatch) doctorCode = dcMatch[1];
            const durMatch = line.match(/(\d+)분/);
            if (durMatch) duration = parseInt(durMatch[1]);
          }

          slots.push({
            date: block.date,
            machineNum: m,
            startTime: timeStr,
            duration,
            chartNumber,
            patientName,
            doctorCode,
            patientType: 'INPATIENT',
          });
        }
      }
    }
  }
  return slots;
}

// ============================================================
// 2. 도수 (Manual Therapy) 파서
// ============================================================
interface ManualSlot {
  date: string;
  therapistId: string;
  timeSlot: string;
  duration: number;
  patientName: string;
  treatmentCodes: string[];
  patientType: 'INPATIENT' | 'OUTPATIENT';
}

// Therapist mapping will be loaded from DB at runtime
let THERAPIST_MAP: Record<string, string> = {};

function parseTreatmentCode(text: string): { name: string; codes: string[] } {
  let name = text.trim();
  let codes: string[] = [];

  // Remove C/J doctor prefix
  name = name.replace(/^[CcJj]\s*/, '');

  // Extract codes from parentheses
  const codeMatch = name.match(/\(([^)]+)\)/);
  if (codeMatch) {
    const codeText = codeMatch[1];
    name = name.replace(/\([^)]+\)/, '').trim();
    for (const part of codeText.split('/').map(p => p.trim())) {
      if (part.includes('온')) codes.push('온열');
      else if (part.includes('림프')) codes.push('림프');
      else if (part.includes('신')) codes.push('신경');
      else if (part.includes('페인')) codes.push('페인');
      else if (part.includes('통')) codes.push('통증');
      else codes.push(part);
    }
  }
  if (codes.length === 0) codes.push('도수');

  name = name.replace(/\d+$/, '').trim();
  return { name, codes };
}

function parseManualTherapyCsv(content: string): ManualSlot[] {
  const rows = parseCSV(content);
  const slots: ManualSlot[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row[0]?.trim().startsWith('치료사')) continue;

    // Extract dates
    const dates: { col: number; date: string }[] = [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c].trim();
      const dateMatch = cell.match(/2026\.(\d{1,2})\.(\d{1,2})\s*(월|화|수|목|금|토)/);
      if (dateMatch) {
        dates.push({
          col: c,
          date: `2026-${String(parseInt(dateMatch[1])).padStart(2, '0')}-${String(parseInt(dateMatch[2])).padStart(2, '0')}`,
        });
      }
    }
    if (dates.length === 0) continue;

    // Therapist names row
    const therapistRow = rows[r + 1];
    if (!therapistRow) continue;

    // Build day blocks
    const dayBlocks: { dateCol: number; date: string; therapists: { col: number; id: string }[] }[] = [];
    for (const dateInfo of dates) {
      const therapists: { col: number; id: string }[] = [];
      for (let tc = dateInfo.col + 1; tc < Math.min(dateInfo.col + 4, therapistRow.length); tc++) {
        const tName = therapistRow[tc]?.trim();
        if (tName && THERAPIST_MAP[tName]) {
          therapists.push({ col: tc, id: THERAPIST_MAP[tName] });
        }
      }
      if (therapists.length > 0) dayBlocks.push({ dateCol: dateInfo.col, date: dateInfo.date, therapists });
    }

    // Parse time slot rows
    for (let tr = r + 2; tr < rows.length; tr++) {
      const timeRow = rows[tr];
      if (!timeRow || timeRow.length < 3) break;

      const firstCell = timeRow[0]?.trim() || '';
      if (firstCell === '비고' || firstCell.startsWith('비고')) break;
      if (firstCell.startsWith('치료사')) break;
      if (!firstCell) continue;

      const timeStr = parseTimeFromLabel(firstCell);
      if (!timeStr) continue;

      for (const block of dayBlocks) {
        for (const therapist of block.therapists) {
          const cellVal = timeRow[therapist.col]?.trim();
          if (!cellVal) continue;
          // Skip markers
          if (/^(IN|[-]{3,}|확인중|W\d|LTU|전산업무|1시간|☆|스타킹|병원장)/i.test(cellVal)) continue;

          const { name, codes } = parseTreatmentCode(cellVal);
          if (!name || name.length < 2) continue;

          // Check continuation rows for duration
          let duration = 30;
          for (let cr = tr + 1; cr < rows.length; cr++) {
            const contRow = rows[cr];
            if (!contRow) break;
            const contCell = contRow[therapist.col]?.trim() || '';
            if (/^(IN|[-]{3,}|W\d)/i.test(contCell) && contCell.length < 20) duration += 30;
            else break;
          }

          slots.push({
            date: block.date,
            therapistId: therapist.id,
            timeSlot: timeStr,
            duration,
            patientName: name,
            treatmentCodes: codes,
            patientType: 'INPATIENT',
          });
        }
      }
    }
  }
  return slots;
}

// ============================================================
// 3. 외래 (Outpatient) 파서
// ============================================================
interface OutpatientSlot {
  date: string;
  startTime: string;
  patientName: string;
  doctorCode: string;
  phone: string;
  notes: string;
}

function parseOutpatientCsv(content: string, year: number, month: number): OutpatientSlot[] {
  const rows = parseCSV(content);
  const slots: OutpatientSlot[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];

    // Look for column header row: "이름/유형"
    let hasHeader = false;
    const nameColPositions: number[] = [];
    for (let c = 0; c < row.length; c++) {
      if (row[c]?.trim() === '이름/유형') {
        nameColPositions.push(c);
        hasHeader = true;
      }
    }
    if (!hasHeader) continue;

    // Previous row should have dates
    const dateRow = rows[r - 1];
    if (!dateRow) continue;

    const dates: string[] = [];
    for (let c = 0; c < dateRow.length; c++) {
      const cell = dateRow[c].trim();
      const dateMatch = cell.match(/(\d{1,2})[\/.](\d{1,2})\s*\(/);
      if (dateMatch && parseInt(dateMatch[1]) === month) {
        const d = parseInt(dateMatch[2]);
        dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    }
    if (dates.length === 0) continue;

    // Map nameCol positions to dates
    const dayBlocks: { nameCol: number; date: string }[] = [];
    for (let i = 0; i < Math.min(nameColPositions.length, dates.length); i++) {
      dayBlocks.push({ nameCol: nameColPositions[i], date: dates[i] });
    }

    // Parse time slot rows
    let lastTime: string | null = null;
    for (let tr = r + 1; tr < rows.length; tr++) {
      const timeRow = rows[tr];
      if (!timeRow || timeRow.length < 3) continue;

      // Check for next header block
      if (timeRow.some(c => c?.trim() === '이름/유형')) break;

      // Find time in row
      let timeStr: string | null = null;
      for (const cell of timeRow) {
        const t = parseTimeFromLabel(cell?.trim() || '');
        if (t) { timeStr = t; lastTime = t; break; }
      }

      // Use last known time for continuation rows
      const currentTime = timeStr || lastTime;
      if (!currentTime) continue;

      // Extract bookings
      for (const block of dayBlocks) {
        const nameCell = timeRow[block.nameCol]?.trim() || '';
        const doctorCell = timeRow[block.nameCol + 1]?.trim() || '';
        const phoneCell = timeRow[block.nameCol + 2]?.trim() || '';
        const notesCell = timeRow[block.nameCol + 3]?.trim() || '';

        if (!nameCell || nameCell.length < 2) continue;
        if (nameCell.includes('병원장님')) continue;
        if (/^(오전|오후)\s*\d/.test(nameCell)) continue;

        let patientName = nameCell.replace(/\/신$/, '').replace(/\/신,/, '').trim();
        patientName = patientName.replace(/\d+$/, '').trim();
        if (patientName.length < 2) continue;

        const dc = doctorCell.trim().toUpperCase();
        const doctorCode = (dc === 'J' || dc.startsWith('J')) ? 'J' : 'C';

        slots.push({
          date: block.date,
          startTime: currentTime,
          patientName,
          doctorCode,
          phone: phoneCell,
          notes: notesCell,
        });
      }
    }
  }
  return slots;
}

// ============================================================
// DB 삽입
// ============================================================
async function ensurePatient(name: string, phone?: string): Promise<string> {
  // Try to find by name
  const existing = await prisma.patient.findFirst({
    where: { name: { equals: name }, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Create new patient
  const patient = await prisma.patient.create({
    data: {
      name,
      phone: phone || null,
      status: 'ACTIVE',
      emrPatientId: `MIG-${name}-${Date.now()}`,
    },
  });
  console.log(`  [NEW PATIENT] ${name} → ${patient.id}`);
  return patient.id;
}

async function insertRfSlots(slots: RfSlot[]) {
  console.log(`\n▶ 고주파 예약 삽입 중... (${slots.length}건)`);
  let inserted = 0, skipped = 0, errors = 0;

  // Build room name → id mapping from DB
  const rooms = await prisma.rfTreatmentRoom.findMany({ select: { id: true, name: true } });
  const roomMap: Record<number, string> = {};
  for (const r of rooms) {
    roomMap[parseInt(r.name)] = r.id;
  }
  console.log(`  기계 매핑: ${Object.keys(roomMap).length}대`);

  for (const s of slots) {
    const roomId = roomMap[s.machineNum];
    if (!roomId) { errors++; continue; }
    // Check for existing
    const existing = await prisma.rfScheduleSlot.findFirst({
      where: { roomId, date: new Date(s.date), startTime: s.startTime, deletedAt: null },
    });
    if (existing) { skipped++; continue; }

    // Try to match patient
    let patientId: string | null = null;
    if (s.patientName) {
      const patient = await prisma.patient.findFirst({
        where: { name: { contains: s.patientName }, deletedAt: null },
        select: { id: true },
      });
      if (patient) patientId = patient.id;
    }

    await prisma.rfScheduleSlot.create({
      data: {
        roomId,
        patientId,
        doctorCode: s.doctorCode,
        date: new Date(s.date),
        startTime: s.startTime,
        duration: s.duration,
        chartNumber: s.chartNumber,
        patientName: s.patientName,
        patientType: s.patientType,
        status: 'BOOKED',
        source: 'MIGRATION',
      },
    });
    inserted++;
  }
  console.log(`  ✓ 삽입: ${inserted}, 스킵(중복): ${skipped}, 기계없음: ${errors}`);
}

async function insertManualSlots(slots: ManualSlot[]) {
  console.log(`\n▶ 도수 예약 삽입 중... (${slots.length}건)`);
  let inserted = 0, skipped = 0;

  for (const s of slots) {
    // Check unique constraint
    const existing = await prisma.manualTherapySlot.findFirst({
      where: { therapistId: s.therapistId, date: new Date(s.date), timeSlot: s.timeSlot, deletedAt: null },
    });
    if (existing) { skipped++; continue; }

    let patientId: string | null = null;
    if (s.patientName) {
      const patient = await prisma.patient.findFirst({
        where: { name: { contains: s.patientName }, deletedAt: null },
        select: { id: true },
      });
      if (patient) patientId = patient.id;
    }

    try {
      await prisma.manualTherapySlot.create({
        data: {
          therapistId: s.therapistId,
          patientId,
          date: new Date(s.date),
          timeSlot: s.timeSlot,
          duration: s.duration,
          treatmentCodes: s.treatmentCodes,
          patientType: s.patientType,
          patientName: s.patientName,
          status: 'BOOKED',
          source: 'MIGRATION',
        },
      });
      inserted++;
    } catch (e: any) {
      if (e.code === 'P2002') { skipped++; }
      else { console.error(`  [ERROR] ${s.date} ${s.timeSlot} ${s.patientName}: ${e.message}`); }
    }
  }
  console.log(`  ✓ 삽입: ${inserted}, 스킵(중복): ${skipped}`);
}

async function insertAppointments(slots: OutpatientSlot[]) {
  console.log(`\n▶ 외래 예약 삽입 중... (${slots.length}건)`);
  let inserted = 0, skipped = 0;

  for (const s of slots) {
    const doctorId = s.doctorCode === 'J' ? 'doc-jaeil' : 'doc-changyong';
    const startAt = new Date(`${s.date}T${s.startTime}:00+09:00`);
    const [h, m] = s.startTime.split(':').map(Number);
    const endMin = h * 60 + m + 30;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    const endAt = new Date(`${s.date}T${endTime}:00+09:00`);

    // Check for existing appointment at same time for same doctor
    const existing = await prisma.appointment.findFirst({
      where: {
        doctorId,
        startAt,
        deletedAt: null,
        patient: { name: { contains: s.patientName } },
      },
    });
    if (existing) { skipped++; continue; }

    // Ensure patient exists
    const patientId = await ensurePatient(s.patientName, s.phone || undefined);

    await prisma.appointment.create({
      data: {
        patientId,
        doctorId,
        clinicRoomId: 'clinic-1',
        startAt,
        endAt,
        status: 'BOOKED',
        source: 'MIGRATION',
        notes: s.notes || null,
      },
    });
    inserted++;
  }
  console.log(`  ✓ 삽입: ${inserted}, 스킵(중복): ${skipped}`);
}

// ============================================================
// 메인
// ============================================================
async function main() {
  const baseDir = path.resolve(__dirname, '..', '..', '..', '..', '새 폴더');

  console.log('🏥 CSV → DB 마이그레이션 시작\n');

  // 0. 치료사 매핑 로드
  const therapists = await prisma.therapist.findMany({ select: { id: true, name: true } });
  for (const t of therapists) {
    THERAPIST_MAP[t.name] = t.id;
  }
  console.log(`치료사 매핑 로드: ${therapists.map(t => `${t.name}→${t.id.substring(0,8)}`).join(', ')}\n`);

  // 1. 고주파 예약현황
  console.log('━━━ 1. 고주파 예약현황 파싱 ━━━');
  const rfFeb = fs.readFileSync(path.join(baseDir, '고주파예약현황', '고주파예약현황 - 26.02.csv'), 'utf-8');
  const rfMar = fs.readFileSync(path.join(baseDir, '고주파예약현황', '고주파예약현황 - 26.03.csv'), 'utf-8');
  const rfSlotsFeb = parseRfCsv(rfFeb, 2026, 2);
  const rfSlotsMar = parseRfCsv(rfMar, 2026, 3);
  console.log(`  2월: ${rfSlotsFeb.length}건, 3월: ${rfSlotsMar.length}건`);
  await insertRfSlots([...rfSlotsFeb, ...rfSlotsMar]);

  // 2. 도수 예약현황
  console.log('\n━━━ 2. 도수 예약현황 파싱 ━━━');
  const mtFeb = fs.readFileSync(path.join(baseDir, '도수예약현황', '도수예약현황 - 26.2월.csv'), 'utf-8');
  const mtMar = fs.readFileSync(path.join(baseDir, '도수예약현황', '도수예약현황 - 26.3월.csv'), 'utf-8');
  const mtSlotsFeb = parseManualTherapyCsv(mtFeb);
  const mtSlotsMar = parseManualTherapyCsv(mtMar);
  console.log(`  2월: ${mtSlotsFeb.length}건, 3월: ${mtSlotsMar.length}건`);
  await insertManualSlots([...mtSlotsFeb, ...mtSlotsMar]);

  // 3. 외래 예약
  console.log('\n━━━ 3. 외래 예약 파싱 ━━━');
  const opFeb = fs.readFileSync(path.join(baseDir, '외래환자 예약현황', '외래환자 예약 - 26.2월.csv'), 'utf-8');
  const opMar = fs.readFileSync(path.join(baseDir, '외래환자 예약현황', '외래환자 예약- 26.3.csv'), 'utf-8');
  const opSlotsFeb = parseOutpatientCsv(opFeb, 2026, 2);
  const opSlotsMar = parseOutpatientCsv(opMar, 2026, 3);
  console.log(`  2월: ${opSlotsFeb.length}건, 3월: ${opSlotsMar.length}건`);
  await insertAppointments([...opSlotsFeb, ...opSlotsMar]);

  // Summary
  const rfCount = await prisma.rfScheduleSlot.count({ where: { deletedAt: null } });
  const mtCount = await prisma.manualTherapySlot.count({ where: { deletedAt: null } });
  const apCount = await prisma.appointment.count({ where: { deletedAt: null } });
  console.log(`\n✅ 마이그레이션 완료!`);
  console.log(`  고주파: ${rfCount}건 (DB 총)`);
  console.log(`  도수: ${mtCount}건 (DB 총)`);
  console.log(`  외래: ${apCount}건 (DB 총)`);
}

main()
  .catch((e) => { console.error('❌ 오류:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
