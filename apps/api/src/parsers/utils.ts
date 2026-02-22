import * as fs from 'fs';
import Papa from 'papaparse';

/**
 * Read and parse a CSV file, handling multi-line quoted fields
 */
export function readCsvFile(filePath: string): string[][] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: false,
  });
  return result.data;
}

/**
 * Parse Korean time "오전 09:00" / "오후 02:00" → "09:00" / "14:00"
 */
export function parseKoreanTime(timeStr: string): string | null {
  if (!timeStr) return null;
  const trimmed = timeStr.trim();

  const match = trimmed.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const [, period, hourStr, minute] = match;
  let hour = parseInt(hourStr, 10);

  if (period === '오후' && hour !== 12) {
    hour += 12;
  } else if (period === '오전' && hour === 12) {
    hour = 0;
  }

  return `${hour.toString().padStart(2, '0')}:${minute}`;
}

/**
 * Parse RF time cell "9:00~\n9:30" or "9:00~9:30" → "09:00"
 */
export function parseRfTimeCell(cellValue: string): string | null {
  if (!cellValue) return null;
  const trimmed = cellValue.trim();

  // Pattern: H:MM~ or HH:MM~
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*~/);
  if (!match) return null;

  const [, hour, minute] = match;
  return `${hour.padStart(2, '0')}:${minute}`;
}

/**
 * Calculate end time given start time and duration in minutes
 */
