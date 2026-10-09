FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace=@shortener/api --include=dev
COPY apps/api ./apps/api
RUN npm run build --workspace=@shortener/api
RUN npm prune --omit=dev --workspace=@shortener/api

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api ./apps/api
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
