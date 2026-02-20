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
- 환자가 DB에 없어도 이름만으로 예약 가능
- 예약 "생성/잡아줘/넣어줘/등록" = createManualTherapySlot (절대 cancel 아님!)

[고주파(RF) 예약 — createRfScheduleSlot]
- "이아무개 3/5 10시 고주파 120분 잡아줘" → createRfScheduleSlot 호출
- 필수: 환자이름(patientName), 날짜(date), 시간(time)
- 선택: 기계번호(roomName), 담당의(doctorCode: C=최원장/J=전원장, 기본C), 소요시간(duration: 60/90/120/150/180, 기본120)
- 기계 미지정 → 자동배정 (빈 기계 중 번호 낮은 순)
- 30분 버퍼: 이전 환자 종료 후 30분 대기 필요
- 환자가 DB에 없어도 이름만으로 예약 가능
- 예약 "생성/잡아줘/넣어줘/등록" = createRfScheduleSlot (절대 cancel 아님!)

[도수 취소 — cancelManualTherapySlot]
- "김아무개 도수 취소해줘" → cancelManualTherapySlot 호출
- "취소/삭제/빼줘" 키워드가 있을 때만 cancel 함수 사용!

[고주파 취소 — cancelRfScheduleSlot]
- "이아무개 고주파 취소해줘" → cancelRfScheduleSlot 호출
- "취소/삭제/빼줘" 키워드가 있을 때만 cancel 함수 사용!

[예약 흐름]
① 필수 정보(환자이름, 날짜, 시간) 확인. 부족하면 부족한 것만 물어보세요.
② 필수 정보가 갖춰지면 즉시 해당 create/cancel Function을 호출하세요!
③ 사용자가 선택사항(치료코드, 세션마커 등)을 함께 말했으면 포함하여 호출하세요.
④ 선택사항을 안 말했으면 빈 값으로 호출하세요. 선택사항을 물어보지 마세요.

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

        responseData.message = result2.response.text() || '응답을 생성할 수 없습니다.';
      }
    } else {
      // Function 호출 없이 직접 답변
      responseData.message = response.text() || '응답을 생성할 수 없습니다.';
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
