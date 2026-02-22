/**
 * Outpatient Appointment Parser (외래 예약 시트 파서)
 * - 6일 × 6컬럼 구조 파싱
 * - A1 좌표 기반 멱등성 보장 (sheetA1Name)
 * - slotIndex는 UI 표시/정렬용 (멱등성 키 아님)
 */

// 0-indexed 컬럼 → A1 표기법 ("A", "Z", "AA", "AJ"...)
export function colToA1(colIdx: number): string {
  let col = colIdx + 1; // 1-indexed
  let s = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

// DATE_HEADER_PATTERN: "2.2(월)", "3/2(월)" 둘 다 허용
const DATE_HEADER_PATTERN = /(\d{1,2})[./](\d{1,2})\s*\(([월화수목금토일])\)/;
const TIME_SLOT_PATTERN = /(오전|오후)\s*(\d{1,2}):(\d{2})/;

const DAYS_PER_WEEK = 6;
const COLS_PER_DAY = 6;

export interface ParsedOutpatientAppointment {
  appointmentDate: Date;
  timeSlot: string;         // "09:30"
  doctorCode: string | null; // "C" | "J" | null
  slotIndex: number;        // UI 표시용
  patientNameRaw: string;
  isNewPatient: boolean;
  phoneNumber: string;
  treatmentContent: string;
  rawCellValue: string;
  sheetTab: string;
  sheetA1Name: string;      // 이름칸 좌표 (소스 identity 키)
  sheetA1Doctor: string;    // 주치의칸 좌표
  sheetA1Phone: string;     // 연락처칸 좌표
  sheetA1Content: string;   // 내용칸 좌표
}

function getCell(row: string[], idx: number): string {
  return idx < row.length ? String(row[idx] ?? '').trim() : '';
}

function to24h(amPm: string, h: number, m: number): string {
  if (amPm === '오후' && h !== 12) h += 12;
  if (amPm === '오전' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function findDateRow(
  values: string[][],
  year: number,
): { rowIdx: number; dateMap: Map<number, Date> } | null {
  for (let rowIdx = 0; rowIdx < values.length; rowIdx++) {
    const row = values[rowIdx];
    const dateMap = new Map<number, Date>();

    for (let ci = 0; ci < row.length; ci++) {
      const cell = String(row[ci] ?? '');
      const m = DATE_HEADER_PATTERN.exec(cell);
      if (m) {
        const dayIdx = Math.floor(ci / COLS_PER_DAY);
        dateMap.set(dayIdx, new Date(year, parseInt(m[1]) - 1, parseInt(m[2])));
      }
    }

    if (dateMap.size >= 4) {
      return { rowIdx, dateMap };
    }
  }
  return null;
}

/**
 * 외래 예약 시트 2D 배열 → ParsedOutpatientAppointment 리스트
 * @param values Sheets API values (2D string array)
 * @param year 연도 (기본: 현재 연도)
 * @param sheetTab 탭명 (예: "26.2", "26.3")
 */
export function parseOutpatientSheet(
  values: string[][],
  year: number = new Date().getFullYear(),
  sheetTab: string = '',
): ParsedOutpatientAppointment[] {
  const appointments: ParsedOutpatientAppointment[] = [];

  const found = findDateRow(values, year);
  if (!found) return [];

  const { rowIdx: dateRowIdx, dateMap } = found;

  for (let dayIdx = 0; dayIdx < DAYS_PER_WEEK; dayIdx++) {
    const colStart = dayIdx * COLS_PER_DAY;
    const slotDate = dateMap.get(dayIdx);
    if (!slotDate) continue;

    let currentTime: string | null = null;

    // slotIndex: (timeSlot, doctorCode) 조합별 독립 카운트
    // doctorCode 없으면 "UNKNOWN" 버킷
    const slotCounters = new Map<string, number>();

    for (let r = dateRowIdx + 2; r < values.length; r++) {
      const row = values[r];

      // 시간 슬롯 행
      const timeRaw = getCell(row, colStart);
      const tmMatch = TIME_SLOT_PATTERN.exec(timeRaw);
      if (tmMatch) {
        currentTime = to24h(tmMatch[1], parseInt(tmMatch[2]), parseInt(tmMatch[3]));
        continue;
      }

      if (!currentTime) continue;

      const nameRaw = getCell(row, colStart + 1);
      const doctorRaw = getCell(row, colStart + 2).toUpperCase() || null;
      const phone = getCell(row, colStart + 3);
      const content = getCell(row, colStart + 4);

      if (!nameRaw) continue;

      // slotIndex 증가
      const counterKey = `${currentTime}|${doctorRaw ?? 'UNKNOWN'}`;
      const slotIndex = (slotCounters.get(counterKey) ?? 0) + 1;
      slotCounters.set(counterKey, slotIndex);

      // A1 좌표 (1-indexed row)
      const rowNum = r + 1;

      appointments.push({
        appointmentDate: slotDate,
        timeSlot: currentTime,
        doctorCode: doctorRaw,
        slotIndex,
        patientNameRaw: nameRaw,
        isNewPatient: /신\/|\/신/.test(nameRaw),
        phoneNumber: phone,
        treatmentContent: content,
        rawCellValue: `${nameRaw},${doctorRaw},${phone},${content}`,
        sheetTab,
        sheetA1Name: `${colToA1(colStart + 1)}${rowNum}`,
        sheetA1Doctor: `${colToA1(colStart + 2)}${rowNum}`,
        sheetA1Phone: `${colToA1(colStart + 3)}${rowNum}`,
        sheetA1Content: `${colToA1(colStart + 4)}${rowNum}`,
      });
    }
  }

  return appointments;
}

/**
 * sourceKey 생성 (A1 이동 감지용)
 * sha1(sheetTab + appointmentDate + timeSlot + rawCellValue)
 */
import { createHash } from 'crypto';
export function buildSourceKey(
  sheetTab: string,
  appointmentDate: Date,
  timeSlot: string,
  rawCellValue: string,
): string {
  const input = `${sheetTab}|${appointmentDate.toISOString().slice(0, 10)}|${timeSlot}|${rawCellValue}`;
  return createHash('sha1').update(input).digest('hex');
}
