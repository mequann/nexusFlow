# -------------------------------------------------------------
# Stage 1: Build Backend & Frontend
# -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Install backend dependencies & build backend
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src
RUN npm run build

# Install frontend dependencies & build frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Production Runtime
# -------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY migrations ./migrations

RUN mkdir -p /app/data/storage && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
