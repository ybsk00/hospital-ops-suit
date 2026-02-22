import { ParsedRfSlot, ParseResult, ParseOptions, ParseError, RfWeekBlock, RfDayGroup } from './types';
import { readCsvFile, parseRfTimeCell, parseRfDateHeader, calculateEndTime, formatDateRange } from './utils';

const RF_VALID_START = '09:00';
const RF_VALID_END = '16:30';
const RF_DEFAULT_DURATION = 30;

/**
 * Parse RF schedule from raw 2D string array (Google Sheets API or CSV)
 */
export async function parseRfScheduleRows(
  rows: string[][],
  options: ParseOptions
): Promise<ParseResult<ParsedRfSlot>> {
  const slots: ParsedRfSlot[] = [];
  const errors: ParseError[] = [];
  let totalRows = 0;
  let emptySlots = 0;

  const year = options.year || extractYear(rows);
  if (!year) {
    errors.push({ message: 'Could not determine year from header' });
    return {
      slots, errors,
      stats: { totalRows: 0, parsedSlots: 0, emptySlots: 0, errorCount: 1, dateRange: null, slotsByDate: {} },
    };
  }

  const weekBlocks = findRfWeekBlocks(rows, year);

  for (const block of weekBlocks) {
    for (const dayGroup of block.dayGroups) {
      if (options.dateFilter) {
        if (dayGroup.date < options.dateFilter.start || dayGroup.date > options.dateFilter.end) continue;
      }

      for (let rowIdx = block.dataStartRowIdx; rowIdx <= block.dataEndRowIdx; rowIdx++) {
        const row = rows[rowIdx];
        if (!row) continue;

        const timeCell = row[dayGroup.startCol] || '';
        const startTime = parseRfTimeCell(timeCell);
        if (!startTime) continue;

        if (startTime < RF_VALID_START || startTime > RF_VALID_END) continue;

        totalRows++;

        for (const roomCol of dayGroup.roomColumns) {
          const roomNumber = roomCol - dayGroup.startCol;
          const cellValue = (row[roomCol] || '').trim();

          if (!cellValue) {
            emptySlots++;
            continue;
          }

          try {
            const parsed = parseRfCell(cellValue, dayGroup.date, startTime, roomNumber, options);
            if (parsed) {
              slots.push(parsed);
            } else {
              emptySlots++;
            }
          } catch (err: any) {
            errors.push({
              row: rowIdx, column: roomCol, date: dayGroup.date,
              message: err.message, rawValue: cellValue,
            });
          }
        }
      }
    }
  }

  const allDates = [...new Set(slots.map(s => s.date))];
  const slotsByDate: Record<string, number> = {};
  for (const s of slots) {
    slotsByDate[s.date] = (slotsByDate[s.date] || 0) + 1;
  }

  return {
    slots, errors,
    stats: {
      totalRows, parsedSlots: slots.length, emptySlots,
      errorCount: errors.length,
      dateRange: formatDateRange(allDates),
      slotsByDate,
    },
  };
}

/**
 * Parse RF schedule CSV file
 */
export async function parseRfScheduleCsv(
  filePath: string,
  options: ParseOptions
): Promise<ParseResult<ParsedRfSlot>> {
  const rows = readCsvFile(filePath);
  return parseRfScheduleRows(rows, options);
}

// ── Internal helpers ──

function extractYear(rows: string[][]): number | null {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const firstCell = (rows[i][0] || '').trim();
    const yearMatch = firstCell.match(/^(\d{4})$/);
    if (yearMatch) return parseInt(yearMatch[1], 10);
  }
  return null;
}

/**
 * Find all week blocks by scanning for room header rows (FALSE, 1, 2, ..., 15)
 */
function findRfWeekBlocks(rows: string[][], year: number): RfWeekBlock[] {
  const blocks: RfWeekBlock[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !isRoomHeaderRow(row)) continue;

    const roomHeaderRowIdx = i;
    const dateHeaderRowIdx = i - 1;

    const dayGroups = extractRfDayGroups(rows, dateHeaderRowIdx, roomHeaderRowIdx, year);
    if (dayGroups.length === 0) continue;

    // Find data end: next room header row or end of data section
    let dataEndRowIdx = i + 1;
    for (let j = i + 1; j < rows.length; j++) {
      if (isRoomHeaderRow(rows[j])) {
        // Go back to find the actual end (skip blank/header rows before next block)
        dataEndRowIdx = j - 2; // -2 because room header has date row above it
        break;
      }
      dataEndRowIdx = j;
    }

    blocks.push({
      dateHeaderRowIdx, roomHeaderRowIdx,
      dataStartRowIdx: i + 1,
      dataEndRowIdx,
      dayGroups,
    });
  }

  return blocks;
}

function isRoomHeaderRow(row: string[]): boolean {
  if (!row || row.length < 5) return false;
  const firstVal = (row[0] || '').trim().toUpperCase();
  if (firstVal !== 'FALSE') return false;

  // Require at least rooms 1, 2, 3 to be present (some months have fewer rooms)
  for (let i = 1; i <= 3; i++) {
    if ((row[i] || '').trim() !== String(i)) return false;
  }
  return true;
}

