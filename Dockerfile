# Root Dockerfile for Cloud Build
# Builds the API service

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY apps/api/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy prisma schema first (for generate)
COPY apps/api/prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY apps/api/src ./src
COPY apps/api/tsconfig.json ./

# Install dev dependencies for build
RUN npm install typescript @types/node --save-dev

# Build
RUN npx tsc

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 4000

CMD ["node", "dist/index.js"]
