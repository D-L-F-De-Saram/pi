# Junior De Saram hosted isolation: deployment and checks

The hosted path consists of the LibreChat-facing bridge, a Docker runner, and one short-lived Pi container per message. Pi runs with `runsc` on a private slot network and receives only its chat's uploads and artifacts (read-only) and workspace and sessions (read-write). The bridge keeps provider and service credentials, source access, the private catalog, and full administrator traces. This design follows the hardened Junior Silva deployment. The native CLI is a separate single-developer mode and does not provide these hosted isolation guarantees.

The runner has the Docker socket and therefore host-level Docker authority; keep it on its private control network and do not publish its port. The bridge trusts LibreChat's identity headers only because the LibreChat backend holds its API key. These two services remain privileged trust boundaries even though the Pi sandbox has no host credentials or direct source-network access.

## Before changing the running instance

1. Preserve the existing `.env`, private wiki/catalog, and the four legacy Docker volumes (`sessions`, `workspaces`, `artifacts`, `uploads`). Do not run `docker compose down -v`. The new layout does not automatically import old Pi sessions: their IDs and paths were derived using the old API key, whereas the new layout derives per-user/per-chat paths using `DS_IDENTITY_SECRET`. Existing LibreChat messages remain in LibreChat, but an old chat starts a fresh Pi session until its files and session are explicitly mapped. Retain the legacy volumes.
2. Check that LibreChat sends `X-LibreChat-User-Id: {{LIBRECHAT_USER_ID}}` and `X-LibreChat-Conversation-Id: {{LIBRECHAT_BODY_CONVERSATIONID}}` to **Junior De Saram Pi**. The bridge rejects missing/placeholder IDs. Keep its API key in LibreChat's environment, and do not expose the bridge directly to untrusted callers: LibreChat's identity headers are trusted only from that backend.
3. Check `docker info --format '{{json .Runtimes}}'` for `runsc` on the Docker **host**. If absent on a Linux Docker Engine host, review and run `sudo bash junior-de-saram/deploy/install-gvisor.sh 20261026.0`. This verifies the downloaded SHA-512 checksum and registers `runsc`; it reloads Docker. Do not run it inside a WSL distribution that merely connects to Docker Desktop's daemon. The laptop's native WSL Docker Engine was configured with `runsc` on 2026-11-17 and an ephemeral gVisor container passed the runtime check; other Docker hosts must be checked separately.

## Environment

Keep the existing service URL and credential settings from `.env`. Add these settings to Junior De Saram's `.env` (use new, independent random secrets; do not copy Junior Silva's):

```dotenv
PI_PROVIDER=google
PI_MODEL=gemini-3.8-flash
PI_THINKING=low
DS_IDENTITY_SECRET=<openssl-rand-hex-32>
DS_RUNNER_SECRET=<another-openssl-rand-hex-32>
JUNIOR_DE_SARAM_ARTIFACT_SECRET=<another-openssl-rand-hex-32>
DS_HOST_DATA_ROOT=/home/paralegaluser/app/junior-de-saram-data
DS_DOCKER_GID=<numeric-group-id-of-/var/run/docker.sock>
DS_SLOTS=3
DS_MAX_RUNS_PER_USER=2
DS_SLOT_WAIT_MS=300000
DS_RUN_TIMEOUT_MS=1200000
DS_LINK_TTL_HOURS=168
DS_GATEWAY_PORT=8161
DS_ALLOWED_MODELS=google/gemini-3.8-flash,anthropic/claude-sonnet-5-5
LIBRECHAT_NETWORK=librechat_default
# For verified original DOCX template copies, if the read-only gateway is deployed:
DESARAM_DRAFTING_SOURCE_URL=http://127.0.0.1:18130
DESARAM_DRAFTING_SOURCE_TOKEN=<same-token-as-upload-process-service>
```