function extractRfDayGroups(
  rows: string[][],
  dateHeaderRowIdx: number,
  roomHeaderRowIdx: number,
  year: number
): RfDayGroup[] {
  const roomRow = rows[roomHeaderRowIdx];
  const dateRow = dateHeaderRowIdx >= 0 ? rows[dateHeaderRowIdx] : [];
  const groups: RfDayGroup[] = [];

  // Find all "FALSE" positions in room header row — each marks a day group
  for (let col = 0; col < roomRow.length; col++) {
    if ((roomRow[col] || '').trim().toUpperCase() !== 'FALSE') continue;

    const startCol = col;
    const roomColumns: number[] = [];
    for (let r = 1; r <= 15; r++) {
      const roomColIdx = col + r;
      if (roomColIdx < roomRow.length && (roomRow[roomColIdx] || '').trim() === String(r)) {
        roomColumns.push(roomColIdx);
      }
    }

    // Extract date from header row — scan offsets 1~10 for MM.DD pattern
    let date: string | null = null;
    if (dateRow.length > 0) {
      for (let offset = 1; offset <= 10; offset++) {
        const dateColIdx = col + offset;
        if (dateColIdx < dateRow.length) {
          date = parseRfDateHeader((dateRow[dateColIdx] || '').trim(), year);
          if (date) break;
        }
      }
    }

    if (date && roomColumns.length > 0) {
      groups.push({ date, startCol, roomColumns });
    }
  }

  return groups;
}

/**
 * Parse a single RF cell value into a slot
 * Multi-line format: chartNumber\npatientName\n(doctorCode)\nduration분
 */
function parseRfCell(
  cellValue: string,
  date: string,
  startTime: string,
  roomNumber: number,
  options: ParseOptions
): ParsedRfSlot | null {
  const lines = cellValue.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return null;

  // Check for special types (수액실, 황출기, 문의)
  const specialResult = detectSpecialType(lines);
  if (specialResult.isSpecial) {
    return {
      date, startTime,
      endTime: calculateEndTime(startTime, RF_DEFAULT_DURATION),
      durationMinutes: RF_DEFAULT_DURATION,
      roomNumber,
      patientNameRaw: specialResult.patientName,
      status: 'BLOCKED',
      specialType: specialResult.specialType!,
      rawCellValue: cellValue,
      sheetSource: options.sheetSource,
    };
  }

  // Parse normal patient cell
  let patientEmrId: string | undefined;
  let patientNameRaw: string | undefined;
  let doctorCode: string | undefined;
  let durationMinutes = RF_DEFAULT_DURATION;

  for (const line of lines) {
    // Chart number: 4-6 digits
    if (/^\d{4,6}$/.test(line)) {
      patientEmrId = line;
      continue;
    }

    // Doctor code: (C), (J), (C, (J — with or without closing paren
    const doctorMatch = line.match(/^\(([A-Za-z])\)?$/);
    if (doctorMatch) {
      doctorCode = doctorMatch[1].toUpperCase();
      continue;
    }

    // Duration: NNN분
    const durationMatch = line.match(/^(\d+)\s*분$/);
    if (durationMatch) {
      durationMinutes = parseInt(durationMatch[1], 10);
      continue;
    }

    // Inf label: (inf.A), (inf.B) — skip
    if (/^\(inf\.\w+\)$/i.test(line)) continue;

    // Procedure/note markers — skip (not patient names)
    if (/^\(?(?:PRP|PRF|MCT)\)?$/i.test(line)) continue;
    if (/^(?:교육|시행|준비|세팅|정리)/.test(line)) continue;

    // Otherwise, it's the patient name
    if (!patientNameRaw) {
      patientNameRaw = line;
    }
  }

  // Skip if no meaningful data
  if (!patientNameRaw && !patientEmrId) return null;

  return {
    date, startTime,
    endTime: calculateEndTime(startTime, durationMinutes),
    durationMinutes, roomNumber,
    patientEmrId, patientNameRaw, doctorCode,
    status: 'BOOKED',
    rawCellValue: cellValue,
    sheetSource: options.sheetSource,
  };
}

function detectSpecialType(lines: string[]): {
  isSpecial: boolean;
  specialType?: 'INFUSION_USE' | 'DEVICE_USE' | 'BLOCKED';
  patientName?: string;
} {
  const fullText = lines.join(' ');
  const lower = fullText.toLowerCase();

  if (lower.includes('수액실')) {
    const nameLine = lines.find(l =>
      !l.includes('수액실') && !l.includes('사용') && !/^\(/.test(l)
    );
    return { isSpecial: true, specialType: 'INFUSION_USE', patientName: nameLine };
  }

  if (lower.includes('황출기')) {
    const nameLine = lines.find(l => !l.includes('황출기'));
    return { isSpecial: true, specialType: 'DEVICE_USE', patientName: nameLine };
  }

  if (lower.includes('문의')) {
    return { isSpecial: true, specialType: 'BLOCKED' };
  }

  return { isSpecial: false };
}
