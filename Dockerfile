FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Copy package manifests, pre-installed node_modules, compiled backend, and frontend
COPY package*.json ./
COPY node_modules ./node_modules
COPY dist ./dist
COPY migrations ./migrations
COPY frontend/dist ./frontend/dist

RUN mkdir -p /app/data/storage && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
