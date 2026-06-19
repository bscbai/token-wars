# Token Wars — Production Docker Image
FROM node:22-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY server/ ./server/
COPY shared/ ./shared/
COPY client/ ./client/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
