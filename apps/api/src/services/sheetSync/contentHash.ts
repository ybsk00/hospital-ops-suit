import { createHash } from 'crypto';
import type { ParsedRfSlot, ParsedManualSlot } from '../../parsers/types';
import type { ParsedOutpatientAppointment } from '../outpatientParser';

/**
 * Compute SHA-256 hash of normalized slot list.
 * Based on parsing result, not raw sheet content — avoids unnecessary
 * re-syncs due to formatting/whitespace changes in the sheet.
 */
export function computeRfContentHash(slots: ParsedRfSlot[]): string {
  const normalized = slots
    .map(s => `${s.date}|${s.startTime}|${s.roomNumber}|${s.rawCellValue}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export function computeManualContentHash(slots: ParsedManualSlot[]): string {
  const normalized = slots
    .map(s => `${s.date}|${s.timeSlot}|${s.therapistName}|${s.rawCellValue}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export function computeWardContentHash(rows: string[][]): string {
  // Hash the full 2D array content (non-empty cells only)
  const cells: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const v = String(rows[r][c] ?? '').trim();
      if (v) cells.push(`${r},${c}:${v}`);
    }
  }
  cells.sort();
  return createHash('sha256').update(cells.join('\n')).digest('hex');
}

export function computeOutpatientContentHash(appts: ParsedOutpatientAppointment[]): string {
  const normalized = appts
    .map(a => `${a.sheetTab}|${a.sheetA1Name}|${a.patientNameRaw}|${a.doctorCode}|${a.phoneNumber}|${a.treatmentContent}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}
