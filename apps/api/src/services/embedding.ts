/**
 * Gemini 임베딩 서비스
 * gemini-embedding-001 (768차원으로 축소) 사용
 */
import { env } from '../config/env';
import { prisma } from '../lib/prisma';

const EMBEDDING_DIMENSION = 768;

/**
 * 텍스트를 Gemini 임베딩 벡터로 변환 (768차원)
 */
export async function embed(text: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${env.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSION
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

/**
 * 여러 텍스트를 한 번에 임베딩
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results = await Promise.all(texts.map((text) => embed(text)));
  return results;
}

/**
 * 엔티티를 임베딩하여 DB에 저장 (upsert)
 */
export async function upsertEmbedding(
  entityType: string,
  entityId: string,
  content: string,
  metadata?: Record<string, unknown>,
  chunkIndex = 0,
): Promise<void> {
  const vector = await embed(content);
  const vectorStr = `[${vector.join(',')}]`;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Embedding" ("id", "entityType", "entityId", "chunkIndex", "content", "vector", "metadata", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::vector, $6::jsonb, NOW(), NOW())
     ON CONFLICT ("id") DO UPDATE SET
       "content" = EXCLUDED."content",
       "vector" = EXCLUDED."vector",
       "metadata" = EXCLUDED."metadata",
       "updatedAt" = NOW()`,
    entityType,
    entityId,
    chunkIndex,
    content,
    vectorStr,
    metadata ? JSON.stringify(metadata) : null,
  );
}

/**
 * 유사도 검색 (코사인 유사도)
 */
export async function searchSimilar(
  query: string,
  options: {
    entityType?: string;
    limit?: number;
    threshold?: number;
  } = {},
): Promise<Array<{
  entityType: string;
  entityId: string;
  content: string;
  similarity: number;
  metadata: unknown;
}>> {
  const { entityType, limit = 5, threshold = 0.7 } = options;
  const queryVector = await embed(query);
  const vectorStr = `[${queryVector.join(',')}]`;

  const typeFilter = entityType
    ? `AND "entityType" = '${entityType}'`
    : '';

  const results = await prisma.$queryRawUnsafe<Array<{
    entityType: string;
    entityId: string;
    content: string;
    similarity: number;
    metadata: unknown;
  }>>(
    `SELECT "entityType", "entityId", "content", "metadata",
            1 - ("vector" <=> $1::vector) AS similarity
     FROM "Embedding"
     WHERE 1 - ("vector" <=> $1::vector) >= $2
       ${typeFilter}
     ORDER BY "vector" <=> $1::vector
     LIMIT $3`,
    vectorStr,
    threshold,
    limit,
  );

  return results;
}

export { EMBEDDING_DIMENSION };
