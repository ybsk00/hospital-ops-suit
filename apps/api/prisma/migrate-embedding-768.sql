-- ============================================================
-- Embedding 벡터 차원 변경: 1536 → 768 (Gemini gemini-embedding-001)
-- Supabase SQL Editor에서 실행하세요
-- ============================================================

-- 기존 인덱스 삭제
DROP INDEX IF EXISTS "Embedding_vector_idx";

-- 벡터 컬럼 변경
ALTER TABLE "Embedding" ALTER COLUMN "vector" TYPE vector(768);

-- 인덱스 재생성 (ivfflat, lists=100)
-- 참고: 데이터가 100건 미만일 경우 이 인덱스는 나중에 생성해도 됩니다
-- CREATE INDEX "Embedding_vector_idx" ON "Embedding" USING ivfflat ("vector" vector_cosine_ops) WITH (lists = 100);
