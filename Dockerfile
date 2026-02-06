# Root Dockerfile for Cloud Build
# Builds the API service

FROM node:20-alpine AS builder

# Install build dependencies for native modules (canvas, etc.)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev

WORKDIR /app

# Copy package files
COPY apps/api/package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy prisma schema first (for generate)
COPY apps/api/prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY apps/api/src ./src
COPY apps/api/tsconfig.json ./

# Build
RUN npx tsc

# Production image
FROM node:20-alpine AS runner

# Install runtime dependencies for canvas
RUN apk add --no-cache \
    cairo \
    pango \
    jpeg \
    giflib \
    librsvg

WORKDIR /app

ENV NODE_ENV=production

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 4000

CMD ["node", "dist/index.js"]
