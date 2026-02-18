import * as XLSX from 'xlsx';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Gemini 클라이언트 (LLM + 임베딩 + Vision)
let genai: GoogleGenerativeAI | null = null;
function getGemini(): GoogleGenerativeAI {
  if (!genai) {
    genai = new GoogleGenerativeAI(env.GEMINI_API_KEY || '');
  }
  return genai;
}

// 지원하는 이미지 MIME 타입
const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// 응급 기준
const EMERGENCY_CRITERIA = {
  Hb: { low: 7.0 },
  PLT: { low: 20000 },
  WBC: { low: 1000, high: 30000 },
  K: { low: 2.5, high: 6.0 },
  Na: { low: 120, high: 160 },
  Cr: { high: 5.0 },
};

// 파싱된 결과 타입
interface ParsedResult {
  patientName: string;
  emrPatientId?: string;
  results: Array<{
    testName: string;
    analyte: string;
    value: number;
    unit: string;
    refLow?: number;
    refHigh?: number;
  }>;
}

/**
 * 업로드된 파일들을 분석
 */
export async function analyzeLabUploads(uploadIds: string[]): Promise<void> {
  for (const uploadId of uploadIds) {
    try {
      await analyzeOneUpload(uploadId);
    } catch (err: any) {
      console.error(`[LabAnalysis] Upload ${uploadId} 분석 실패:`, err.message);
      await prisma.labUpload.update({
        where: { id: uploadId },
        data: { status: 'FAILED', errorMessage: err.message },
      });
    }
  }
}

/**
 * 단일 파일 분석
 */
async function analyzeOneUpload(uploadId: string): Promise<void> {
  const upload = await prisma.labUpload.findUnique({ where: { id: uploadId } });
  if (!upload) throw new Error('업로드 파일을 찾을 수 없습니다.');

  // Step 1: 파일 파싱
  let parsedResults: ParsedResult[];

  if (upload.fileType === 'xlsx' || upload.fileType === 'xls' || upload.fileType === 'csv') {
    parsedResults = parseExcelFile(upload.storagePath, upload.fileType);
  } else if (upload.fileType === 'pdf') {
    // PDF → Gemini Vision OCR
    parsedResults = await parsePdfWithVision(upload.storagePath);
  } else if (IMAGE_MIME_TYPES[upload.fileType]) {
    // 이미지 → Gemini Vision OCR
    parsedResults = await parseImageWithVision(upload.storagePath, upload.fileType);
  } else {
    throw new Error(`지원하지 않는 파일 형식: ${upload.fileType}`);
  }

  if (parsedResults.length === 0) {
    throw new Error('파일에서 검사결과를 추출할 수 없습니다.');
  }

  // Step 2-5: 각 환자별 분석
  for (const parsed of parsedResults) {
    await processOnePatient(uploadId, parsed);
  }

  // 분석 완료
  await prisma.labUpload.update({
    where: { id: uploadId },
    data: { status: 'ANALYZED' },
  });
}

/**
 * 엑셀/CSV 파일 파싱
 */
