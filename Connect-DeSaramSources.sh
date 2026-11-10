#!/usr/bin/env sh
# Local development: host SSH credentials stay on the host; forwards bind only
# to loopback in the running Junior De Saram container's network namespace.
set -eu
container_pid=$(docker inspect -f '{{.State.Pid}}' junior-de-saram)
test "$container_pid" -gt 0
ssh_user=${1:-${SUDO_USER:-$(id -un)}}
mode=${2:-}
ssh_alias=${DESARAM_SSH_ALIAS:-desaram-ai-dev-hetzner-paralegaluser}
if [ "$(id -u)" -ne 0 ]; then exec sudo sh "$0" "$ssh_user" "$mode"; fi
if [ "$mode" = '--watch' ]; then
  while docker inspect -f '{{.State.Running}}' junior-de-saram 2>/dev/null | grep -q true; do
    sh "$0" "$ssh_user" --once >/dev/null 2>&1 || true
    sleep 20
  done
  exit 0
fi
start_watchdog() {
  [ "$mode" = '--once' ] && return
  pid_file=/tmp/junior-de-saram-source-watch.pid
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then return; fi
  nohup sh "$0" "$ssh_user" --watch >/tmp/junior-de-saram-source-watch.log 2>&1 </dev/null &
  printf '%s\n' "$!" > "$pid_file"
}
set -- -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=2
needed=0
for mapping in 18108:127.0.0.1:8108 18124:127.0.0.1:8123 19125:127.0.0.1:9124; do
  port=${mapping%%:*}
  if ! nsenter -t "$container_pid" -n ss -ltn | grep -q "127.0.0.1:$port "; then
    set -- "$@" -L "127.0.0.1:$mapping"
    needed=1
  fi
done
if ! nsenter -t "$container_pid" -n ss -ltn | grep -q '127.0.0.1:17008 '; then
  file_container=$(runuser -u "$ssh_user" -- ssh -o BatchMode=yes "$ssh_alias" "docker ps --filter 'name=docs-desaram-ai-files' --format '{{.ID}}' | head -n 1")
  test -n "$file_container"
  file_ip=$(runuser -u "$ssh_user" -- ssh -o BatchMode=yes "$ssh_alias" "docker inspect $file_container --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'" | awk '{print $1}')
  test -n "$file_ip"
  set -- "$@" -L "127.0.0.1:17008:$file_ip:7008"
  needed=1
fi
if [ "$needed" -eq 0 ]; then start_watchdog; printf '%s\n' 'De Saram service forwards are already connected.'; exit 0; fi
nsenter -t "$container_pid" -n runuser -u "$ssh_user" -- ssh "$@" "$ssh_alias"
start_watchdog
printf '%s\n' 'Loopback-only De Saram source forwards connected. Reconnect after container recreation.'
