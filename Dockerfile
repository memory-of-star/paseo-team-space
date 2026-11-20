FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY service ./service
COPY shared ./shared
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /build/dist/team-service.mjs ./team-service.mjs
RUN mkdir /data && chown node:node /data
USER node
ENV TEAM_HOST=0.0.0.0 TEAM_PORT=8787 TEAM_DB=/data/team.db
EXPOSE 8787
CMD ["node", "team-service.mjs"]