function parseExcelFile(filePath: string, fileType: string): ParsedResult[] {
  const workbook = XLSX.readFile(filePath);
  const results: ParsedResult[] = [];

  // 첫 번째 시트 사용
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });

  if (data.length === 0) return [];

  // 열 이름 매핑 (다양한 형식 지원)
  const columnMappings: Record<string, string[]> = {
    patientName: ['환자명', '이름', 'Name', 'Patient', '성명'],
    emrPatientId: ['차트번호', 'EMR', 'ID', '등록번호', 'PatientID', 'ChartNo'],
    testName: ['검사명', '검사항목', 'Test', 'TestName', '항목명'],
    analyte: ['분석물', 'Analyte', '분석항목', 'Item'],
    value: ['결과', '수치', 'Value', 'Result', '결과값'],
    unit: ['단위', 'Unit'],
    refLow: ['참고하한', '하한', 'RefLow', 'Low', 'Min'],
    refHigh: ['참고상한', '상한', 'RefHigh', 'High', 'Max'],
  };

  // 실제 열 이름 찾기
  const firstRow = data[0];
  const columns = Object.keys(firstRow);

  const findColumn = (mappings: string[]): string | null => {
    for (const col of columns) {
      const lowerCol = col.toLowerCase();
      for (const mapping of mappings) {
        if (lowerCol.includes(mapping.toLowerCase())) return col;
      }
    }
    return null;
  };

  const colPatientName = findColumn(columnMappings.patientName);
  const colEmrId = findColumn(columnMappings.emrPatientId);
  const colTestName = findColumn(columnMappings.testName);
  const colAnalyte = findColumn(columnMappings.analyte);
  const colValue = findColumn(columnMappings.value);
  const colUnit = findColumn(columnMappings.unit);
  const colRefLow = findColumn(columnMappings.refLow);
  const colRefHigh = findColumn(columnMappings.refHigh);

  if (!colPatientName || !colValue) {
    throw new Error('필수 열(환자명, 결과)을 찾을 수 없습니다.');
  }

  // 환자별로 그룹핑
  const patientMap = new Map<string, ParsedResult>();

  for (const row of data) {
    const patientName = String(row[colPatientName] || '').trim();
    if (!patientName) continue;

    const emrId = colEmrId ? String(row[colEmrId] || '').trim() : undefined;
    const key = emrId || patientName;

    if (!patientMap.has(key)) {
      patientMap.set(key, {
        patientName,
        emrPatientId: emrId,
        results: [],
      });
    }

    const value = parseFloat(row[colValue]);
    if (isNaN(value)) continue;

    patientMap.get(key)!.results.push({
      testName: colTestName ? String(row[colTestName] || '검사').trim() : '검사',
      analyte: colAnalyte ? String(row[colAnalyte] || '항목').trim() : (colTestName ? String(row[colTestName] || '항목').trim() : '항목'),
      value,
      unit: colUnit ? String(row[colUnit] || '').trim() : '',
      refLow: colRefLow ? parseFloat(row[colRefLow]) || undefined : undefined,
      refHigh: colRefHigh ? parseFloat(row[colRefHigh]) || undefined : undefined,
    });
  }

  return Array.from(patientMap.values());
}

/**
 * 환자 1명 분석 처리
 */
