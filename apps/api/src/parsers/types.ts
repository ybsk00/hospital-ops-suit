// ── Parsed slot types ──

export interface ParsedRfSlot {
  date: string;              // YYYY-MM-DD
  startTime: string;         // HH:MM (24h)
  endTime: string;           // HH:MM (24h)
  durationMinutes: number;   // 30, 60, 90, 120, 180
  roomNumber: number;        // 1~15
  patientEmrId?: string;     // chart number from sheet
  patientNameRaw?: string;   // original name from sheet
  doctorCode?: string;       // C, J etc.
  status: 'BOOKED' | 'BLOCKED';
  specialType?: 'INFUSION_USE' | 'DEVICE_USE' | 'BLOCKED';
  rawCellValue: string;      // original cell text
  sheetSource: string;       // tab/file name
}

export interface ParsedManualSlot {
  date: string;              // YYYY-MM-DD
  timeSlot: string;          // HH:MM (24h)
  therapistName: string;     // 신예진, 김한솔, 김다현
  patientNameRaw?: string;   // original name
  doctorCode?: string;       // C, J etc.
  status: 'BOOKED' | 'WAITING' | 'HOLD' | 'LTU';
  treatmentSubtype?: 'HEAT' | 'LYMPH' | 'NEURAL' | 'HEAT_NEURAL' | 'GENERAL';
  statusNote?: string;       // IN, IN20, W1 etc.
  isAdminWork: boolean;
  adminWorkNote?: string;    // "서아라TMS", "전산업무" etc.
  rawCellValue: string;
  sheetSource: string;
}

// ── Parse result & options ──

export interface ParseResult<T> {
  slots: T[];
  errors: ParseError[];
  stats: ParseStats;
}

export interface ParseStats {
  totalRows: number;
  parsedSlots: number;
  emptySlots: number;
  errorCount: number;
  dateRange: { start: string; end: string } | null;
  slotsByDate: Record<string, number>;
}

export interface ParseError {
  row?: number;
  column?: number;
  date?: string;
  message: string;
  rawValue?: string;
}

export interface ParseOptions {
  sheetSource: string;
  includeEmpty?: boolean;
  dateFilter?: { start: string; end: string };
  year?: number;  // override year (default: from CSV header)
}

// ── RF-specific internal types ──

export interface RfDayGroup {
  date: string;          // YYYY-MM-DD
  startCol: number;      // column index where this day group starts
  roomColumns: number[]; // column indices for rooms 1-15
}

export interface RfWeekBlock {
  dateHeaderRowIdx: number;
  roomHeaderRowIdx: number;
  dataStartRowIdx: number;
  dataEndRowIdx: number;
  dayGroups: RfDayGroup[];
}

// ── Manual-specific internal types ──

export interface ManualDayGroup {
  date: string;
  startCol: number;
  therapistColumns: { col: number; name: string }[];
}

export interface ManualWeekBlock {
  headerRowIdx: number;
  therapistRowIdx: number;
  dataStartRowIdx: number;
  dataEndRowIdx: number;
  dayGroups: ManualDayGroup[];
}
