/**
 * 온케어의원 챗봇 데이터 마이그레이션 스크립트 (임베딩 없이)
 * 기존 hospital_faqs_backup.json 데이터를 HospitalFaq 테이블로 마이그레이션
 * 임베딩은 나중에 별도 배치로 추가
 *
 * 실행: npx ts-node scripts/migrate-chatbot-no-embed.ts
 */

import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const BATCH_SIZE = 50;

interface BackupItem {
  id: string;
  content: string;
  metadata: {
    type?: string;
    title?: string;
    source?: string;
    chunk_index?: number;
    original_video_title?: string;
  };
}

function parseQA(content: string): { question: string; answer: string } {
  let question = '';
  let answer = '';

  if (content.includes('Q:') && content.includes('A:')) {
    const qMatch = content.match(/Q:\s*(.*?)(?=A:)/s);
    const aMatch = content.match(/A:\s*(.*)/s);
    question = qMatch?.[1]?.trim() || content.split('\n')[0];
    answer = aMatch?.[1]?.trim() || content;
  } else {
    question = content.split('\n')[0];
    answer = content;
  }

  return { question, answer };
}

function detectCategory(content: string, metadata: BackupItem['metadata']): 'CANCER' | 'NERVE' | 'GENERAL' {
  const text = (content + ' ' + (metadata.title || '')).toLowerCase();

  const cancerKeywords = [
    '암', '종양', '항암', '전이', '재발', '말기', '면역', '항암제',
    '고주파', '온열', '유방암', '폐암', '간암', '위암', '대장암', '췌장암',
    '림프종', '백혈병', '암환자', '암치료', '암보조', 'cancer'
  ];

  const nerveKeywords = [
    '자율신경', '미주신경', '교감신경', '부교감', '어지러움', '두통',
    '불면', '수면', '불안', '긴장', '스트레스', '실신', '빈맥',
    '심장', '호흡', '소화', '경추', '목', '승모근', '거북목'
  ];

  if (cancerKeywords.some(kw => text.includes(kw))) {
    return 'CANCER';
  }

  if (nerveKeywords.some(kw => text.includes(kw))) {
    return 'NERVE';
  }

  return 'GENERAL';
}

async function migrate() {
  console.log('=== 온케어 챗봇 데이터 마이그레이션 (임베딩 없이) ===\n');

  const backupPath = path.resolve(__dirname, '../../../../온케어의원 챗봇/hospital_faqs_backup.json');

  if (!fs.existsSync(backupPath)) {
    console.error('백업 파일을 찾을 수 없습니다:', backupPath);
    process.exit(1);
  }

  console.log('백업 파일 읽는 중...');
  const rawData = fs.readFileSync(backupPath, 'utf-8');
  const items: BackupItem[] = JSON.parse(rawData);

  console.log(`총 ${items.length}개 항목 발견\n`);

  let successCount = 0;
  let errorCount = 0;
  let skipCount = 0;

  // 기존 데이터 중복 체크를 위한 Set
  const existingQuestions = new Set<string>();
  const existingFaqs = await prisma.hospitalFaq.findMany({
    select: { question: true },
    where: { deletedAt: null }
  });
  existingFaqs.forEach(f => existingQuestions.add(f.question.slice(0, 100)));

  console.log(`기존 FAQ ${existingFaqs.length}개 로드\n`);

  // 배치 처리
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    console.log(`배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(items.length / BATCH_SIZE)} 처리 중... (${i + 1}-${Math.min(i + BATCH_SIZE, items.length)})`);

    for (const item of batch) {
      try {
        const { question, answer } = parseQA(item.content);

        // 중복 체크
        if (existingQuestions.has(question.slice(0, 100))) {
          skipCount++;
          continue;
        }

        const category = detectCategory(item.content, item.metadata);
        const sourceUrl = item.metadata?.source || null;
        const title = item.metadata?.title || item.metadata?.original_video_title || null;

        // DB 삽입 (임베딩 없이)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "HospitalFaq" (id, question, answer, metadata, category, "sourceUrl", title, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, $4::"MarketingCategory", $5, $6, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          question,
          answer,
          JSON.stringify(item.metadata),
          category,
          sourceUrl,
          title
        );

        existingQuestions.add(question.slice(0, 100));
        successCount++;

      } catch (err) {
        console.error(`  오류 (${item.id}):`, err instanceof Error ? err.message : err);
        errorCount++;
      }
    }
  }

  console.log('\n=== 마이그레이션 완료 ===');
  console.log(`성공: ${successCount}개`);
  console.log(`중복 스킵: ${skipCount}개`);
  console.log(`오류: ${errorCount}개`);
  console.log(`총: ${items.length}개`);

  await prisma.$disconnect();
}

migrate().catch(err => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