async function processOnePatient(uploadId: string, parsed: ParsedResult): Promise<void> {
  // Step 2: 환자 DB 조회/생성
  let patient = null;

  // emrPatientId가 있으면 먼저 조회
  if (parsed.emrPatientId) {
    patient = await prisma.patient.findUnique({
      where: { emrPatientId: parsed.emrPatientId },
    });
  }

  // 환자가 없으면 신규 생성 (emrPatientId가 없어도 생성)
  if (!patient) {
    const tempEmrId = parsed.emrPatientId || `LAB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    patient = await prisma.patient.create({
      data: {
        emrPatientId: tempEmrId,
        name: parsed.patientName || '미상',
        dob: new Date('1900-01-01'), // 기본값 (추후 업데이트 필요)
        sex: 'U',
      },
    });
  }

  // Step 3: 이상치 판정
  let abnormalCount = 0;
  let normalCount = 0;
  const flaggedResults: Array<typeof parsed.results[0] & { flag: string }> = [];

  for (const result of parsed.results) {
    let flag = 'NORMAL';

    if (result.refLow !== undefined && result.refHigh !== undefined) {
      if (result.value < result.refLow) {
        flag = 'LOW';
        // 응급 기준 체크
        const emergencyKey = Object.keys(EMERGENCY_CRITERIA).find(
          (k) => result.analyte.toUpperCase().includes(k)
        );
        if (emergencyKey) {
          const criteria = EMERGENCY_CRITERIA[emergencyKey as keyof typeof EMERGENCY_CRITERIA];
          if ('low' in criteria && result.value < criteria.low!) {
            flag = 'CRITICAL';
          }
        }
      } else if (result.value > result.refHigh) {
        flag = 'HIGH';
        const emergencyKey = Object.keys(EMERGENCY_CRITERIA).find(
          (k) => result.analyte.toUpperCase().includes(k)
        );
        if (emergencyKey) {
          const criteria = EMERGENCY_CRITERIA[emergencyKey as keyof typeof EMERGENCY_CRITERIA];
          if ('high' in criteria && result.value > criteria.high!) {
            flag = 'CRITICAL';
          }
        }
      }
    }

    if (flag === 'NORMAL') normalCount++;
    else abnormalCount++;

    flaggedResults.push({ ...result, flag });
  }

  // LabAnalysis 생성
  const analysis = await prisma.labAnalysis.create({
    data: {
      uploadId,
      patientId: patient?.id,
      patientName: parsed.patientName,
      emrPatientId: parsed.emrPatientId,
      parsedData: flaggedResults,
      abnormalCount,
      normalCount,
      status: 'PARSED',
    },
  });

  // LabResult 레코드 생성
  for (const result of flaggedResults) {
    await prisma.labResult.create({
      data: {
        patientId: patient.id,
        collectedAt: new Date(),
        testName: result.testName,
        analyte: result.analyte,
        value: result.value,
        unit: result.unit || null,
        refLow: result.refLow ?? null,
        refHigh: result.refHigh ?? null,
        flag: result.flag as any,
        flagReason: result.flag !== 'NORMAL' ? `${result.value} vs ${result.refLow}-${result.refHigh}` : null,
        analysisId: analysis.id,
      },
    });
  }

  // Step 4: AI 코멘트 생성 + 자동 분류
  try {
    const aiComment = await generateAiComment(parsed.patientName, flaggedResults);

    // 자동 분류 (우선순위 + 스탬프)
    const { priority, stamp } = classifyPriority(aiComment, flaggedResults);

    await prisma.labAnalysis.update({
      where: { id: analysis.id },
      data: {
        aiComment,
        aiCommentAt: new Date(),
        priority,
        stamp,
        status: 'ANALYZED',
      },
    });
  } catch (err: any) {
    console.error(`[LabAnalysis] AI 코멘트 생성 실패:`, err.message);

    // AI 실패해도 이상치 기반 자동 분류
    const { priority, stamp } = classifyPriority('', flaggedResults);

    await prisma.labAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: 'ANALYZED',
        priority,
        stamp,
      },
    });
  }

  // Step 5: 벡터DB 저장
  try {
    const vectorId = await saveToVectorDB(analysis.id, parsed.patientName, flaggedResults);
    await prisma.labAnalysis.update({
      where: { id: analysis.id },
      data: { vectorId },
    });
  } catch (err: any) {
    console.error(`[LabAnalysis] 벡터 저장 실패:`, err.message);
  }

  // 이상치 있으면 업무함 알림
  if (abnormalCount > 0) {
    const admins = await prisma.user.findMany({
      where: { isSuperAdmin: true, deletedAt: null },
      select: { id: true },
      take: 3,
    });

    for (const admin of admins) {
      await prisma.inboxItem.create({
        data: {
          ownerId: admin.id,
          type: 'LAB_ABNORMAL',
          title: `[검사이상] ${parsed.patientName} - ${abnormalCount}건 이상 수치`,
          summary: flaggedResults
            .filter((r) => r.flag !== 'NORMAL')
            .map((r) => `${r.analyte}: ${r.value} (${r.flag})`)
            .slice(0, 5)
            .join(', '),
          entityType: 'LabAnalysis',
          entityId: analysis.id,
          priority: flaggedResults.some((r) => r.flag === 'CRITICAL') ? 10 : 7,
        },
      });
    }
  }
}

/**
 * AI 코멘트 생성 (Gemini 2.5 Flash)
 */
async function generateAiComment(
  patientName: string,
  results: Array<{ analyte: string; value: number; unit: string; refLow?: number; refHigh?: number; flag: string }>
): Promise<string> {
  const hasEmergency = results.some((r) => r.flag === 'CRITICAL');

  const systemPrompt = `당신은 암요양병원의 검사결과 분석 보조 도구입니다.
환자의 혈액검사 결과를 분석하여 의료진 참고용 코멘트를 작성하세요.

## 엄격한 규칙
- "확진", "진단 확정", "~으로 진단함" 등 확정적 표현 절대 금지
- 특정 약물 처방이나 투약 지시 절대 금지
- "가능성", "참고 정보", "추가 확인 필요" 등으로만 표현
- 응급 기준 해당 시 반드시 "[응급 주의]" 섹션 포함

## 응급 기준
- Hb < 7.0 g/dL
- PLT < 20,000 /μL
- WBC > 30,000 /μL 또는 < 1,000 /μL
- K > 6.0 mEq/L 또는 < 2.5 mEq/L
- Na < 120 mEq/L 또는 > 160 mEq/L
- Cr > 5.0 mg/dL (급성 상승 의심)

## 출력 형식
1. 요약 (1-2문장)
2. 이상 수치 분석 (항목별, 간략히)
3. 임상적 주의사항${hasEmergency ? '\n4. [응급 주의]' : ''}`;

  const userMessage = `환자: ${patientName}

검사 결과:
${results.map((r) =>
  `- ${r.analyte}: ${r.value} ${r.unit || ''} (참고: ${r.refLow ?? '?'}-${r.refHigh ?? '?'}) [${r.flag}]`
).join('\n')}

위 검사결과에 대한 의료진 참고용 코멘트를 작성해 주세요.`;

  const gemini = getGemini();
  const model = gemini.getGenerativeModel({
    model: env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
  });

  return result.response.text() || '코멘트 생성 실패';
}

/**
 * 벡터DB 저장 (Gemini 임베딩 + pgvector)
 */
async function saveToVectorDB(
  analysisId: string,
  patientName: string,
  results: Array<{ analyte: string; value: number; unit: string; flag: string }>
): Promise<string> {
  const content = `환자: ${patientName}\n검사일: ${new Date().toISOString().slice(0, 10)}\n` +
    results.map((r) => `${r.analyte}: ${r.value} ${r.unit || ''} [${r.flag}]`).join('\n');

  // Gemini 임베딩
  const gemini = getGemini();
  const embeddingModel = gemini.getGenerativeModel({ model: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001' });
  const embeddingResult = await embeddingModel.embedContent(content);
  const vector = embeddingResult.embedding.values;

  // pgvector에 저장
  const vectorStr = `[${vector.join(',')}]`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Embedding" (id, "entityType", "entityId", "chunkIndex", content, vector, metadata, "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), 'LabAnalysis', $1, 0, $2, $3::vector, $4::jsonb, now(), now())`,
    analysisId,
    content,
    vectorStr,
    JSON.stringify({ patientName, resultsCount: results.length }),
  );

  return analysisId;
}

