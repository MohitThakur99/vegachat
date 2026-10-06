# One image that runs the whole app on one port: the Node server serves the
# API, the sockets and the built React client. This is what hosted deployments
# use (see render.yaml). Local `docker compose up` uses the two Dockerfiles in
# server/ and client/ instead.
#
#   docker build -t vegachat .

FROM node:20-alpine AS client
WORKDIR /app
COPY shared ./shared
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/src ./server/src
COPY --from=client /app/client/dist ./client/dist

ENV CLIENT_DIST_DIR=/app/client/dist \
    UPLOAD_DIR=/app/server/uploads

# Uploads are written at runtime, so the unprivileged user must own the folder.
RUN mkdir -p /app/server/uploads && chown -R node:node /app/server/uploads
USER node

WORKDIR /app/server
EXPOSE 4000
CMD ["node", "src/index.js"]
