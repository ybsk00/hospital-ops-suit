/**
 * 환자용 챗봇 API
 * 인증 없이 공개 접근, 스트리밍 응답
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { MarketingRetriever } from '../services/marketingRag';
import { MarketingGenerator } from '../services/marketingGenerator';
import { MarketingSafetyGuard } from '../services/marketingSafety';
import { env } from '../config/env';
import crypto from 'crypto';

const router = Router();

// 환자 챗봇 전용 CORS 미들웨어 (공개 API이므로 모든 origin 허용)
const patientChatbotCors = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Session-Id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'X-Session-Id');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

// 모든 라우트에 CORS 미들웨어 적용
router.use(patientChatbotCors);

// 싱글톤 인스턴스
let retriever: MarketingRetriever | null = null;
let generator: MarketingGenerator | null = null;

function getRetriever(): MarketingRetriever {
  if (!retriever) {
    retriever = new MarketingRetriever();
  }
  return retriever;
}

function getGenerator(): MarketingGenerator {
  if (!generator) {
    generator = new MarketingGenerator();
  }
  return generator;
}

// IP 해시 생성
function hashIP(ip: string): string {
  return crypto.createHash('sha256').update(ip + 'oncare-salt').digest('hex').slice(0, 16);
}

// 요청 스키마 (content는 nullable 허용 후 필터링)
const chatSchema = z.object({
  query: z.string().min(1).max(1000),
  category: z.enum(['auto', 'cancer', 'nerve', 'general']).default('auto'),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    content: z.string().nullable().optional(),
  })).default([]).transform(arr => arr.filter(item => item.content && item.content.trim())),
  sessionId: z.string().nullable().optional(),
});

// ─── POST /api/patient-chatbot/chat ── 챗봇 대화 (스트리밍) ───
router.post(
  '/chat',
  asyncHandler(async (req: Request, res: Response) => {
    // Gemini API 키 확인
    if (!env.GEMINI_API_KEY) {
      throw new AppError(503, 'LLM_NOT_CONFIGURED', 'AI 서비스가 설정되지 않았습니다.');
    }

    const body = chatSchema.parse(req.body);
    const { query, category: requestedCategory, history: rawHistory } = body;
    let { sessionId } = body;

    // IP 해시
    const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
    const ipHash = hashIP(clientIP);

    // 대화 이력 검증
    const history = MarketingSafetyGuard.validateHistory(rawHistory);

    console.log(`[PatientChatbot] query="${query.slice(0, 50)}...", category=${requestedCategory}, historyLen=${history.length}`);

    // 세션 관리
    if (!sessionId) {
      const session = await prisma.patientChatSession.create({
        data: { ipHash },
      });
      sessionId = session.id;
    }

    // 사용자 메시지 저장
    await prisma.patientChatMessage.create({
      data: {
        sessionId,
        role: 'user',
        content: query,
      },
    });

    // 스트리밍 응답 설정
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sessionId);

    const startTime = Date.now();
    let fullResponse = '';
    let finalCategory = requestedCategory;
    let hadSources = false;
    let isBooking = false;
    let isFallback = false;

    try {
      const gen = getGenerator();
      const ret = getRetriever();

      // 1. 카테고리 분류 + 검색 병렬 실행
      const [classifiedCategory, contextDocs] = await Promise.all([
        requestedCategory === 'auto' ? gen.classifyQuery(query) : Promise.resolve(requestedCategory as 'cancer' | 'nerve' | 'general'),
        ret.retrieve(query),
      ]);

      finalCategory = classifiedCategory;
      console.log(`[PatientChatbot] classified=${finalCategory}, docs=${contextDocs.length}`);

      // 2. 안전 체크: 진단/처방 요청
      if (MarketingSafetyGuard.checkMedicalQuery(query)) {
        const warning = MarketingSafetyGuard.getDiagnosisWarning();
        res.write(warning);
        fullResponse = warning;
      }
      // 3. 일반 질문
      else if (finalCategory === 'general') {
        for await (const chunk of gen.generateGeneralResponse(query, history)) {
          res.write(chunk);
          fullResponse += chunk;
        }
      }
      // 4. 의료 질문 (RAG 결과 있음)
      else if (MarketingSafetyGuard.checkRelevance(contextDocs)) {
        for await (const chunk of gen.generateMedicalResponse(query, contextDocs, finalCategory, history)) {
          res.write(chunk);
          fullResponse += chunk;
        }

        // 소스 전송 (RAG 결과 + 유튜브 보충 검색)
        let sources = gen.extractYouTubeSources(contextDocs);

        // 유튜브 영상이 부족하면 별도 검색으로 보충
        if (sources.length < 5) {
          const keywords = ret.extractKeywords(query);
          const youtubeResults = await ret.searchYouTubeVideos(keywords, finalCategory, 10, query);
          const existingUrls = new Set(sources.map(s => s.source));

          for (const ytDoc of youtubeResults) {
            if (sources.length >= 8) break;
            if (ytDoc.sourceUrl && !existingUrls.has(ytDoc.sourceUrl)) {
              const match = ytDoc.sourceUrl.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*)/);
              const videoId = match?.[1];
              sources.push({
                source: ytDoc.sourceUrl,
                title: ytDoc.title || '관련 추천 영상',
                thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : undefined,
              });
              existingUrls.add(ytDoc.sourceUrl);
            }
          }
        }

        if (sources.length > 0) {
          hadSources = true;
          res.write(`\n\n__SOURCES__\n${JSON.stringify(sources)}`);
        }
      }
      // 5. 의료 질문 (RAG 결과 없음 → 폴백)
      else {
        isFallback = true;
        for await (const chunk of gen.generateFallback(query, history)) {
          res.write(chunk);
          fullResponse += chunk;
        }

        // 폴백에서도 유튜브 영상 검색 시도
        const keywords = ret.extractKeywords(query);
        if (keywords.length > 0 || query.length >= 2) {
          const youtubeResults = await ret.searchYouTubeVideos(keywords, finalCategory, 8, query);
          const sources: Array<{ source: string; title: string; thumbnail?: string }> = [];

          for (const ytDoc of youtubeResults) {
            if (sources.length >= 8) break;
            if (ytDoc.sourceUrl) {
              const match = ytDoc.sourceUrl.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*)/);
              const videoId = match?.[1];
              sources.push({
                source: ytDoc.sourceUrl,
                title: ytDoc.title || '관련 추천 영상',
                thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : undefined,
              });
            }
          }

          if (sources.length > 0) {
            hadSources = true;
            res.write(`\n\n__SOURCES__\n${JSON.stringify(sources)}`);
          }
        }
      }

      // 6. 내원 의사 감지
      const visitIntent = gen.detectVisitIntent(query, history);
      if (visitIntent === 'strong') {
        isBooking = true;
        res.write('\n\n__BOOKING__');
        console.log(`[PatientChatbot] Booking intent detected`);
      }

      // 어시스턴트 메시지 저장
      await prisma.patientChatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: fullResponse,
          category: finalCategory === 'general' ? undefined : (finalCategory.toUpperCase() as 'CANCER' | 'NERVE'),
          metadata: { hadSources, isBooking, isFallback },
        },
      });

      // 분석 로그 저장
      const responseTime = Date.now() - startTime;
      await prisma.chatbotAnalytics.create({
        data: {
          sessionId,
          query,
          category: finalCategory,
          responseTime,
          hadSources,
          isBooking,
          isFallback,
        },
      });

      console.log(`[PatientChatbot] completed in ${responseTime}ms, fallback=${isFallback}, booking=${isBooking}`);
    } catch (err) {
      console.error('[PatientChatbot] Error:', err);
      res.write('죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }

    res.end();
  }),
);

// ─── GET /api/patient-chatbot/sessions/:id/messages ── 세션 메시지 조회 ───
router.get(
  '/sessions/:id/messages',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const session = await prisma.patientChatSession.findUnique({
      where: { id },
    });

    if (!session) {
      throw new AppError(404, 'NOT_FOUND', '세션을 찾을 수 없습니다.');
    }

    const messages = await prisma.patientChatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        category: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: messages });
  }),
);

// ─── GET /api/patient-chatbot/health ── 헬스 체크 ───
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

export default router;