/**
 * 날짜별 전체 요약 코멘트 생성
 */
export async function generateDateSummary(uploadDate: Date): Promise<string> {
  const nextDate = new Date(uploadDate);
  nextDate.setDate(nextDate.getDate() + 1);

  const analyses = await prisma.labAnalysis.findMany({
    where: {
      upload: {
        uploadedDate: { gte: uploadDate, lt: nextDate },
        deletedAt: null,
      },
      status: 'ANALYZED',
      deletedAt: null,
    },
    select: {
      patientName: true,
      abnormalCount: true,
      normalCount: true,
      aiComment: true,
    },
  });

  if (analyses.length === 0) return '분석된 검사결과가 없습니다.';

  const totalPatients = analyses.length;
  const abnormalPatients = analyses.filter((a) => a.abnormalCount > 0).length;

  const gemini = getGemini();
  const model = gemini.getGenerativeModel({
    model: env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
  });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `총 ${totalPatients}명 환자 검사결과 중 ${abnormalPatients}명에서 이상 수치 발견.\n\n` +
        analyses.slice(0, 10).map((a) => `- ${a.patientName}: 이상 ${a.abnormalCount}건`).join('\n') }],
    }],
    systemInstruction: '검사결과 전체 요약을 2-3문장으로 작성하세요. 확정 진단 표현은 금지입니다.',
    generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
  });

  return result.response.text() || '요약 생성 실패';
}

