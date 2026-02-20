import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  ALL_FUNCTION_DECLARATIONS,
  WRITE_FUNCTION_NAMES,
  executeFunction,
} from '../services/chatbot-functions';
import { searchSimilar } from '../services/embedding';
import {
  handleWriteFunction,
  confirmPendingAction,
  rejectPendingAction,
} from '../services/chatbot-write-handler';

const router = Router();

// ═══════════════════════════════════════════════════════════
//  Gemini 클라이언트 초기화
// ═══════════════════════════════════════════════════════════

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    if (!env.GEMINI_API_KEY) {
      throw new AppError(503, 'LLM_NOT_CONFIGURED', 'AI 서비스가 설정되지 않았습니다. (GEMINI_API_KEY 필요)');
    }
    genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return genAI;
}

// ═══════════════════════════════════════════════════════════
//  시스템 프롬프트 (Phase 7 개선)
// ═══════════════════════════════════════════════════════════

function buildSystemPrompt(user: any, ragContext?: string): string {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const today = new Date().toISOString().split('T')[0];

  // 사용자 권한 정보
  const userDepts = user.departments?.map((d: any) => d.departmentId).join(', ') || '없음';
  const userRoles = user.departments?.map((d: any) => d.role).join(', ') || '없음';

  let prompt = `당신은 서울온케어 암요양병원의 AI 업무 어시스턴트입니다.
병원 직원들이 업무 중 궁금한 사항을 자연어로 질문하면 병원 데이터베이스에서 정보를 조회하거나, 예약/처치를 등록·변경·취소할 수 있습니다.

[현재 사용자]
- 이름: ${user.name || user.loginId}
- 부서: ${userDepts}
- 역할: ${userRoles}
- SuperAdmin: ${user.isSuperAdmin ? '예' : '아니오'}

[현재 시간]
${now} (오늘: ${today})

[핵심 규칙 — 반드시 준수]

★ Function 호출 우선 규칙 ★
1. 현황/일정/통계 질문 → 반드시 Function을 호출하여 실시간 DB 데이터를 조회하세요.
2. 아래 [참고 자료]는 배경지식일 뿐이며, 실시간 현황 답변에 절대 사용하지 마세요.
3. "오늘", "내일", "이번주" 등 날짜가 포함된 질문은 반드시 Function을 호출하세요.
4. Function 결과가 비어있으면 "현재 해당 데이터가 없습니다"라고 답변하세요.

[날짜 처리]
- "오늘" = ${today}
- "내일" = 오늘 + 1일
- "다음주 월요일" = 다음 월요일 날짜 계산
- 날짜가 없으면 "오늘"로 가정

[처치 매핑]
- 도수/도수치료/수기치료 → MANUAL_THERAPY
- 고주파/RF/온열/고주파온열치료 → RF_HYPERTHERMIA
- 산소/산소치료/O2 → O2_THERAPY
- 수액/주사/IV → INJECTION
- 레이저/레이저치료 → LASER

[반복 주기 매핑]
- 매일/주5회 → DAILY (평일)
- 주3회/월수금 → THREE_WEEK
- 주2회/화목 → TWICE_WEEK
- 격일 → EVERY_OTHER
- 주1회/매주 → WEEKLY
- 1회/한번 → ONCE

[도수치료 예약 — createManualTherapySlot]
- "김아무개 2/28 14시 도수 예약해줘" → createManualTherapySlot 호출
- 필수: 환자이름(patientName), 날짜(date), 시간(time)
- 선택: 치료사이름(therapistName), 치료코드(treatmentCodes: 온열/림프/페인/도수/SC), 세션마커(sessionMarker: IN/IN20/W1/W2/LTU/신환/재진)
- 치료사 미지정 → 자동배정, 치료코드/세션마커 미입력 → 빈 값으로 처리
- 시간대: 09:00~17:30 (30분 간격)
- 첫 예약 시 환자 자동 등록, 동명이인 시 생년월일로 구분
- 예약 "생성/잡아줘/넣어줘/등록" = createManualTherapySlot (절대 cancel 아님!)

[고주파(RF) 예약 — createRfScheduleSlot]
- "이아무개 3/5 10시 고주파 120분 잡아줘" → createRfScheduleSlot 호출
- 필수: 환자이름(patientName), 날짜(date), 시간(time)
- 선택: 기계번호(roomName), 담당의(doctorCode: C=최원장/J=전원장, 기본C), 소요시간(duration: 60/90/120/150/180, 기본120)
- 기계 미지정 → 자동배정 (빈 기계 중 번호 낮은 순)
- 30분 버퍼: 이전 환자 종료 후 30분 대기 필요
- 첫 예약 시 환자 자동 등록, 동명이인 시 생년월일로 구분
- 예약 "생성/잡아줘/넣어줘/등록" = createRfScheduleSlot (절대 cancel 아님!)

[도수 취소 — cancelManualTherapySlot]
- "김아무개 도수 취소해줘" → cancelManualTherapySlot 호출
- "취소/삭제/빼줘" 키워드가 있을 때만 cancel 함수 사용!

[고주파 취소 — cancelRfScheduleSlot]
- "이아무개 고주파 취소해줘" → cancelRfScheduleSlot 호출
- "취소/삭제/빼줘" 키워드가 있을 때만 cancel 함수 사용!

[도수 변경 — modifyManualTherapySlot]
- "김아무개 도수 14시로 변경해줘" → modifyManualTherapySlot 호출
- "변경/수정/옮겨줘/바꿔줘" 키워드 → modify 함수 사용
- 필수: patientName. 선택: newDate, newTime, newTherapistName, treatmentCodes, reason

[고주파 변경 — modifyRfScheduleSlot]
- "이아무개 고주파 3번기계로 변경해줘" → modifyRfScheduleSlot 호출
- "변경/수정/옮겨줘/바꿔줘" 키워드 → modify 함수 사용
- 필수: patientName. 선택: newDate, newTime, newRoomName, newDuration, newDoctorCode, reason

[인계장 — createHandoverEntry / modifyHandoverEntry / cancelHandoverEntry]
- "김아무개 인계사항 작성: 채혈 완료, 오후 외출 예정" → createHandoverEntry 호출
- "김아무개 오늘 인계 수정: 외출 취소됨" → modifyHandoverEntry 호출
- "김아무개 2/20 인계 삭제해줘" → cancelHandoverEntry 호출
- 필수: patientName. 선택: date(기본 오늘), content, bloodDraw, bloodDrawNote, chemoNote, externalVisit, outing, returnTime, doctorCode, roomNumber
- 인계 "작성/등록/생성" = createHandoverEntry, "수정/변경" = modifyHandoverEntry, "삭제/취소" = cancelHandoverEntry

[임상 프로필 — updateClinicalInfo]
- "김아무개 진단명 췌장암으로 등록해줘" → updateClinicalInfo 호출
- "김아무개 전이 부위: 간, 폐" → updateClinicalInfo 호출
- 필수: patientName. 선택: diagnosis, referralHospital, chemoPort, surgeryHistory, metastasis, ctxHistory, rtHistory, bloodDrawSchedule, guardianInfo, notes
- 여러 필드를 한번에 업데이트 가능

[고주파 치료 평가 — createRfEvaluation]
- "김아무개 고주파 평가: 도자A, 출력100%, 온도39도, 120분" → createRfEvaluation 호출
- 필수: patientName. 선택: probeType(A/B), outputPercent(0-100), temperature, treatmentTime(분), ivTreatment, patientIssue, doctorCode, roomNumber, evaluatedAt(기본 오늘)
- 당일 RF 스케줄 슬롯이 있으면 자동 연결

[입원 예약 — createAdmission]
- "유범석 101호 2/23~2/28 입원 예약해줘" → createAdmission 호출
- "김아무개 내일 입원 잡아줘" → createAdmission 호출
- 필수: 환자이름(patientName), 입원일(admitDate)
- 선택: 병실(roomName: "101호"), 퇴원예정일(plannedDischargeDate), 담당의(doctorName), 메모(notes)
- 병실 미지정 → 베드 미배정으로 생성, 담당의 미지정 → 자동배정
- "입원/예약/잡아줘/등록" = createAdmission
- "2/23~2/28" → admitDate=2/23, plannedDischargeDate=2/28 로 분리

[입원 변경 — modifyAdmission]
- "유범석 입원 3/1로 변경" → modifyAdmission 호출
- "유범석 퇴원일 3/5로 수정" → modifyAdmission 호출
- "유범석 102호로 전실" → modifyAdmission 호출
- 필수: patientName. 선택: newAdmitDate, newDischargeDate, newRoomName, newDoctorName, notes, reason
- "변경/수정/전실/옮겨줘" 키워드 → modifyAdmission

[입원 취소/퇴원 — cancelAdmission]
- "유범석 입원 취소" → cancelAdmission 호출
- "유범석 퇴원 처리해줘" → cancelAdmission 호출
- 필수: patientName. 선택: reason
- "입원 취소/퇴원 처리/퇴원해줘" 키워드 → cancelAdmission

[회진 준비 — getRoundPrep]
- "이찬용 원장 회진 준비 데이터 보여줘" → getRoundPrep 호출
- "오늘 회진 준비" → getRoundPrep 호출
- 선택: date(기본 오늘), doctorCode

[취소/변경 시 예약 유형이 불명확한 경우 — findPatientBookings]
- "유범석 취소해줘", "유범석 예약 취소", "2월20일 유범석 취소" 등 예약 유형(도수/고주파/외래/입원)이 명시되지 않은 경우:
  → 반드시 findPatientBookings(patientName, date?)를 먼저 호출하여 해당 환자의 예약을 조회
  → 결과가 1건이면: "유범석 환자의 도수치료 09:30 예약을 취소할까요?" 라고 물어보세요.
  → 결과가 여러건이면: 목록을 보여주고 "어떤 예약을 취소하시겠어요?" 질문
  → 결과가 0건이면: "해당 날짜에 유범석 환자의 예약이 없습니다" 안내
- 예약 유형이 명확한 경우(예: "도수 취소", "고주파 취소") → 바로 해당 cancel 함수 호출

[예약 흐름]
① 필수 정보(환자이름, 날짜, 시간) 확인. 부족하면 부족한 것만 물어보세요.
② 필수 정보가 갖줘지면 즉시 해당 create/modify/cancel Function을 호출하세요!
③ 사용자가 선택사항(치료코드, 세션마커 등)을 함께 말했으면 포함하여 호출하세요.
④ 선택사항을 안 말했으면 빈 값으로 호출하세요. 선택사항을 물어보지 마세요.
⑤ "예약해줘/잡아줘" = create, "변경해줘/수정해줘/바꿔줘" = modify, "취소해줘/빼줘" = cancel

[동명이인 처리 — 시스템이 "동명이인인가요?" 질문을 반환한 후]
- 사용자가 "같은 사람", "네 맞아요", "동일인", "맞아", "선택" → **이전 대화에서 환자이름·날짜·시간을 추출하여** useExistingPatient=true를 포함한 동일 Function을 다시 호출하세요!
- 사용자가 "동명이인", "다른 사람" + 생년월일 → dob="YYYY-MM-DD"로 다시 Function 호출
- 사용자가 생년월일만 말함 (예: "1990년 3월 15일", "90년생") → dob="1990-03-15"로 다시 Function 호출
- 생년월일 형식 변환: "90년 3월 15일" → "1990-03-15", "65년생" → "1965-01-01"
★ 중요: 동명이인 확인 후 반드시 이전 메시지에서 patientName, date, time 등 원래 파라미터를 모두 포함하여 다시 호출하세요. 빈 응답을 생성하지 마세요!

[필수 정보 반문 규칙]
- Function 호출에 필요한 필수 파라미터가 부족하면, 빈 응답 대신 **부족한 정보를 반문**하세요.
- 예: 날짜 없음 → "몇 월 며칠에 예약하시겠어요?"
- 예: 시간 없음 → "몇 시에 예약하시겠어요? (09:00~17:30)"
- 예: 환자이름 없음 → "환자 성함을 알려주세요."
- 예: 예약 유형 불명 → "도수치료, 고주파, 외래 중 어떤 예약인가요?"
- 절대 빈 응답(텍스트 없음)을 반환하지 마세요!

[WRITE 작업 규칙]
- 예약/처치 생성·변경·취소 요청 시 즉시 해당 WRITE Function을 호출하세요.
- WRITE 결과는 확인 카드로 반환됩니다. 직접 DB를 수정하지 않습니다.
- "예약해줘/잡아줘/등록해줘" → create 함수, "취소해줘/빼줘/삭제해줘" → cancel 함수

[일반 규칙]
1. 항상 한국어로 자연스럽게 답변하세요.
2. 표, 구분선 대신 자연스러운 문장으로 설명하세요.
3. 환자 개인정보는 이름과 EMR ID만 표시하세요.
4. 병원 업무와 관련 없는 질문에는 "병원 업무 관련 질문에만 답변드릴 수 있습니다"라고 답변하세요.`;

  if (ragContext) {
    prompt += `\n\n[참고 자료 — 배경지식 전용, 실시간 현황 답변에 사용 금지]
${ragContext}`;
  }

  return prompt;
}

