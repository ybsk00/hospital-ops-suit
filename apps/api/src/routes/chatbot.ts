import { Router, Request, Response } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  chatFunctionDefinitions,
  executeFunction,
} from '../services/chatbot-functions';
import { searchSimilar } from '../services/embedding';

const router = Router();

const openai = new OpenAI({ apiKey: env.LLM_API_KEY });

function buildSystemPrompt(ragContext?: string): string {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  let prompt = `당신은 서울온케어 암요양병원의 AI 업무 어시스턴트입니다.
병원 직원들이 업무 중 궁금한 사항을 자연어로 질문하면 병원 데이터베이스에서 정보를 조회하여 한국어로 답변합니다.

규칙:
1. 항상 한국어로 자연스럽게 답변하세요.
2. 데이터 조회 결과를 친절하고 간결한 문장으로 요약하세요.
3. 표, 구분선(---|), 기호(|, -, *) 사용을 최소화하고 자연스러운 문장으로 설명하세요.
4. 목록이 필요하면 "첫째, 둘째" 또는 "1병동에는 101호A, 101호B가 있고" 처럼 문장으로 나열하세요.
5. 환자 개인정보는 이름과 EMR ID만 표시하고, 주민번호 등은 절대 노출하지 마세요.
6. 조회할 데이터가 없으면 "현재 해당 데이터가 없습니다"라고 답변하세요.
7. 병원 업무와 관련 없는 질문에는 "병원 업무 관련 질문에만 답변드릴 수 있습니다"라고 답변하세요.
8. 현재 시간: ${now}`;

  if (ragContext) {
    prompt += `\n\n[참고 자료]\n아래는 질문과 관련된 병원 내부 문서입니다. 답변 시 참고하세요:\n${ragContext}`;
  }

  return prompt;
}

const askSchema = z.object({
  message: z.string().min(1).max(1000),
  sessionId: z.string().optional(),
});

// ─── POST /api/chatbot/ask ── 챗봇 질문 ───
router.post(
  '/ask',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { message, sessionId } = askSchema.parse(req.body);
    const userId = req.user!.id;

    // LLM API 키 확인
    if (!env.LLM_API_KEY) {
      throw new AppError(503, 'LLM_NOT_CONFIGURED', 'AI 서비스가 설정되지 않았습니다.');
    }

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
      data: {
        sessionId: session.id,
        role: 'user',
        content: message,
      },
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
        console.warn('[Chatbot] RAG 검색 실패, Function Calling만 사용합니다:', (err as Error).message);
      }
    }

    // 이전 대화 히스토리 로드 (최근 10개)
    const history = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(ragContext) },
      ...history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // 1차 호출: 의도 파악 + Function Calling
    const firstResponse = await openai.chat.completions.create({
      model: env.LLM_MODEL,
      messages,
      functions: chatFunctionDefinitions,
      function_call: 'auto',
      temperature: 0.3,
      max_tokens: 1000,
    });

    const firstChoice = firstResponse.choices[0];
    let assistantMessage: string;

    if (firstChoice.message.function_call) {
      // Function 호출이 필요한 경우
      const funcName = firstChoice.message.function_call.name;
      let funcArgs: Record<string, any> = {};

      try {
        funcArgs = JSON.parse(firstChoice.message.function_call.arguments || '{}');
      } catch {
        funcArgs = {};
      }

      // DB 조회 실행
      const funcResult = await executeFunction(funcName, funcArgs, userId);

      // 2차 호출: 조회 결과를 자연어로 변환
      messages.push(firstChoice.message as any);
      messages.push({
        role: 'function',
        name: funcName,
        content: JSON.stringify(funcResult, null, 2),
      } as any);

      const secondResponse = await openai.chat.completions.create({
        model: env.LLM_MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 1500,
      });

      assistantMessage = secondResponse.choices[0].message.content || '응답을 생성할 수 없습니다.';
    } else {
      // Function 호출 없이 직접 답변
      assistantMessage = firstChoice.message.content || '응답을 생성할 수 없습니다.';
    }

    // 어시스턴트 메시지 저장
    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: assistantMessage,
      },
    });

    res.json({
      success: true,
      data: {
        message: assistantMessage,
        sessionId: session.id,
      },
    });
  }),
);

// ─── GET /api/chatbot/sessions ── 대화 세션 목록 ───
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

// ─── GET /api/chatbot/sessions/:id/messages ── 세션 메시지 조회 ───
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