/**
 * Gemini Vision으로 이미지에서 검사결과 추출
 */
async function parseImageWithVision(filePath: string, fileType: string): Promise<ParsedResult[]> {
  const gemini = getGemini();
  const model = gemini.getGenerativeModel({ model: env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash' });

  // 이미지 파일 읽기
  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = IMAGE_MIME_TYPES[fileType] || 'image/jpeg';

  const prompt = `이 이미지는 병원 혈액검사 결과지입니다. 다음 JSON 형식으로 검사결과를 추출해주세요.

반드시 아래 JSON 형식만 출력하세요. 다른 설명은 포함하지 마세요.

{
  "patients": [
    {
      "patientName": "환자 이름",
      "emrPatientId": "차트번호 (있으면)",
      "results": [
        {
          "testName": "검사명 (예: CBC, 생화학검사)",
          "analyte": "검사항목 (예: Hb, WBC, PLT)",
          "value": 12.5,
          "unit": "단위 (예: g/dL, /μL)",
          "refLow": 12.0,
          "refHigh": 16.0
        }
      ]
    }
  ]
}

주의사항:
- value, refLow, refHigh는 반드시 숫자로 변환하세요
- 단위가 없으면 빈 문자열로 설정
- 참고치가 없으면 refLow, refHigh는 null
- 여러 환자가 있으면 patients 배열에 모두 포함`;

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  const response = result.response.text();

  // JSON 추출 (마크다운 코드블록 제거)
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return (parsed.patients || []).map((p: any) => ({
      patientName: p.patientName || '미상',
      emrPatientId: p.emrPatientId || undefined,
      results: (p.results || []).map((r: any) => ({
        testName: r.testName || '검사',
        analyte: r.analyte || '항목',
        value: parseFloat(r.value) || 0,
        unit: r.unit || '',
        refLow: r.refLow !== null ? parseFloat(r.refLow) : undefined,
        refHigh: r.refHigh !== null ? parseFloat(r.refHigh) : undefined,
      })),
    }));
  } catch (err) {
    console.error('[Vision] JSON 파싱 실패:', response);
    throw new Error('이미지에서 검사결과를 추출할 수 없습니다. 이미지 품질을 확인해주세요.');
  }
}

/**
 * Gemini Vision으로 PDF에서 검사결과 추출
 */
async function parsePdfWithVision(filePath: string): Promise<ParsedResult[]> {
  const gemini = getGemini();
  const model = gemini.getGenerativeModel({ model: env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash' });

  // PDF 파일 읽기
  const pdfBuffer = fs.readFileSync(filePath);
  const base64Pdf = pdfBuffer.toString('base64');

  const prompt = `이 PDF는 병원 혈액검사 결과지입니다. 다음 JSON 형식으로 검사결과를 추출해주세요.

반드시 아래 JSON 형식만 출력하세요. 다른 설명은 포함하지 마세요.

{
  "patients": [
    {
      "patientName": "환자 이름",
      "emrPatientId": "차트번호 (있으면)",
      "results": [
        {
          "testName": "검사명 (예: CBC, 생화학검사)",
          "analyte": "검사항목 (예: Hb, WBC, PLT)",
          "value": 12.5,
          "unit": "단위 (예: g/dL, /μL)",
          "refLow": 12.0,
          "refHigh": 16.0
        }
      ]
    }
  ]
}

주의사항:
- value, refLow, refHigh는 반드시 숫자로 변환하세요
- 단위가 없으면 빈 문자열로 설정
- 참고치가 없으면 refLow, refHigh는 null
- 여러 환자가 있으면 patients 배열에 모두 포함
- 여러 페이지가 있으면 모든 페이지의 검사결과를 추출`;

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType: 'application/pdf',
        data: base64Pdf,
      },
    },
  ]);

  const response = result.response.text();

  // JSON 추출 (마크다운 코드블록 제거)
  let jsonStr = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return (parsed.patients || []).map((p: any) => ({
      patientName: p.patientName || '미상',
      emrPatientId: p.emrPatientId || undefined,
      results: (p.results || []).map((r: any) => ({
        testName: r.testName || '검사',
        analyte: r.analyte || '항목',
        value: parseFloat(r.value) || 0,
        unit: r.unit || '',
        refLow: r.refLow !== null ? parseFloat(r.refLow) : undefined,
        refHigh: r.refHigh !== null ? parseFloat(r.refHigh) : undefined,
      })),
    }));
  } catch (err) {
    console.error('[Vision] PDF JSON 파싱 실패:', response);
    throw new Error('PDF에서 검사결과를 추출할 수 없습니다. PDF 형식을 확인해주세요.');
  }
}