// ═══════════════════════════════════════════════════════════
//  Gemini 히스토리 변환
// ═══════════════════════════════════════════════════════════

function toGeminiHistory(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.content }],
    }));
}

// ═══════════════════════════════════════════════════════════
//  Zod 스키마
// ═══════════════════════════════════════════════════════════

const askSchema = z.object({
  message: z.string().min(1).max(1000),
  sessionId: z.string().optional(),
});

const confirmSchema = z.object({
  pendingId: z.string().min(1),
});

// ═══════════════════════════════════════════════════════════
//  POST /api/chatbot/ask — 챗봇 질문
// ═══════════════════════════════════════════════════════════

router.post(
  '/ask',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { message, sessionId } = askSchema.parse(req.body);
    const user = req.user!;
    const userId = user.id;

    const ai = getGenAI();

    // 세션 관리
    let session = sessionId
      ? await prisma.chatSession.findUnique({ where: { id: sessionId } })
      : null;

    if (!session) {
      session = await prisma.chatSession.create({
        data: { userId, title: message.slice(0, 50) },
      });
    }

    // 사용자 메시지 저장
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: 'user', content: message },
    });

    // RAG: Gemini 임베딩으로 유사 문서 검색
    let ragContext = '';
    if (env.GEMINI_API_KEY) {
      try {
        const similar = await searchSimilar(message, { limit: 3, threshold: 0.65 });
        if (similar.length > 0) {
          ragContext = similar
            .map((s, i) => `[${i + 1}] (유사도: ${(s.similarity * 100).toFixed(0)}%) ${s.content}`)
            .join('\n\n');
        }
      } catch (err) {
        console.warn('[Chatbot] RAG 검색 실패:', (err as Error).message);
      }
    }

    // 이전 대화 히스토리 로드 (최근 10개, 현재 메시지 제외)
    const dbMessages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    // 히스토리에서 마지막 user 메시지는 제외 (sendMessage에서 직접 보냄)
    const historyMessages = dbMessages.slice(0, -1);

    // Gemini 모델 초기화
    const model = ai.getGenerativeModel({
      model: env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
      tools: [{ functionDeclarations: ALL_FUNCTION_DECLARATIONS as any }],
      systemInstruction: buildSystemPrompt(user, ragContext),
    });

    const chat = model.startChat({
      history: toGeminiHistory(historyMessages),
    });

    // 1차 호출: 의도 파악 + Function Calling
    const result = await chat.sendMessage(message);
    const response = result.response;
    const functionCalls = response.functionCalls();

    // 응답 데이터 기본값
    let responseData: Record<string, any> = {
      message: '',
      sessionId: session.id,
      type: 'message',
    };

    if (functionCalls && functionCalls.length > 0) {
      const fc = functionCalls[0];

      if (WRITE_FUNCTION_NAMES.has(fc.name)) {
        // ── WRITE Function → PendingAction 플로우 ──
        try {
          const writeResult = await handleWriteFunction(fc.name, fc.args as Record<string, any>, user, session.id);

          responseData.type = writeResult.type;
          responseData.message = writeResult.message;

          if (writeResult.type === 'confirm') {
            responseData.pendingId = writeResult.pendingId;
            responseData.displayData = writeResult.displayData;
          } else if (writeResult.type === 'conflict') {
            responseData.alternatives = writeResult.alternatives;
            responseData.displayData = writeResult.displayData;
          } else if (writeResult.type === 'disambiguation') {
            responseData.patients = writeResult.patients;
          }
        } catch (err) {
          const errMsg = (err as Error).message || '알 수 없는 오류';
          console.error('[Chatbot] WRITE 함수 실행 오류:', errMsg);
          responseData.type = 'error';
          responseData.message = `예약 처리 중 오류가 발생했습니다: ${errMsg}. 다시 시도해 주세요.`;
        }
      } else {
        // ── READ Function → DB 조회 후 Gemini에 결과 반환 ──
        const funcResult = await executeFunction(fc.name, fc.args as Record<string, any>, userId);

        const result2 = await chat.sendMessage([
          {
            functionResponse: {
              name: fc.name,
              response: funcResult,
            },
          },
        ]);

        const readReply = result2.response.text();
        if (readReply) {
          responseData.message = readReply;
        } else {
          // Gemini가 빈 응답 → 안내 메시지
          responseData.message = '조회 결과를 정리하는 중 문제가 발생했습니다. 질문을 좀 더 구체적으로 다시 말씀해 주세요. (예: "유범석 2/24 10시 도수 예약해줘")';
        }
      }
    } else {
      // Function 호출 없이 직접 답변
      const directReply = response.text();
      if (directReply) {
        responseData.message = directReply;
      } else {
        // Gemini가 빈 응답 → 필수 정보 반문
        responseData.message = '죄송합니다. 요청을 이해하지 못했습니다. 필요한 정보를 포함해서 다시 말씀해 주세요.\n\n예시:\n• 예약: "유범석 2/24 10시 도수 예약해줘"\n• 조회: "오늘 예약 현황 알려줘"\n• 변경: "유범석 도수 14시로 변경해줘"';
      }
    }

    // 어시스턴트 메시지 저장
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: responseData.message,
      },
    });

    res.json({ success: true, data: responseData });
  }),
);

