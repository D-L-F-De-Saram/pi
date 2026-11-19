# The hosted deployment builds a credential-holding bridge, a Docker runner,
# and a minimal Pi image. Only the runner starts per-message Pi containers.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip python-is-python3 libreoffice-writer libreoffice-calc libreoffice-impress pandoc poppler-utils tesseract-ocr fonts-dejavu fonts-liberation fonts-noto-core ghostscript && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages --no-cache-dir python-docx==1.2.0 python-pptx==1.0.2 openpyxl==3.1.5 pandas==2.3.3 pypdf==6.1.3 pdfplumber==0.11.7 reportlab==4.4.4 pillow==12.0.0 defusedxml==0.7.1 lxml==6.0.2 pdf2image==1.17.0 'markitdown[pptx]==0.1.3' PyMuPDF==1.26.6
COPY package.json package-lock.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json tsconfig.base.json biome.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
RUN npm run hydrate:model-data && npm run build:offline

FROM ${NODE_IMAGE} AS pi-sandbox
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fd-find libreoffice-calc libreoffice-impress libreoffice-writer pandoc poppler-utils python3 python3-defusedxml python3-pip qpdf ripgrep tesseract-ocr ghostscript fonts-dejavu fonts-liberation fonts-noto-core && rm -rf /var/lib/apt/lists/*
COPY junior-de-saram/deploy/pi-libs/requirements.txt /tmp/pi-libs/requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir --no-deps -r /tmp/pi-libs/requirements.txt && python3 -m pip check && python3 -m pip install --break-system-packages --no-cache-dir --no-deps PyMuPDF==1.26.6 && rm -rf /tmp/pi-libs
COPY junior-de-saram/deploy/pi-libs/package.json junior-de-saram/deploy/pi-libs/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force && ln -s /app/node_modules /node_modules
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/packages/coding-agent/package.json /app/packages/coding-agent/README.md /app/packages/coding-agent/CHANGELOG.md ./packages/coding-agent/
COPY --from=build /app/packages/coding-agent/dist ./packages/coding-agent/dist
COPY --from=build /app/packages/coding-agent/docs ./packages/coding-agent/docs
COPY --from=build /app/packages/coding-agent/examples ./packages/coding-agent/examples
COPY --from=build /app/packages/coding-agent/schemas ./packages/coding-agent/schemas
COPY junior-de-saram/deploy/pi-libs/check-pi-packages.mjs /tmp/check-pi-packages.mjs
RUN node /tmp/check-pi-packages.mjs && rm -rf /tmp/check-pi-packages.mjs /root/.npm
COPY .pi/mcp.json ./.pi/mcp.json
COPY .pi/extensions/junior-de-saram-context.ts .pi/extensions/junior-de-saram-scope-guard.ts .pi/extensions/de-saram-delivery.ts ./.pi/extensions/
COPY junior-de-saram/core/tool-safety.mjs junior-de-saram/core/code-runner.mjs junior-de-saram/core/citations.mjs junior-de-saram/core/source-citations.mjs junior-de-saram/core/preview-delivery.mjs ./junior-de-saram/core/
COPY junior-de-saram/mcp/sandbox-launcher.mjs ./junior-de-saram/mcp/server.mjs
COPY .agents/skills/de-saram-legal-final-answer ./.agents/skills/de-saram-legal-final-answer
COPY .agents/skills/de-saram-source-retrieval ./.agents/skills/de-saram-source-retrieval
COPY .agents/skills/de-saram-legal-drafting ./.agents/skills/de-saram-legal-drafting
COPY .agents/skills/pdf ./.agents/skills/pdf
COPY .agents/skills/pptx ./.agents/skills/pptx
COPY .agents/skills/xlsx ./.agents/skills/xlsx
COPY .agents/skills/docx ./.agents/skills/docx
COPY junior-de-saram/deploy/pi-entrypoint.sh ./deploy/pi-entrypoint.sh
COPY junior-de-saram/deploy/pi-agent-seed ./deploy/pi-agent-seed
RUN chmod 755 ./deploy/pi-entrypoint.sh
ENV NODE_ENV=production PI_OFFLINE=1 PI_TELEMETRY=0 PI_SKIP_VERSION_CHECK=1
USER node
ENTRYPOINT ["/app/deploy/pi-entrypoint.sh"]

FROM ${NODE_IMAGE} AS runner
COPY --from=docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY junior-de-saram/runner ./junior-de-saram/runner
USER node
EXPOSE 8162
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8162/health',{headers:{authorization:'Bearer '+process.env.DS_RUNNER_SECRET}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "junior-de-saram/runner/server.mjs"]

FROM build AS bridge
COPY junior-de-saram/package.json junior-de-saram/package-lock.json ./junior-de-saram/
RUN --mount=type=cache,target=/root/.npm npm --prefix junior-de-saram ci --ignore-scripts
COPY .pi ./.pi
COPY .agents ./.agents
COPY junior-de-saram ./junior-de-saram
ENV PI_SKIP_VERSION_CHECK=1 JUNIOR_DE_SARAM_PORT=8160 JUNIOR_DE_SARAM_DATA_ROOT=/data JUNIOR_DE_SARAM_SESSION_DIR=/data/sessions JUNIOR_DE_SARAM_WORKSPACE_ROOT=/data/workspaces JUNIOR_DE_SARAM_ARTIFACT_ROOT=/data/artifacts
RUN mkdir -p /data/users /data/logs /data/private-wiki && chown -R node:node /data
USER node
EXPOSE 8160
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8160/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "junior-de-saram/server/openai.mjs"]
