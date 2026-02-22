/**
 * Ward Admission Parser (입원현황 시트 파서)
 * - 멀티라인 셀 → WardAdmission 복수 생성
 * - sheetLineIndex로 줄 단위 식별
 * - SIDE_MEMO는 영역 기반 config로 분리
 */

import { WardAdmissionStatus, WardSheetRegion, BedPos, WardType } from '@prisma/client';

// ── 날짜/시간 패턴 ──
const DATE_PATTERN = /(\d{1,2})\/(\d{1,2})(?:~(\d{1,2})\/(\d{1,2})|~(\d{1,2}))?/;
const TIME_PATTERN = /(\d{1,2})시(반)?/;

// ── 진단 키워드 ──
const DIAGNOSIS_KEYWORDS = [
  '췌장', '유방', '담도', '위암', '난소', '폐암', '갑상선',
  '방광', '식도암', '골육종', '뇌종양', '자율', '상+', '간암',
  '신장', '대장', '전립선', '자궁', '갑상', '직장', '폐',
];

// ── 상태 키워드 매핑 ──
const STATUS_KEYWORD_MAP: Record<string, WardAdmissionStatus> = {
  '대기': 'WAITING',
  '확정': 'PLANNED',
  '퇴원예정': 'ADMITTED',
  '퇴원': 'DISCHARGED',
  '취소': 'CANCELLED',
};

export interface ParsedAdmission {
  patientNameRaw: string;
  diagnosis: string | null;
  admitDate: Date | null;
  dischargeDate: Date | null;
  dischargeTime: string | null;
  status: WardAdmissionStatus;
  isPlanned: boolean;
  memoRaw: string;
  sheetLineIndex: number;
}

export interface ParsedWaitingMemo {
  content: string;
  sheetA1: string;
  wardType: WardType;
}

/**
 * 멀티라인 셀 → ParsedAdmission 리스트
 */
export function parseWardCell(
  raw: string,
  sheetA1: string,
  region: WardSheetRegion,
  year: number = new Date().getFullYear(),
): ParsedAdmission[] {
  const results: ParsedAdmission[] = [];
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 상태 키워드 줄 (날짜 없음) → 메모 처리
    const matchedStatus = Object.entries(STATUS_KEYWORD_MAP).find(
      ([kw]) => line.includes(kw) && !DATE_PATTERN.test(line)
    );
    if (matchedStatus) {
      results.push({
        patientNameRaw: '',
        diagnosis: null,
        admitDate: null,
        dischargeDate: null,
        dischargeTime: null,
        status: matchedStatus[1],
        isPlanned: region === 'PLANNED',
        memoRaw: line,
        sheetLineIndex: i,
      });
      continue;
    }

    const item = parseLine(line, raw, year, region, i);
    if (item) {
      results.push(item);
    }
  }

  return results;
}

function parseLine(
  line: string,
  rawCell: string,
  year: number,
  region: WardSheetRegion,
  lineIndex: number,
): ParsedAdmission | null {
  const diagnosis = DIAGNOSIS_KEYWORDS.find(kw => line.includes(kw)) ?? null;

  const dateMatch = DATE_PATTERN.exec(line);
  let admitDate: Date | null = null;
  let dischargeDate: Date | null = null;
  let dischargeTime: string | null = null;

  if (dateMatch) {
    const mo = parseInt(dateMatch[1]);
    const d = parseInt(dateMatch[2]);
    admitDate = new Date(year, mo - 1, d);

    if (dateMatch[3] && dateMatch[4]) {
      dischargeDate = new Date(year, parseInt(dateMatch[3]) - 1, parseInt(dateMatch[4]));
    } else if (dateMatch[5]) {
      dischargeDate = new Date(year, mo - 1, parseInt(dateMatch[5]));
    }
  }

  const timeMatch = TIME_PATTERN.exec(line);
  if (timeMatch) {
    const h = parseInt(timeMatch[1]);
    const half = timeMatch[2] === '반';
    dischargeTime = `${String(h).padStart(2, '0')}:${half ? '30' : '00'}`;
  }

  // 이름 추출: 날짜 패턴 앞 부분, 진단 키워드·숫자 제거
  let nameRaw = dateMatch ? line.substring(0, dateMatch.index) : line;
  nameRaw = nameRaw.replace(new RegExp(`(${DIAGNOSIS_KEYWORDS.join('|')})`, 'g'), '');
  nameRaw = nameRaw.replace(/\d+/g, '').trim();
  // 괄호·특수문자 정리
  nameRaw = nameRaw.replace(/[()~\-]/g, '').trim();

  if (!nameRaw && admitDate === null) {
    return null;
  }

  return {
    patientNameRaw: nameRaw,
    diagnosis,
    admitDate,
    dischargeDate,
    dischargeTime,
    status: region === 'PLANNED' ? 'PLANNED' : 'ADMITTED',
    isPlanned: region === 'PLANNED',
    memoRaw: rawCell,
    sheetLineIndex: lineIndex,
  };
}

// ── bedKey 생성 ──
export function makeBedKey(roomNumber: string, bedPosition: BedPos): string {
  if (bedPosition === 'SINGLE') return roomNumber;
  return `${roomNumber}_${bedPosition}`;
}

// ── A1 좌표 영역 분류 ──
export interface WardSyncConfig {
  bedGridRanges: string[];  // "B4:I14"
  memoRanges: string[];     // "J4:L14"
}

export const DEFAULT_WARD_CONFIG: WardSyncConfig = {
  bedGridRanges: [
    'B4:I14',   // 1인실 (101~107)
    'B16:G26',  // 2인실 (201~203)
    'B28:J42',  // 4인실 (301~304)
  ],
  memoRanges: [
    'J4:L14',   // 1인실 우측 메모
    'J16:L26',  // 2인실 우측 메모
    'J28:L42',  // 4인실 우측 메모
  ],
};

function a1ToRowCol(a1: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(a1.toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: parseInt(match[2]), col };
}

function parseA1Range(range: string): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
  const [start, end] = range.split(':');
  const s = a1ToRowCol(start);
  const e = a1ToRowCol(end);
  if (!s || !e) return null;
  return {
    minRow: Math.min(s.row, e.row),
    maxRow: Math.max(s.row, e.row),
    minCol: Math.min(s.col, e.col),
    maxCol: Math.max(s.col, e.col),
  };
}

export type CellRegion = 'BED_GRID' | 'MEMO' | 'UNKNOWN';

export function classifyCellRegion(a1: string, config: WardSyncConfig): CellRegion {
  const pos = a1ToRowCol(a1);
  if (!pos) return 'UNKNOWN';

  for (const rangeStr of config.bedGridRanges) {
    const r = parseA1Range(rangeStr);
    if (r && pos.row >= r.minRow && pos.row <= r.maxRow &&
        pos.col >= r.minCol && pos.col <= r.maxCol) {
      return 'BED_GRID';
    }
  }
  for (const rangeStr of config.memoRanges) {
    const r = parseA1Range(rangeStr);
    if (r && pos.row >= r.minRow && pos.row <= r.maxRow &&
        pos.col >= r.minCol && pos.col <= r.maxCol) {
      return 'MEMO';
    }
  }
  return 'UNKNOWN';
}
