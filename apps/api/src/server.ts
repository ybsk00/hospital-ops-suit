import http from 'http';
import app from './app';
import { env } from './config/env';
import { initWebSocket } from './websocket';
import { redis } from './lib/redis';

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
});
