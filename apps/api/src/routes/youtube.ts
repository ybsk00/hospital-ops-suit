/**
 * YouTube 자동 동기화 API
 * Cloud Scheduler에서 매일 자정 호출
 */

import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/errorHandler';
import { embed } from '../services/embedding';

const router = Router();

const GEMINI_LLM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ─── POST /api/youtube/sync ── Cloud Scheduler 트리거 ───
router.post(
  '/sync',
  asyncHandler(async (req: Request, res: Response) => {
    const { days_back = 1 } = req.body || {};

    if (!env.YOUTUBE_API_KEY || !env.YOUTUBE_CHANNEL_ID || !env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: { code: 'CONFIG_MISSING', message: 'YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID, GEMINI_API_KEY 환경변수가 필요합니다.' },
      });
    }

    const stats = { videos_found: 0, videos_new: 0, faqs_created: 0, errors: [] as string[] };

    try {
      // 1. 최근 영상 조회
      const videos = await fetchRecentVideos(days_back);
      stats.videos_found = videos.length;

      // 2. 이미 처리된 영상 필터링
      const existingIds = await getExistingVideoIds(videos.map(v => v.videoId));
      const newVideos = videos.filter(v => !existingIds.has(v.videoId));
      stats.videos_new = newVideos.length;

      if (newVideos.length === 0) {
        return res.json({ success: true, message: '처리할 신규 영상이 없습니다.', ...stats });
      }

      // 3. 각 영상 처리
      for (const video of newVideos) {
        try {
          // 자막 추출 (실패시 영상 설명을 폴백으로 사용)
          let transcript = await getTranscript(video.videoId);
          if (!transcript) {
            // 자막 없으면 영상 제목 + 설명으로 FAQ 생성
            transcript = `[영상 제목] ${video.title}\n[영상 설명] ${video.description}`;
          }

          // FAQ 생성
          const faqs = await generateFaqs(video.title, transcript);
          if (!faqs.length) {
            stats.errors.push(`${video.videoId}: FAQ 생성 실패`);
            continue;
          }

          // DB 저장
          for (const faq of faqs) {
            try {
              await saveFaqToDb(faq, video);
              stats.faqs_created++;
            } catch (e: any) {
              stats.errors.push(`${video.videoId}: DB 저장 실패 - ${e.message?.slice(0, 100)}`);
            }
          }
        } catch (e: any) {
          stats.errors.push(`${video.videoId}: ${e.message?.slice(0, 100)}`);
        }
      }

      res.json({ success: true, ...stats });
    } catch (e: any) {
      res.status(500).json({ success: false, error: { code: 'SYNC_FAILED', message: e.message }, ...stats });
    }
  }),
);