The `PI_PROVIDER`/`PI_MODEL` default must be in `DS_ALLOWED_MODELS`, and a real provider API key must be configured for each listed provider. The bridge currently proxies Anthropic and Google; OpenAI selections are not exposed through this hosted path. Generate each secret separately with `openssl rand -hex 32` and paste it privately into `.env`. Preserve `DS_IDENTITY_SECRET` across restarts because changing it changes all user/chat folder hashes. Preserve the artifact secret for the lifetime of existing download links.

`DS_SLOTS` limits **simultaneous Pi containers overall**. `DS_MAX_RUNS_PER_USER` limits **simultaneous runs for one user** (default 2, as in Junior Silva). These are concurrency limits, not a cap on saved Pi sessions or LibreChat conversations. Requests for one chat are serialized. The runner queues when all slots are busy and returns a busy response after `DS_SLOT_WAIT_MS`.

Set `JUNIOR_DE_SARAM_WIKI_HOST_PATH` to the existing private catalog directory. Only the bridge mounts it; Pi does not. Existing `DESARAM_*` source URLs must be reachable **from the bridge container**. For the existing laptop setup, `Connect-DeSaramSources.sh` creates loopback SSH forwards in the bridge's network namespace, so its current `127.0.0.1:18108`, `:18124`, `:17008`, and `:18130` URLs remain appropriate. Rerun that script after recreating the bridge. On a server without those forwards, use service URLs reachable from the bridge. The original source DOCX gateway remains a separate read-only service and is unchanged by this migration.

If the original DOCX gateway is not deployed/configured, catalog search and Markdown/sample-based drafting continue to work, but `de_saram_template_copy` cannot retrieve a verified original template. Do not claim that a template was copied in that state. This security migration does not change the source service or its database.

For the model picker, set LibreChat's Junior De Saram Pi endpoint `piAllowedModels` to `${JUNIOR_DE_SARAM_ALLOWED_MODELS}` and put the same provider/model list in LibreChat's `.env`. Its current `${JUNIOR_SILVA_ALLOWED_MODELS}` includes OpenAI models, which this bridge intentionally does not proxy. Keep its existing `headers`, `resendFiles: false`, `piModelPicker`, `piDefaultModel`, and `piDefaultEffort` settings.

## Build and start (run yourself)

From the Junior De Saram repository on the Docker host:

```bash
cd ~/app/junior-de-saram
id -u
stat -c '%g' /var/run/docker.sock
mkdir -p /home/paralegaluser/app/junior-de-saram-data
chmod 700 /home/paralegaluser/app/junior-de-saram-data
mkdir -p junior-de-saram/logs
docker network inspect librechat_default >/dev/null
docker compose --profile pi-image build junior-de-saram-pi junior-de-saram-runner junior-de-saram
docker compose up -d --force-recreate junior-de-saram-runner junior-de-saram
```

Use an absolute, space-free Linux path for `DS_HOST_DATA_ROOT`. It must be writable by UID 1000, which the bridge and Pi use. If the repository or Docker service is elsewhere, adapt `cd`, `LIBRECHAT_NETWORK`, and the data path. Docker's cache is used by the build command; no `--no-cache` is needed. If Compose reports `runsc` missing, resolve the host runtime before sending hosted requests. Do not switch to local process mode on a multi-user host to bypass this requirement.

On the laptop, after the containers are recreated, run `sh ./Connect-DeSaramSources.sh` from the repository to restore the existing source forwards. The laptop's native WSL Docker Engine now lists `runsc`; the source-forward script does not install gVisor. The read-only original DOCX source gateway still needs its separate service and matching token before template copies can be tested.

## Smoke and security checks

```bash
docker compose ps junior-de-saram junior-de-saram-runner
docker inspect -f '{{.State.Health.Status}}' junior-de-saram-runner
curl -fsS http://127.0.0.1:8160/health
docker network inspect ds-slot-1 --format '{{.Internal}} {{index .Options "com.docker.network.bridge.gateway_mode_ipv4"}}'
docker logs --since 10m junior-de-saram-runner
docker logs --since 10m junior-de-saram
```

