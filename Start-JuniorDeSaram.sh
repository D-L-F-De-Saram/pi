#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
docker compose up -d --no-deps junior-de-saram
if grep -q '^DESARAM_TYPESENSE_URL=http://127\.0\.0\.1:18108[[:space:]]*$' .env; then
  sh ./Connect-DeSaramSources.sh
fi
docker exec -it junior-de-saram node junior-de-saram/cli.mjs "$@"
