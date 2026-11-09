FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json tsconfig.base.json biome.json ./
RUN npm ci --ignore-scripts && npm run hydrate:model-data && npm run build:offline
COPY .pi ./.pi
COPY .agents ./.agents
COPY junior-de-saram ./junior-de-saram
ENV PI_SKIP_VERSION_CHECK=1 JUNIOR_DE_SARAM_PORT=8160 JUNIOR_DE_SARAM_SESSION_DIR=/data/sessions
RUN mkdir -p /data/sessions /data/logs && chown -R node:node /data
USER node
EXPOSE 8160
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8160/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "junior-de-saram/server/openai.mjs"]
