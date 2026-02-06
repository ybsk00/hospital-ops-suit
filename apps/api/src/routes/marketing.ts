/**
 * 마케팅 관리 API
 * 콘텐츠 CRUD, 통계, 데이터 마이그레이션
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { embed } from '../services/embedding';

const router = Router();

// ─── GET /api/marketing/faqs ── FAQ 목록 ───
router.get(
  '/faqs',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { category, search, page = '1', limit = '20' } = req.query;

    const where: any = { deletedAt: null };
    if (category && category !== 'all') {
      where.category = category;
    }
    if (search) {
      where.OR = [
        { question: { contains: search as string, mode: 'insensitive' } },
        { answer: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [faqs, total] = await Promise.all([
      prisma.hospitalFaq.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
        take: parseInt(limit as string),
        select: {
          id: true,
          question: true,
          answer: true,
          category: true,
          sourceUrl: true,
          title: true,
          isActive: true,
          createdAt: true,
        },
      }),
      prisma.hospitalFaq.count({ where }),
    ]);

    res.json({
      success: true,
      data: { faqs, total, page: parseInt(page as string), limit: parseInt(limit as string) },
    });
  }),
);

// ─── POST /api/marketing/faqs ── FAQ 생성 ───
const createFaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  category: z.enum(['CANCER', 'NERVE', 'GENERAL']).optional(),
  sourceUrl: z.string().optional(),
  title: z.string().optional(),
});

router.post(
  '/faqs',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = createFaqSchema.parse(req.body);

    // Q 임베딩 생성
    const vector = await embed(body.question);
    const vectorStr = `[${vector.join(',')}]`;

    const faq = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "HospitalFaq" (id, question, answer, category, "sourceUrl", title, vector, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3::"MarketingCategory", $4, $5, $6::vector, NOW(), NOW())
       RETURNING id`,
      body.question,
      body.answer,
      body.category || null,
      body.sourceUrl || null,
      body.title || null,
      vectorStr
    );

    res.json({ success: true, data: { id: faq[0].id } });
  }),
);

// ─── PUT /api/marketing/faqs/:id ── FAQ 수정 ───
router.put(
  '/faqs/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = createFaqSchema.partial().parse(req.body);

    const existing = await prisma.hospitalFaq.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new AppError(404, 'NOT_FOUND', 'FAQ를 찾을 수 없습니다.');
    }

    // Q가 변경되면 임베딩 재생성
    let vectorUpdate = '';
    if (body.question && body.question !== existing.question) {
      const vector = await embed(body.question);
      vectorUpdate = `, vector = '[${vector.join(',')}]'::vector`;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "HospitalFaq" SET
         question = COALESCE($2, question),
         answer = COALESCE($3, answer),
         category = COALESCE($4::"MarketingCategory", category),
         "sourceUrl" = COALESCE($5, "sourceUrl"),
         title = COALESCE($6, title),
         "updatedAt" = NOW()
         ${vectorUpdate}
       WHERE id = $1`,
      id,
      body.question || null,
      body.answer || null,
      body.category || null,
      body.sourceUrl || null,
      body.title || null
    );

    res.json({ success: true });
  }),
);

// ─── DELETE /api/marketing/faqs/:id ── FAQ 삭제 ───
router.delete(
  '/faqs/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    await prisma.hospitalFaq.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    res.json({ success: true });
  }),
);

// ─── GET /api/marketing/documents ── 문서 목록 ───
router.get(
  '/documents',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { type, category, page = '1', limit = '20' } = req.query;

    const where: any = { deletedAt: null };
    if (type && type !== 'all') {
      where.type = type;
    }
    if (category && category !== 'all') {
      where.category = category;
    }

    const [documents, total] = await Promise.all([
      prisma.marketingDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
        take: parseInt(limit as string),
        select: {
          id: true,
          content: true,
          type: true,
          category: true,
          sourceUrl: true,
          title: true,
          isActive: true,
          createdAt: true,
        },
      }),
      prisma.marketingDocument.count({ where }),
    ]);

    res.json({
      success: true,
      data: { documents, total, page: parseInt(page as string), limit: parseInt(limit as string) },
    });
  }),
);

// ─── GET /api/marketing/analytics ── 챗봇 통계 ───
router.get(
  '/analytics',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = req.query;

    const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to as string) : new Date();

    // 기본 통계
    const [totalChats, bookingIntents, avgResponseTime, categoryStats] = await Promise.all([
      prisma.chatbotAnalytics.count({
        where: { createdAt: { gte: fromDate, lte: toDate } },
      }),
      prisma.chatbotAnalytics.count({
        where: { createdAt: { gte: fromDate, lte: toDate }, isBooking: true },
      }),
      prisma.chatbotAnalytics.aggregate({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _avg: { responseTime: true },
      }),
      prisma.chatbotAnalytics.groupBy({
        by: ['category'],
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _count: true,
      }),
    ]);

    // 일별 추이
    const dailyStats = await prisma.$queryRaw<Array<{ date: string; count: number }>>`
      SELECT DATE("createdAt") as date, COUNT(*)::int as count
      FROM "ChatbotAnalytics"
      WHERE "createdAt" >= ${fromDate} AND "createdAt" <= ${toDate}
      GROUP BY DATE("createdAt")
      ORDER BY date
    `;

    res.json({
      success: true,
      data: {
        totalChats,
        bookingIntents,
        bookingRate: totalChats > 0 ? Math.round((bookingIntents / totalChats) * 100) : 0,
        avgResponseTime: Math.round(avgResponseTime._avg.responseTime || 0),
        categoryStats,
        dailyStats,
      },
    });
  }),
);

// ─── POST /api/marketing/migrate ── 데이터 마이그레이션 ───
const migrateSchema = z.object({
  data: z.array(z.object({
    content: z.string(),
    metadata: z.record(z.unknown()).optional(),
  })),
  type: z.enum(['faq', 'document']),
});

router.post(
  '/migrate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { data, type } = migrateSchema.parse(req.body);

    console.log(`[Marketing] Migrating ${data.length} ${type}s...`);

    let successCount = 0;
    let errorCount = 0;

    for (const item of data) {
      try {
        const metadata = item.metadata || {};
        const category = (metadata.category as string)?.toUpperCase() as 'CANCER' | 'NERVE' | 'GENERAL' | undefined;
        const sourceUrl = metadata.source as string || undefined;
        const title = metadata.title as string || undefined;

        if (type === 'faq') {
          // Q: ... A: ... 형식 파싱
          let question = '';
          let answer = '';

          if (item.content.includes('Q:') && item.content.includes('A:')) {
            const qMatch = item.content.match(/Q:\s*(.*?)(?=A:)/s);
            const aMatch = item.content.match(/A:\s*(.*)/s);
            question = qMatch?.[1]?.trim() || item.content.split('\n')[0];
            answer = aMatch?.[1]?.trim() || item.content;
          } else {
            question = item.content.split('\n')[0];
            answer = item.content;
          }

          // Q 임베딩
          const vector = await embed(question);
          const vectorStr = `[${vector.join(',')}]`;

          await prisma.$executeRawUnsafe(
            `INSERT INTO "HospitalFaq" (id, question, answer, metadata, category, "sourceUrl", title, vector, "createdAt", "updatedAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, $4::"MarketingCategory", $5, $6, $7::vector, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            question,
            answer,
            JSON.stringify(metadata),
            category || null,
            sourceUrl || null,
            title || null,
            vectorStr
          );
        } else {
          // Document
          const contentType = (metadata.type as string)?.toUpperCase() as 'YOUTUBE' | 'BLOG' | 'FAQ' | 'MANUAL' || 'MANUAL';

          const vector = await embed(item.content);
          const vectorStr = `[${vector.join(',')}]`;

          await prisma.$executeRawUnsafe(
            `INSERT INTO "MarketingDocument" (id, content, metadata, type, category, "sourceUrl", title, vector, "createdAt", "updatedAt")
             VALUES (gen_random_uuid()::text, $1, $2::jsonb, $3::"MarketingContentType", $4::"MarketingCategory", $5, $6, $7::vector, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            item.content,
            JSON.stringify(metadata),
            contentType,
            category || null,
            sourceUrl || null,
            title || null,
            vectorStr
          );
        }

        successCount++;
      } catch (err) {
        console.error(`[Marketing] Migration error:`, err);
        errorCount++;
      }
    }

    console.log(`[Marketing] Migration complete: ${successCount} success, ${errorCount} errors`);

    res.json({
      success: true,
      data: { successCount, errorCount, total: data.length },
    });
  }),
);

// ─── GET /api/marketing/stats ── 콘텐츠 현황 ───
router.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const [faqCount, docCount, sessionCount] = await Promise.all([
      prisma.hospitalFaq.count({ where: { deletedAt: null, isActive: true } }),
      prisma.marketingDocument.count({ where: { deletedAt: null, isActive: true } }),
      prisma.patientChatSession.count(),
    ]);

    res.json({
      success: true,
      data: { faqCount, docCount, sessionCount },
    });
  }),
);

export default router;
