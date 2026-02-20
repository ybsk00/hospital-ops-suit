FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# 로컬 env 파일 제거 (dockerignore 우회 방지)
RUN rm -f .env .env.local .env.development .env.production .env.development.local .env.production.local

ARG NEXT_PUBLIC_API_URL=https://hospital-ops-api-783253438610.asia-northeast3.run.app
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN echo "NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL" && npm run build

# ── Production ──
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npx", "next", "start", "-p", "8080"]
