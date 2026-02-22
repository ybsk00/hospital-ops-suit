import { ParsedManualSlot, ParseResult, ParseOptions, ParseError, ManualWeekBlock, ManualDayGroup } from './types';
import {
  readCsvFile, parseKoreanTime, parseManualDateHeader,
  extractDoctorCode, extractTreatmentSubtype,
  isEmptySlot, parseStatusMarker, isAdminWork, isScheduleNote, formatDateRange,
} from './utils';

/**
 * Parse Manual Therapy schedule from raw 2D string array (Google Sheets API or CSV)
 */
export async function parseManualTherapyRows(
  rows: string[][],
  options: ParseOptions
): Promise<ParseResult<ParsedManualSlot>> {
  const slots: ParsedManualSlot[] = [];
  const errors: ParseError[] = [];
  let totalRows = 0;
  let emptySlots = 0;

  const weekBlocks = findManualWeekBlocks(rows);

  for (const block of weekBlocks) {
    for (const dayGroup of block.dayGroups) {
      if (options.dateFilter) {
        if (dayGroup.date < options.dateFilter.start || dayGroup.date > options.dateFilter.end) continue;
      }

      for (let rowIdx = block.dataStartRowIdx; rowIdx <= block.dataEndRowIdx; rowIdx++) {
        const row = rows[rowIdx];
        if (!row) continue;

        const timeCell = (row[dayGroup.startCol] || '').trim();
        const timeSlot = parseKoreanTime(timeCell);
        if (!timeSlot) continue;

        totalRows++;

        for (const { col, name: therapistName } of dayGroup.therapistColumns) {
          const cellValue = (row[col] || '').trim();

          if (!cellValue || isEmptySlot(cellValue)) {
            emptySlots++;
            continue;
          }

          if (isScheduleNote(cellValue)) continue;

          try {
            const parsed = parseManualCell(cellValue, dayGroup.date, timeSlot, therapistName, options);
            if (parsed) {
              slots.push(parsed);
            } else {
              emptySlots++;
            }
          } catch (err: any) {
            errors.push({
              row: rowIdx, column: col, date: dayGroup.date,
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
 * Parse Manual Therapy schedule CSV file
 */
export async function parseManualTherapyCsv(
  filePath: string,
  options: ParseOptions
): Promise<ParseResult<ParsedManualSlot>> {
  const rows = readCsvFile(filePath);
  return parseManualTherapyRows(rows, options);
}

// ── Internal helpers ──

function findManualWeekBlocks(rows: string[][]): ManualWeekBlock[] {
  const blocks: ManualWeekBlock[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    if ((row[0] || '').trim() !== '치료사') continue;

    // Verify column 1 has a date
    const dateCell = (row[1] || '').trim();
    if (!parseManualDateHeader(dateCell)) continue;

    const headerRowIdx = i;
    const therapistRowIdx = i + 1;
    if (therapistRowIdx >= rows.length) continue;

    const dayGroups = extractManualDayGroups(rows, headerRowIdx, therapistRowIdx);
    if (dayGroups.length === 0) continue;

    // Find data end
    let dataEndRowIdx = therapistRowIdx + 1;
    for (let j = therapistRowIdx + 1; j < rows.length; j++) {
      const fc = (rows[j][0] || '').trim();

      // "비고" row = notes section
      if (fc === '비고') { dataEndRowIdx = j - 1; break; }

      // Next "치료사" header = next week
      if (fc === '치료사' && parseManualDateHeader((rows[j][1] || '').trim())) {
        dataEndRowIdx = j - 1; break;
      }

      // Month section header "N월" after some data rows
      if (/^\d+월\s*$/.test(fc) && j > therapistRowIdx + 2) {
        dataEndRowIdx = j - 1; break;
      }

      dataEndRowIdx = j;
    }

    blocks.push({
      headerRowIdx, therapistRowIdx,
      dataStartRowIdx: therapistRowIdx + 1,
      dataEndRowIdx,
      dayGroups,
    });

    i = dataEndRowIdx; // skip past this block
  }

  return blocks;
}

function extractManualDayGroups(
  rows: string[][],
  headerRowIdx: number,
  therapistRowIdx: number
): ManualDayGroup[] {
  const headerRow = rows[headerRowIdx];
  const therapistRow = rows[therapistRowIdx];
  const groups: ManualDayGroup[] = [];

  // Find all "치료사" column positions
  const groupStarts: number[] = [];
  for (let col = 0; col < headerRow.length; col++) {
    if ((headerRow[col] || '').trim() === '치료사') {
      groupStarts.push(col);
    }
  }

  for (let g = 0; g < groupStarts.length; g++) {
    const startCol = groupStarts[g];
    const endCol = g + 1 < groupStarts.length ? groupStarts[g + 1] : headerRow.length;

    const dateCell = (headerRow[startCol + 1] || '').trim();
    const date = parseManualDateHeader(dateCell);
    if (!date) continue;

    // Collect therapist names from the row below
    const therapistColumns: { col: number; name: string }[] = [];
    for (let col = startCol + 1; col < endCol; col++) {
      const name = (therapistRow[col] || '').trim();
      if (name) {
        therapistColumns.push({ col, name });
      }
    }

    if (therapistColumns.length > 0) {
      groups.push({ date, startCol, therapistColumns });
    }
  }

  return groups;
}

function parseManualCell(
  cellValue: string,
  date: string,
  timeSlot: string,
  therapistName: string,
  options: ParseOptions
): ParsedManualSlot | null {
  const trimmed = cellValue.trim();

  // Status markers: IN, IN20, W1, LTU
  const statusResult = parseStatusMarker(trimmed);
  if (statusResult.isStatus) {
    return {
      date, timeSlot, therapistName,
      status: statusResult.status!,
      statusNote: statusResult.statusNote,
      isAdminWork: false,
      rawCellValue: cellValue,
      sheetSource: options.sheetSource,
    };
  }

  // Admin work: 전산업무, TMS, 스타킹 결제
  const adminResult = isAdminWork(trimmed);
  if (adminResult.isAdmin) {
    return {
      date, timeSlot, therapistName,
      status: 'BOOKED',
      isAdminWork: true,
      adminWorkNote: adminResult.note,
      rawCellValue: cellValue,
      sheetSource: options.sheetSource,
    };
  }

  // Normal patient booking
  const { doctorCode, remainingText } = extractDoctorCode(trimmed);
  const { subtype, cleanName } = extractTreatmentSubtype(remainingText);

  if (!cleanName) return null;

  return {
    date, timeSlot, therapistName,
    patientNameRaw: cleanName,
    doctorCode,
    status: 'BOOKED',
    treatmentSubtype: subtype,
    isAdminWork: false,
    rawCellValue: cellValue,
    sheetSource: options.sheetSource,
  };
}
