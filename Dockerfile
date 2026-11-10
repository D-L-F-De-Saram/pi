FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip python-is-python3 libreoffice-writer libreoffice-calc libreoffice-impress pandoc poppler-utils tesseract-ocr fonts-dejavu fonts-liberation fonts-noto-core && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages --no-cache-dir python-docx==1.2.0 python-pptx==1.0.2 openpyxl==3.1.5 pandas==2.3.3 pypdf==6.1.3 pdfplumber==0.11.7 reportlab==4.4.4 pillow==12.0.0 defusedxml==0.7.1 lxml==6.0.2 pdf2image==1.17.0 'markitdown[pptx]==0.1.3'
COPY package.json package-lock.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json tsconfig.base.json biome.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
RUN npm run hydrate:model-data && npm run build:offline
COPY junior-de-saram/package.json junior-de-saram/package-lock.json ./junior-de-saram/
RUN --mount=type=cache,target=/root/.npm npm --prefix junior-de-saram ci --ignore-scripts
RUN npm --prefix junior-de-saram exec -- playwright install --with-deps chromium
ENV NODE_PATH=/app/junior-de-saram/node_modules PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright && cp -a /root/.cache/ms-playwright/. /ms-playwright/ && chmod -R a+rX /ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends ghostscript && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages --no-cache-dir PyMuPDF==1.26.6
COPY .pi ./.pi
COPY .agents ./.agents
COPY junior-de-saram ./junior-de-saram
ENV PI_SKIP_VERSION_CHECK=1 JUNIOR_DE_SARAM_PORT=8160 JUNIOR_DE_SARAM_SESSION_DIR=/data/sessions JUNIOR_DE_SARAM_WORKSPACE_ROOT=/data/workspaces JUNIOR_DE_SARAM_ARTIFACT_ROOT=/data/artifacts
RUN mkdir -p /data/sessions /data/logs /data/workspaces /data/artifacts && chown -R node:node /data
USER node
EXPOSE 8160
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8160/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "junior-de-saram/server/openai.mjs"]
