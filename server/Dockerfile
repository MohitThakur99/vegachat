# Build from the repository root (the server imports ../shared):
#   docker build -f server/Dockerfile .
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/src ./server/src

# Uploads are written at runtime, so the unprivileged user must own the folder.
RUN mkdir -p /app/server/uploads && chown -R node:node /app/server/uploads
USER node

WORKDIR /app/server
EXPOSE 4000
CMD ["node", "src/index.js"]