The runner should be healthy; the slot network should report `true isolated`. In LibreChat, send a short research query to Junior De Saram Pi, then a document query with an upload. A successful query creates `/data/users/<user-hash>/chats/<chat-hash>/` under `DS_HOST_DATA_ROOT`, with uploads, artifacts, workspace, and sessions. The bridge's trace is under `junior-de-saram/logs/traces/<date>/<request-id>/trace.json`; it records model, effort, usage, tool calls, source record IDs, template copies, the final answer, and errors. The catalog remains at `JUNIOR_DE_SARAM_WIKI_HOST_PATH/catalog.json`. The Pi container should be removed when the request finishes.

For an isolation check, use two LibreChat users and ask the second user to open a path from the first user's workspace. The tool must return `File not found in this chat.` Verify that a published file link opens until expiry and fails after changing its token or chat hash. Check that the Pi image has no provider keys or private catalog mount; check that the runner has a Docker socket but no provider keys. Run these checks on a nonproduction instance with test files.

Local code checks (do not start Docker services):

```bash
node --test junior-de-saram/test/hosted-security.test.mjs
```

`runsc` and Docker Desktop configuration determine whether the full hosted smoke test can run on the laptop. The unit tests verify the identity and file boundaries, Docker run arguments, model request restrictions, and token-bound gateway on Linux/WSL.

## Optional migration of one old chat

Use `junior-de-saram/deploy/migrate-legacy-chat.mjs` only after stopping the old instance. It derives the old conversation key from the **old** API key and LibreChat user/chat IDs, then copies that chat's uploads, workspace, and Pi session into the new layout. It rewrites paths and the session header in the new copy. It never edits the old volumes, firm database, source documents, or catalog. The old global artifact volume has no reliable user/chat ownership mapping and is deliberately not imported; publish needed files again from the retained workspace.

The tool defaults to a dry run. Supply `DS_MIGRATE_APPLY=1` only after checking its derived key, source availability, and destination. It refuses to overwrite a populated destination or to choose among multiple matching legacy sessions. Run the same test on a backup chat before a production migration. The `migration.test.mjs` fixture covers dry run, copying, path rewriting, old-file preservation, and overwrite refusal. Use read-only mounts for old volumes and no network for the one-shot process.

```bash
docker volume ls --format '{{.Name}}' | grep junior_de_saram
# Record the actual old volume names for sessions, uploads, and workspaces.
read -r -p 'LibreChat user ID: ' DS_MIGRATE_USER_ID
read -r -p 'LibreChat conversation ID: ' DS_MIGRATE_CHAT_ID
export DS_MIGRATE_USER_ID DS_MIGRATE_CHAT_ID
legacy_sessions='replace-with-old-sessions-volume'
legacy_uploads='replace-with-old-uploads-volume'
legacy_workspaces='replace-with-old-workspaces-volume'
data_root='/home/paralegaluser/app/junior-de-saram-data'
docker run --rm --network none --read-only --user 1000:1000 \
  --env-file .env -e DS_MIGRATE_USER_ID -e DS_MIGRATE_CHAT_ID \
  --mount "type=volume,src=$legacy_sessions,dst=/legacy/sessions,readonly" \
  --mount "type=volume,src=$legacy_uploads,dst=/legacy/uploads,readonly" \
  --mount "type=volume,src=$legacy_workspaces,dst=/legacy/workspaces,readonly" \
  --mount "type=bind,src=$data_root,dst=/data" \
  --entrypoint node junior-de-saram:local \
  junior-de-saram/deploy/migrate-legacy-chat.mjs
```

The script uses `JUNIOR_DE_SARAM_API_KEY` from `.env` as the old key. If that key was rotated, pass the earlier value as `DS_LEGACY_API_KEY` through a private environment variable. To apply, rerun the same `docker run` command with `-e DS_MIGRATE_APPLY=1` before `--mount`; then inspect the destination. Keep the old volumes after migration for rollback and audit.