export function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const totalMinutes = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMinutes / 60);
  const endM = totalMinutes % 60;
  return `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
}

/**
 * Parse date from RF header like "02.02  (월)" with given year
 * Returns YYYY-MM-DD
 */
export function parseRfDateHeader(dateStr: string, year: number): string | null {
  if (!dateStr) return null;
  const match = dateStr.trim().match(/^(\d{1,2})\.(\d{1,2})/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/**
 * Parse date from Manual header like "2026.2.2 월"
 * Returns YYYY-MM-DD
 */
export function parseManualDateHeader(dateStr: string): string | null {
  if (!dateStr) return null;
  const match = dateStr.trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr] = match;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/**
 * Extract doctor code prefix from cell value
 * "C이보경" → { doctorCode: "C", remainingText: "이보경" }
 * "j묘지염(온)" → { doctorCode: "J", remainingText: "묘지염(온)" }
 * "C 이보경" → { doctorCode: "C", remainingText: "이보경" }
 */
export function extractDoctorCode(cellValue: string): { doctorCode: string | undefined; remainingText: string } {
  const trimmed = cellValue.trim();

  // Pattern: single letter (C/J/c/j) followed by space or Korean character
  const match = trimmed.match(/^([CcJj])\s*([가-힣].*)/);
  if (match) {
    return {
      doctorCode: match[1].toUpperCase(),
      remainingText: match[2].trim(),
    };
  }

  return { doctorCode: undefined, remainingText: trimmed };
}

/**
 * Extract treatment subtype from patient name string
 * "(온)" → HEAT, "(림프)" → LYMPH, "(신/온)" → HEAT_NEURAL, etc.
 */
export function extractTreatmentSubtype(nameStr: string): {
  subtype: 'HEAT' | 'LYMPH' | 'NEURAL' | 'HEAT_NEURAL' | 'GENERAL' | undefined;
  cleanName: string;
} {
  const trimmed = nameStr.trim();

  // First try: extract full parenthesized suffix e.g., "김선미(신/통림)" → name:"김선미", info:"신/통림"
  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const name = parenMatch[1].trim();
    const content = parenMatch[2]; // 온, 림프, 신/온, 신/통림, 페인, etc.
    const subtype = classifySubtype(content);
    if (subtype) return { subtype, cleanName: name };
  }

  // Second try: /온, /신 suffix without parentheses  e.g., "김미나1/온"
  const slashMatch = trimmed.match(/^(.+?)\/([가-힣]+)\s*$/);
  if (slashMatch) {
    const name = slashMatch[1].trim();
    const subtype = classifySubtype(slashMatch[2]);
    if (subtype) return { subtype, cleanName: name };
  }

  return { subtype: undefined, cleanName: trimmed };
}

function classifySubtype(content: string): 'HEAT' | 'LYMPH' | 'NEURAL' | 'HEAT_NEURAL' | 'GENERAL' | undefined {
  const c = content.trim();
  // Compound types
  if (/신\/?온|온\/?신/.test(c)) return 'HEAT_NEURAL';
  // Single types
  if (c === '온' || c === '온열') return 'HEAT';
  if (c === '림프' || c === '통림' || /통\/?림/.test(c)) return 'LYMPH';
  if (c === '신') return 'NEURAL';
  if (c === '페인') return 'GENERAL';
  // Compound with lymph (신/통림 etc.)
  if (/림/.test(c)) return 'LYMPH';
  if (/온/.test(c)) return 'HEAT';
  if (/신/.test(c)) return 'NEURAL';
  return undefined;
}

/**
 * Check if a cell value represents an empty/separator slot
 */
export function isEmptySlot(cellValue: string): boolean {
  const trimmed = cellValue.trim();
  if (!trimmed) return true;
  if (/^-+$/.test(trimmed)) return true;
  if (trimmed === '--') return true;
  return false;
}

/**
 * Check if a cell value is a waiting/hold/ltu status marker
 */
export function parseStatusMarker(cellValue: string): {
  isStatus: boolean;
  status?: 'WAITING' | 'HOLD' | 'LTU';
  statusNote?: string;
} {
  const trimmed = cellValue.trim();
  const upper = trimmed.toUpperCase();

  // IN, IN20, IN30, IN 20, IN!
  if (/^IN\s*\d*!?\s*$/.test(upper)) {
    return { isStatus: true, status: 'WAITING', statusNote: trimmed };
  }

  // W1, W 1
  if (/^W\s*\d+$/.test(upper)) {
    return { isStatus: true, status: 'HOLD', statusNote: trimmed };
  }

  // LTU
  if (upper === 'LTU') {
    return { isStatus: true, status: 'LTU', statusNote: 'LTU' };
  }

  // IN/LTU combination
  if (upper === 'IN/LTU') {
    return { isStatus: true, status: 'LTU', statusNote: 'IN/LTU' };
  }

  // ltu (lowercase)
  if (trimmed.toLowerCase() === 'ltu') {
    return { isStatus: true, status: 'LTU', statusNote: 'LTU' };
  }

  return { isStatus: false };
}

/**
 * Check if a cell value is an admin work entry
 */
export function isAdminWork(cellValue: string): { isAdmin: boolean; note?: string } {
  const trimmed = cellValue.trim();

  if (trimmed === '전산업무') return { isAdmin: true, note: '전산업무' };
  if (trimmed === '공기압') return { isAdmin: true, note: '공기압' };
  if (/TMS/i.test(trimmed)) return { isAdmin: true, note: trimmed };
  if (/스타킹/.test(trimmed)) return { isAdmin: true, note: trimmed };
  if (/결제/.test(trimmed)) return { isAdmin: true, note: trimmed };

  return { isAdmin: false };
}

/**
 * Check if a cell value is a schedule note (not a patient booking)
 */
export function isScheduleNote(cellValue: string): boolean {
  const trimmed = cellValue.trim();

  const notePatterns = [
    /^병원장님.*휴진/,
    /^\d+시간\s*진행$/,
    /^\d+분\s*진행$/,
    /^\d+:\d+$/,          // bare time like "5:30"
    /^OFF$/i,
    /^MCT$/i,
    /^PRP$/i,
    /^PRF$/i,
    /^교육/,
    /^반차$/,
    /^설날$/,
    /^휴진$/,
    /^확인중$/,
    /^대체공휴/,
    /^연차$/,
  ];

  return notePatterns.some(p => p.test(trimmed));
}

/**
 * Format date range for display
 */
export function formatDateRange(dates: string[]): { start: string; end: string } | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}
