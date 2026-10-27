# syntax=docker/dockerfile:1

# ---- 開発用（Vite dev server） ----
FROM node:24-bookworm-slim AS dev
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- ビルド ----
FROM dev AS build
RUN npm run build

# ---- 本番配信（nginx で静的配信） ----
FROM nginx:1.29-alpine AS prod
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
