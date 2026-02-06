/**
 * 임베딩이 없는 FAQ에 임베딩 추가
 * Gemini REST API 직접 호출
 *
 * 실행: npx ts-node scripts/add-embeddings.ts
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const BATCH_SIZE = 20;
const DELAY_MS = 100;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function embed(text: string): Promise<number[]> {
  // gemini-embedding-001 모델 사용 (768차원으로 축소)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: 768
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== 임베딩 추가 시작 ===\n');

  // 임베딩이 없는 FAQ 조회 (Raw SQL)
  const faqsWithoutEmbedding = await prisma.$queryRaw<{id: string, question: string}[]>`
    SELECT id, question FROM "HospitalFaq"
    WHERE "deletedAt" IS NULL AND vector IS NULL
  `;

  console.log(`임베딩이 없는 FAQ: ${faqsWithoutEmbedding.length}개\n`);

  if (faqsWithoutEmbedding.length === 0) {
    console.log('모든 FAQ에 임베딩이 있습니다.');
    await prisma.$disconnect();
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < faqsWithoutEmbedding.length; i += BATCH_SIZE) {
    const batch = faqsWithoutEmbedding.slice(i, i + BATCH_SIZE);
    console.log(`배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(faqsWithoutEmbedding.length / BATCH_SIZE)} 처리 중...`);

    for (const faq of batch) {
      try {
        const vector = await embed(faq.question);
        const vectorStr = `[${vector.join(',')}]`;

        await prisma.$executeRawUnsafe(
          `UPDATE "HospitalFaq" SET vector = $1::vector, "updatedAt" = NOW() WHERE id = $2`,
          vectorStr,
          faq.id
        );

        successCount++;

        // Rate limit 방지
        await sleep(DELAY_MS);
      } catch (err) {
        console.error(`  오류 (${faq.id}):`, err instanceof Error ? err.message : err);
        errorCount++;
      }
    }
  }

  console.log('\n=== 임베딩 추가 완료 ===');
  console.log(`성공: ${successCount}개`);
  console.log(`오류: ${errorCount}개`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('오류:', err);
  process.exit(1);
});
