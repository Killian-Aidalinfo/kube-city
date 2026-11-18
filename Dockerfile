# Kube City : image de production multi-étapes, petite et sans privilèges
# 1. build : dépendances complètes + Vite => client/dist
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client ./client
RUN npm run build:client

# 2. deps : seulement les dépendances d'exécution du serveur
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 3. image finale : serveur Node + client compilé (aucun outil de build)
FROM node:22-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION} PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 8080
# exec form : node reçoit directement SIGTERM (arrêt propre)
CMD ["node", "src/server.js"]
