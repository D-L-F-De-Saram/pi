#!/bin/bash
# Start-up script for the Pi sandbox image (plan.md).
# It runs first in every Pi container: it checks the settings the runner passes, fills Pi's
# settings folder, makes this message's folder, then starts Pi in its place.
#
# Settings, all passed by the runner:
#   DS_RUN_TOKEN    this run's token, 64 hex characters. Pi sends it to the bridge as its key.
#   DS_GATEWAY_URL  the bridge on this container's own network: http://10.90.<slot>.2:<port>
#   DS_CHAT_ROOT    this chat's folder, /data/users/<user>/chats/<chat>, with its 4 folders mounted
#   DS_REQUEST_ID   this message's ID: chatcmpl-<uuid>
# If anything is wrong, it stops with exit code 64 before Pi starts. It never prints the token.
set -euo pipefail

SETTINGS=/run/pi-agent
SEED=/app/deploy/pi-agent-seed
PI_CLI=/app/packages/coding-agent/dist/bundle/cli.js
EXTENSIONS=/app/.pi/extensions

refuse() {
	echo "pi-entrypoint: $1. Pi was not started." >&2
	exit 64
}

# A folder that is really there, and not a link to somewhere else.
real_folder() {
	[[ -d "$1" && ! -L "$1" ]]
}

token_pattern='^[0-9a-f]{64}$'
octet='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
gateway_pattern="^http://10\.90\.${octet}\.2:([0-9]{1,5})$"
chat_pattern='^/data/users/[0-9a-f]{32}/chats/[0-9a-f]{32}$'
request_pattern='^chatcmpl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

[[ "${DS_RUN_TOKEN:-}" =~ $token_pattern ]] || refuse "DS_RUN_TOKEN is missing, or isn't a run token"
[[ "${DS_GATEWAY_URL:-}" =~ $gateway_pattern ]] || refuse "DS_GATEWAY_URL must be http://10.90.<slot>.2:<port>"
port="${BASH_REMATCH[2]}"
((10#$port >= 1 && 10#$port <= 65535)) || refuse "DS_GATEWAY_URL has no valid port"
[[ "${DS_CHAT_ROOT:-}" =~ $chat_pattern ]] || refuse "DS_CHAT_ROOT must be /data/users/<user>/chats/<chat>"
[[ "${DS_REQUEST_ID:-}" =~ $request_pattern ]] || refuse "DS_REQUEST_ID must be chatcmpl-<uuid>"

real_folder "$DS_CHAT_ROOT" || refuse "this chat's folder is missing"
for name in uploads artifacts workspace sessions; do
	real_folder "$DS_CHAT_ROOT/$name" || refuse "this chat's $name folder is missing"
done
[[ -w "$DS_CHAT_ROOT/workspace" && -w "$DS_CHAT_ROOT/sessions" ]] || refuse "this chat's workspace and sessions folders must be writable"

# Pi locks files in its settings folder for every model call, so it must be writable. It must
# also start empty: a fresh in-memory folder, never one shared with another run.
real_folder "$SETTINGS" && [[ -w "$SETTINGS" ]] || refuse "$SETTINGS must be a writable folder"
[[ -z "$(ls -A "$SETTINGS")" ]] || refuse "$SETTINGS must start empty"

cp "$SEED/settings.json" "$SEED/auth.json" "$SETTINGS/"
# The key is the text $DS_RUN_TOKEN, which Pi fills in from its environment for each call, so the
# token itself is never written to disk.
# Both providers point at the bridge, and Pi uses the one the runner names. The bridge's model proxy keeps
# every route but its own provider's closed.
printf '{"providers":{"anthropic":{"baseUrl":"%s/model/anthropic","apiKey":"$DS_RUN_TOKEN"},"google":{"baseUrl":"%s/model/google","apiKey":"$DS_RUN_TOKEN"}}}\n' "$DS_GATEWAY_URL" "$DS_GATEWAY_URL" > "$SETTINGS/models.json"

# This message's folder. A link planted here by an earlier run is refused, not followed.
requests="$DS_CHAT_ROOT/workspace/requests"
if [[ -e "$requests" || -L "$requests" ]]; then
	real_folder "$requests" || refuse "workspace/requests isn't a real folder"
else
	mkdir -m 700 "$requests"
fi
request="$requests/$DS_REQUEST_ID"
[[ ! -e "$request" && ! -L "$request" ]] || refuse "this message's folder already exists"
mkdir -m 700 "$request"

export PI_CODING_AGENT_DIR="$SETTINGS"
export PI_CODING_AGENT_SESSION_DIR="$DS_CHAT_ROOT/sessions"
export JUNIOR_DE_SARAM_WORKSPACE_ROOT="$request"
export JUNIOR_DE_SARAM_ACTIVE_WORKSPACE="$request"

# The 4 hosted extensions are named here, as the bridge names them today. The runner adds the
# rest: --mode json --approve --session-id ... --provider ... --model ...
exec node "$PI_CLI" \
	--no-context-files --no-skills \
	--skill /app/.agents/skills/de-saram-legal-final-answer/SKILL.md \
	--skill /app/.agents/skills/de-saram-source-retrieval/SKILL.md \
	--skill /app/.agents/skills/de-saram-legal-drafting/SKILL.md \
	--skill /app/.agents/skills/pdf/SKILL.md \
	--skill /app/.agents/skills/pptx/SKILL.md \
	--skill /app/.agents/skills/xlsx/SKILL.md \
	--skill /app/.agents/skills/docx/SKILL.md \
	--no-extensions --extension builtin:mcp \
	--extension "$EXTENSIONS/junior-de-saram-context.ts" \
	--extension "$EXTENSIONS/junior-de-saram-scope-guard.ts" \
	--extension "$EXTENSIONS/de-saram-delivery.ts" \
	"$@"
