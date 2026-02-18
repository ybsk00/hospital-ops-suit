import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';

let genAI: GoogleGenerativeAI | null = null;
function getGemini(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY || '');
  }
  return genAI;
}

/**
 * AI 소견서 자동 생성 (Gemini 2.5 Flash)
 * - 환자정보, 문진결과, 검사결과를 종합하여 소견서 초안 작성
 * - 완료 시 status를 AI_REVIEWED로 변경
 */
export async function generateAiReport(reportId: string): Promise<void> {
  const report = await prisma.aiReport.findFirst({
    where: { id: reportId, deletedAt: null },
    include: {
      patient: true,
      visit: {
        include: {
          questionnaires: {
            where: { deletedAt: null },
            orderBy: { submittedAt: 'desc' },
            take: 5,
          },
        },
      },
    },
  });

  if (!report) throw new Error('소견서를 찾을 수 없습니다.');

  // 환자의 최근 검사결과 조회
  const labResults = await prisma.labResult.findMany({
    where: { patientId: report.patientId, deletedAt: null },
    orderBy: { collectedAt: 'desc' },
    take: 20,
  });

  // AI 프롬프트 구성
  const patientInfo = `
환자 정보:
- 이름: ${report.patient.name}
- 생년월일: ${report.patient.dob ? new Date(report.patient.dob).toLocaleDateString('ko-KR') : '미상'}
- 성별: ${report.patient.sex === 'M' ? '남성' : report.patient.sex === 'F' ? '여성' : '미상'}
- EMR ID: ${report.patient.emrPatientId}
`.trim();

  const questionnaireInfo = report.visit?.questionnaires?.length
    ? `\n문진 결과:\n${report.visit.questionnaires
        .map((q, i) => {
          const payload = q.payloadJson as Record<string, any>;
          return `[문진 ${i + 1}] 위험도: ${q.riskLevel}, 사유: ${q.riskReason || '없음'}\n내용: ${JSON.stringify(payload, null, 2)}`;
        })
        .join('\n')}`
    : '\n문진 결과: 없음';

  const labInfo = labResults.length
    ? `\n혈액검사/소변검사 결과:\n${labResults
        .map((l) => {
          const flag = l.flag !== 'NORMAL' ? ` [${l.flag}]` : '';
          return `- ${l.testName} (${l.analyte}): ${l.value} ${l.unit || ''}${flag} (참고: ${l.refLow ?? '?'}-${l.refHigh ?? '?'})`;
        })
        .join('\n')}`
    : '\n검사 결과: 없음';

  const visitInfo = report.visit
    ? `\n방문 정보:\n- 방문일: ${new Date(report.visit.scheduledAt).toLocaleDateString('ko-KR')}\n- 상태: ${report.visit.status}`
    : '';

  const systemPrompt = `당신은 암요양병원의 전문 의료 소견서 작성 AI 어시스턴트입니다.
아래 환자 정보, 문진 결과, 검사 결과를 종합하여 의료 소견서 초안을 작성하세요.

소견서 형식:
1. 환자 기본 정보 요약
2. 주요 소견 (문진 결과 기반)
3. 검사 결과 분석 (이상 수치 중심)
4. 종합 의견
5. 권장 사항

- 의학적으로 정확하고 전문적인 한국어로 작성
- 객관적 사실 중심
- 이상 수치가 있으면 반드시 언급
- 환자 상태 변화 추이 분석 (가능한 경우)`;

  const userMessage = `${patientInfo}${visitInfo}${questionnaireInfo}${labInfo}\n\n위 정보를 바탕으로 의료 소견서 초안을 작성해 주세요.`;

  const gemini = getGemini();
  const model = gemini.getGenerativeModel({
    model: env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: systemPrompt,
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
  });

  const draftText = result.response.text() || '소견서 생성에 실패했습니다.';

  await prisma.aiReport.update({
    where: { id: reportId },
    data: {
      draftText,
      status: 'AI_REVIEWED',
      version: { increment: 1 },
    },
  });
}
