# ---- build the React client ----
FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npx vite build --outDir /app/public --emptyOutDir

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=5000 STAK_DATA_DIR=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=client /app/public ./public
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "server/index.js"]
