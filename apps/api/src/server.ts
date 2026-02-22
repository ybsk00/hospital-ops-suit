import http from 'http';
import app from './app';
import { env } from './config/env';
import { initWebSocket } from './websocket';
import { redis } from './lib/redis';
import { startSheetSyncWorker, startAutoSheetSync } from './queues';

const server = http.createServer(app);

// WebSocket 초기화
initWebSocket(server);

// Redis 연결 (선택적)
if (redis) {
  redis.connect().catch((err) => {
    console.error('[Redis] 초기 연결 실패:', err.message);
  });
}

server.listen(env.PORT, () => {
  console.log(`[Server] 서울온케어 API 서버 시작 - 포트 ${env.PORT}`);
  console.log(`[Server] WebSocket 경로: /ws`);
  console.log(`[Server] 환경: ${env.NODE_ENV}`);

  // BullMQ Worker 시작 (Redis 없으면 인라인 모드)
  startSheetSyncWorker();

  // 5분 자동 시트 동기화 타이머 시작
  startAutoSheetSync();
});