/**
 * 정상치 대비 % 편차 계산
 * - 상한 초과: (value - refHigh) / refHigh * 100
 * - 하한 미만: (refLow - value) / refLow * 100
 */
function calculateDeviation(value: number, refLow?: number, refHigh?: number): number {
  if (refLow === undefined || refHigh === undefined) return 0;
  if (refLow <= 0 || refHigh <= 0) return 0;

  if (value > refHigh) {
    // 상한 초과
    return ((value - refHigh) / refHigh) * 100;
  } else if (value < refLow) {
    // 하한 미만
    return ((refLow - value) / refLow) * 100;
  }
  return 0; // 정상 범위 내
}

/**
 * 자동 분류: 우선순위 + 스탬프 결정 (% 편차 기반)
 * - ±10% 이내: NORMAL (특이사항없음)
 * - ±10%~30%: CAUTION (촉탁진료대기)
 * - ±30%~50%: RECHECK (재검사 요망)
 * - ±50%~100%: URGENT (촉탁진료요청)
 * - ±100% 초과: EMERGENCY (입원치료요청)
 */
function classifyPriority(
  aiComment: string,
  results: Array<{ flag: string; analyte?: string; value?: number; refLow?: number; refHigh?: number }>
): { priority: 'EMERGENCY' | 'URGENT' | 'RECHECK' | 'CAUTION' | 'NORMAL'; stamp: string } {
  // 모든 결과의 최대 편차 계산
  let maxDeviation = 0;

  for (const r of results) {
    if (r.value !== undefined) {
      const deviation = calculateDeviation(r.value, r.refLow, r.refHigh);
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
      }
    }
  }

  // CRITICAL 플래그가 있으면 응급
  const hasCritical = results.some((r) => r.flag === 'CRITICAL');
  if (hasCritical) {
    return { priority: 'EMERGENCY', stamp: '🔴 입원치료요청' };
  }

  // % 편차 기반 분류
  if (maxDeviation > 100) {
    return { priority: 'EMERGENCY', stamp: '🔴 입원치료요청' };
  }

  if (maxDeviation > 50) {
    return { priority: 'URGENT', stamp: '🟠 촉탁진료요청' };
  }

  if (maxDeviation > 30) {
    return { priority: 'RECHECK', stamp: '🟡 재검사 요망' };
  }

  if (maxDeviation > 10) {
    return { priority: 'CAUTION', stamp: '🟢 촉탁진료대기' };
  }

  return { priority: 'NORMAL', stamp: '⚪ 특이사항없음' };
}
