# Multi-stage production build for standalone and clustered NexusFlow
FROM node:22-alpine AS builder
WORKDIR /app

# Install backend dependencies
COPY package*.json ./
RUN npm ci

# Copy frontend package manifests and install dependencies
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend ci

# Copy backend & frontend source trees
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY frontend ./frontend

# Build backend and frontend Vite bundle
RUN npm run build
RUN npm run build:frontend

# Runner stage - minimal production image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/frontend/dist ./frontend/dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
