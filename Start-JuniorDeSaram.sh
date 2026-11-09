#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
docker compose up -d --no-deps junior-de-saram
docker exec -it junior-de-saram node packages/coding-agent/dist/bundle/cli.js --approve --provider google --model gemini-3.7-flash --thinking low --no-builtin-tools --no-context-files --no-skills --skill .agents/skills/de-saram-legal-final-answer/SKILL.md --no-extensions --extension builtin:mcp --extension .pi/extensions/junior-de-saram-context.ts --extension .pi/extensions/de-saram-delivery.ts "$@"
