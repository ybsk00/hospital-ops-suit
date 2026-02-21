/**
 * 도수 예약 누락분 적용 - migration.sql에서 ManualTherapySlot만 추출하여 실행
 * source 캐스팅 수정: ::text → ::"AppointmentSource"
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const sqlPath = path.join(__dirname, 'migration.sql');
  const content = fs.readFileSync(sqlPath, 'utf-8');

  const lines = content.split('\n')
    .filter(line => line.includes('"ManualTherapySlot"'))
    .map(line => line.replace(/'MIGRATION'::text/g, "'MIGRATION'::\"AppointmentSource\""));

  console.log(`도수 예약 SQL: ${lines.length}건`);

  const before = await prisma.manualTherapySlot.count({ where: { deletedAt: null } });
  console.log(`적용 전: ${before}건`);

  // 10건씩 배치로 실행
  const BATCH = 10;
  let success = 0, skip = 0, err = 0;

  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH);
    const sql = batch.join('\n');
    try {
      await prisma.$executeRawUnsafe(sql);
      // ON CONFLICT DO NOTHING이므로 성공한 건수를 정확히 알 수 없지만 일단 배치 성공
      success += batch.length;
    } catch (e: any) {
      // 배치 실패 시 개별 실행
      for (const line of batch) {
        try {
          await prisma.$executeRawUnsafe(line);
          success++;
        } catch (e2: any) {
          if (e2.message.includes('unique') || e2.message.includes('conflict')) {
            skip++;
          } else {
            err++;
            if (err <= 5) console.error(`  ERR: ${e2.message.substring(0, 200)}`);
          }
        }
      }
    }
    if ((i + BATCH) % 100 === 0) process.stdout.write(`  ${i + BATCH}/${lines.length}...\r`);
  }

  const after = await prisma.manualTherapySlot.count({ where: { deletedAt: null } });
  console.log(`\n✅ 완료: 처리 ${success}, 스킵 ${skip}, 에러 ${err}`);
  console.log(`적용 후: ${after}건 (${after - before}건 추가)`);
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
