# For hosts that run containers (Fly.io, Railway, a VPS). Uses SQLite on a volume
# mounted at /data unless DATABASE_URL is set.
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=8080 SQLITE_PATH=/data/dashboard.db
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.mjs"]
