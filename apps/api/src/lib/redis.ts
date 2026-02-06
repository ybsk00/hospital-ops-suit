import Redis from 'ioredis';
import { env } from '../config/env';

// Redis가 설정되지 않은 경우 null 반환 (Cloud Run 등에서 Redis 없이 동작)
let redis: Redis | null = null;

if (env.REDIS_URL && env.REDIS_URL !== 'redis://localhost:6379') {
  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 3) {
        console.warn('[Redis] 연결 포기 - Redis 없이 동작합니다.');
        return null; // 재시도 중단
      }
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on('error', (err) => {
    console.error('[Redis] 연결 오류:', err.message);
  });

  redis.on('connect', () => {
    console.log('[Redis] 연결 성공');
  });
} else {
  console.log('[Redis] REDIS_URL 미설정 - Redis 없이 동작합니다.');
}

export { redis };

// Redis 사용 가능 여부 체크
export function isRedisAvailable(): boolean {
  return redis !== null && redis.status === 'ready';
}