// ═══════════════════════════════════════════════════════════
//  POST /api/chatbot/confirm — PendingAction 확인
// ═══════════════════════════════════════════════════════════

router.post(
  '/confirm',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { pendingId } = confirmSchema.parse(req.body);
    const userId = req.user!.id;

    const result = await confirmPendingAction(pendingId, userId);

    if (!result.success) {
      throw new AppError(400, 'CONFIRM_FAILED', result.message);
    }

    res.json({ success: true, data: result });
  }),
);

// ═══════════════════════════════════════════════════════════
//  POST /api/chatbot/reject — PendingAction 거절
// ═══════════════════════════════════════════════════════════

router.post(
  '/reject',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { pendingId } = confirmSchema.parse(req.body);
    const userId = req.user!.id;

    const result = await rejectPendingAction(pendingId, userId);

    if (!result.success) {
      throw new AppError(400, 'REJECT_FAILED', result.message);
    }

    res.json({ success: true, data: result });
  }),
);

// ═══════════════════════════════════════════════════════════
//  GET /api/chatbot/sessions — 대화 세션 목록
// ═══════════════════════════════════════════════════════════

router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        _count: { select: { messages: true } },
      },
    });

    res.json({ success: true, data: sessions });
  }),
);

// ═══════════════════════════════════════════════════════════
//  GET /api/chatbot/sessions/:id/messages — 세션 메시지 조회
// ═══════════════════════════════════════════════════════════

router.get(
  '/sessions/:id/messages',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = await prisma.chatSession.findUnique({
      where: { id: req.params.id },
    });

    if (!session || session.userId !== req.user!.id) {
      throw new AppError(404, 'NOT_FOUND', '세션을 찾을 수 없습니다.');
    }

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ success: true, data: messages });
  }),
);

export default router;
