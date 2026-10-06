# Build from the repository root (the client imports ../shared):
#   docker build -f client/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app

COPY shared ./shared
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

COPY client ./client
# Empty: the app calls /api and /socket.io on its own origin, which nginx proxies.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN cd client && npm run build

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