// ─── GET /api/youtube/status ── 동기화 상태 조회 ───
router.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const [totalFaqs, videoFaqs, latestSync] = await Promise.all([
      prisma.hospitalFaq.count({ where: { deletedAt: null } }),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) as count FROM "HospitalFaq" WHERE "sourceVideoId" IS NOT NULL AND "deletedAt" IS NULL`
      ),
      prisma.$queryRawUnsafe<{ max: Date | null }[]>(
        `SELECT MAX("createdAt") as max FROM "HospitalFaq" WHERE "sourceVideoId" IS NOT NULL`
      ),
    ]);

    res.json({
      success: true,
      data: {
        totalFaqs,
        videoFaqs: Number(videoFaqs[0]?.count ?? 0),
        lastSyncAt: latestSync[0]?.max ?? null,
        channelId: env.YOUTUBE_CHANNEL_ID,
      },
    });
  }),
);

// ─── 헬퍼 함수들 ─────────────────────────────────────

interface VideoInfo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  url: string;
}

async function fetchRecentVideos(daysBack: number): Promise<VideoInfo[]> {
  const after = new Date(Date.now() - daysBack * 86400000).toISOString();

  const params = new URLSearchParams({
    key: env.YOUTUBE_API_KEY,
    channelId: env.YOUTUBE_CHANNEL_ID,
    part: 'snippet',
    order: 'date',
    type: 'video',
    publishedAfter: after,
    maxResults: '10',
  });

  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!resp.ok) throw new Error(`YouTube API 오류: ${resp.status}`);
  const data = await resp.json();

  return (data.items || [])
    .filter((item: any) => item.id?.videoId)
    .map((item: any) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      publishedAt: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));
}

async function getExistingVideoIds(videoIds: string[]): Promise<Set<string>> {
  if (!videoIds.length) return new Set();
  const rows = await prisma.$queryRawUnsafe<{ sourceVideoId: string }[]>(
    `SELECT "sourceVideoId" FROM "HospitalFaq" WHERE "sourceVideoId" = ANY($1)`,
    videoIds,
  );
  return new Set(rows.map(r => r.sourceVideoId));
}

async function getTranscript(videoId: string): Promise<string | null> {
  // YouTube 자막 페이지에서 자동자막 추출 시도
  try {
    const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    const html = await resp.text();

    // captionTracks에서 자막 URL 추출
    const match = html.match(/"captionTracks":\[.*?"baseUrl":"(.*?)"/);
    if (match) {
      const captionUrl = match[1].replace(/\\u0026/g, '&');
      const captionResp = await fetch(captionUrl);
      const xml = await captionResp.text();

      // XML에서 텍스트 추출
      const texts = xml.match(/<text[^>]*>(.*?)<\/text>/gs);
      if (texts) {
        return texts
          .map(t => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'))
          .join(' ')
          .trim();
      }
    }
  } catch (e) {
    // 자막 추출 실패 → 폴백 (영상 설명 사용)
  }

  // 자막을 가져올 수 없으면 YouTube Data API로 전체 description 가져오기
  try {
    const params = new URLSearchParams({
      key: env.YOUTUBE_API_KEY,
      id: videoId,
      part: 'snippet',
    });
    const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    if (resp.ok) {
      const data = await resp.json();
      const desc = data.items?.[0]?.snippet?.description;
      if (desc && desc.length > 50) {
        return desc;
      }
    }
  } catch (e) {
    // description 조회도 실패
  }

  return null;
}

interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

async function generateFaqs(title: string, transcript: string): Promise<FaqItem[]> {
  const trimmed = transcript.slice(0, 30000);

  const prompt = `당신은 암요양병원(서울온케어의원) FAQ 작성 전문가입니다.
아래 유튜브 영상의 스크립트를 읽고, 환자가 궁금해할 FAQ를 5~10개 생성해주세요.

[규칙]
1. 각 FAQ는 반드시 아래 JSON 형식으로 출력
2. question: 환자 관점의 자연스러운 질문
3. answer: 전문적이지만 이해하기 쉬운 답변 (3~5문장)
4. category: CANCER(암 관련), NERVE(자율신경/통증), GENERAL(일반) 중 하나

[영상 제목]: ${title}

[스크립트]:
${trimmed}

[출력 형식] (반드시 JSON 배열만 출력):
[{"question":"질문","answer":"답변","category":"CANCER"}]`;

  const resp = await fetch(`${GEMINI_LLM_URL}?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  if (!resp.ok) throw new Error(`Gemini API 오류: ${resp.status}`);
  const data = await resp.json();

  let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  // ```json ... ``` 제거
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function saveFaqToDb(faq: FaqItem, video: VideoInfo): Promise<void> {
  const vector = await embed(faq.question);
  const vectorStr = `[${vector.join(',')}]`;
  const metadata = JSON.stringify({
    videoTitle: video.title,
    videoUrl: video.url,
    publishedAt: video.publishedAt,
    autoGenerated: true,
    syncedAt: new Date().toISOString(),
  });

  await prisma.$executeRawUnsafe(
    `INSERT INTO "HospitalFaq" (
      "id", "question", "answer", "metadata", "vector",
      "category", "sourceUrl", "sourceVideoId", "title",
      "isActive", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), $1, $2, $3::jsonb, $4::vector,
      $5::"MarketingCategory", $6, $7, $8,
      true, NOW(), NOW()
    )`,
    faq.question, faq.answer, metadata, vectorStr,
    faq.category, video.url, video.videoId, video.title,
  );
}

export default router;
