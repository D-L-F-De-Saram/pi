# Junior De Saram: two-server deployment plan

Status: information gathering. This file is a plan, not a configuration to apply unchanged. Do not deploy until the two servers' current proxy, Docker, LibreChat, and source-service settings have been checked. Keep every collected `.env` outside Git and do not paste its secret values into tickets or chat.

## Target and request flow

- **New server:** `desaram-com-prod-hetzner-desaramuser` hosts Junior De Saram's bridge, runner, and short-lived gVisor Pi containers. Its existing `desaram.com` site remains in place. An HTTPS `/agent/` location will proxy to the bridge on `127.0.0.1:8160`.
- **Existing server:** `desaram-ai-dev-hetzner-paralegaluser` continues to host LibreChat and the firm's research, drafting, Typesense, file, upload, and original-document services. Do not move or edit the firm's indexed data or originals as part of this deployment.
- LibreChat calls `https://desaram.com/agent/v1/...`; the new server's OpenResty (or the actual proxy found below) removes `/agent/` before forwarding to the bridge. The bridge launches Pi through the runner. The Pi sandbox reaches tools and models only through the bridge's token-bound gateway.
- The bridge reaches the old server's source services through a **verified private route**. Docker bridge networks are local to one Docker host, so the existing `librechat_default` and `docs-desaram-ai-network` names cannot connect these servers by themselves. Decide between a private host network and authenticated persistent SSH forwards after examining the servers. Never publish Typesense, the file server, or the original-DOCX source gateway solely to make this work.
- The user's browser fetches signed artifacts from `https://desaram.com/agent/artifacts/...`. Set `JUNIOR_DE_SARAM_PUBLIC_URL=https://desaram.com/agent`; verify that the proxy preserves artifact paths and query strings.

## Information bundle to supply

Put the following files in **one folder outside every Git checkout**, for example `D:\Intern\Work\deployment-input\junior-de-saram-2026-11-18\`. Keep the `.env` file private. Give me that folder's path; do not paste credentials in chat. If a proxy configuration uses `include` files, copy those with the same numbered prefix. Add `00-paths.txt` listing the hostname and original absolute path of each copied file.

| Filename in bundle | Source | Needed to determine |
| --- | --- | --- |
| `01-new-desaram-com-main.conf` | New server's active `desaram.com` virtual host | Correct `/agent/` placement, TLS, redirects, existing locations, and proxy type |
| `01-new-desaram-com-include-<name>.conf` | Any included snippets affecting that host | Location precedence and headers |
| `02-new-server-docker.txt` | New server | Docker version, runtime, socket group, networks, current containers, listening ports, resource headroom |
| `03-old-librechat.yaml` | Existing server's active LibreChat YAML | Endpoint name, file handling, model picker, headers, context settings |
| `04-old-librechat.env` | Existing server's active LibreChat `.env` | Variable presence and the shared endpoint key; handle as a secret |
| `05-old-librechat-main.conf` | Existing server's active LibreChat virtual host | Whether its file URLs can be fetched from the new server |
| `05-old-librechat-include-<name>.conf` | Any relevant includes | File-route, auth, and proxy behavior |
| `06-old-server-docker.txt` | Existing server | Exact source container names, ports, networks, and service health |
| `07-source-notes.txt` | Existing server | Original-DOCX gateway deployed or absent; read-only source route and authentication inventory; paths of any existing private catalog/wiki, without copying firm documents |
| `08-network-notes.txt` | Both servers | Private IP reachability or SSH-forward feasibility; domain DNS/TLS owner; old server outbound IP as seen by new server |

### Find the proxy files

Run these **read-only** commands on each server; use the new hostname for the `desaram.com` search and the old hostname for the active LibreChat domain:

```bash
command -v openresty || true
command -v nginx || true
systemctl is-active openresty nginx 2>/dev/null || true
sudo find /etc/openresty /usr/local/openresty/nginx/conf /etc/nginx -type f -name '*.conf' 2>/dev/null
sudo grep -RIl --include='*.conf' -E 'server_name[^;]*desaram\.com' \
  /etc/openresty /usr/local/openresty/nginx/conf /etc/nginx 2>/dev/null
```

On the old server, replace the last search pattern with the actual LibreChat hostname (look at its YAML or browser URL). If no file matches, check `docker ps` for a proxy container and `systemctl show -p ExecStart openresty nginx`. Copy the matching virtual-host file and every `include` it uses; record their original paths in `00-paths.txt`. Do not overwrite either server's live `.conf` while collecting information. For example, after finding the real paths, run `sudo cp /actual/path/to/site.conf "$HOME/01-new-desaram-com-main.conf"` on the new server or `sudo cp /actual/path/to/site.conf "$HOME/05-old-librechat-main.conf"` on the old one, then `sudo chown "$(id -un):$(id -gn)" "$HOME/<renamed-file>"` and `chmod 600 "$HOME/<renamed-file>"`. Use the same naming pattern for included snippets.

After preparing each server's numbered files in a private home-directory staging folder, transfer them to the laptop over the existing SSH aliases using `scp -r 'desaram-com-prod-hetzner-desaramuser:~/staging-folder/.' '<local-bundle-folder>/'` and the corresponding `desaram-ai-dev-hetzner-paralegaluser` alias. The `.env` crosses SSH only and remains outside Git. Remove the server-side staging copies after confirming the local bundle is complete.

### Gather Docker and service facts

On the **new** server, save the following output as `02-new-server-docker.txt` (no environment values):

```bash
hostname; id -u; stat -c 'docker-socket-gid=%g' /var/run/docker.sock
docker version --format '{{.Server.Version}}'; docker compose version
docker info --format 'runtimes={{json .Runtimes}} security-options={{json .SecurityOptions}}'
docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'
docker network ls; df -h /var/lib/docker; free -h
sudo ss -lntp
```

On the **old** server, save `docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'` and `docker network ls` as `06-old-server-docker.txt`. Include `docker inspect --format '{{.Name}} | {{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}' <container>` for LibreChat, research, drafter, Typesense, file server, and upload process. Record whether the original-DOCX source gateway is deployed and has `DRAFTING_SOURCE_TOKEN` configured; record **presence only**, not the value. Check where the actual `librechat.yaml` and `.env` used by the running container are mounted, then copy those exact files as `03` and `04`. Record the old server's relevant listening/egress paths in `08-network-notes.txt` without opening new ports.

## Work after reviewing the bundle

1. **Resolve the cross-host network path.** Prefer a private route if both hosts share an appropriate network. Otherwise adapt the existing `Connect-DeSaramSources.sh` forward pattern into a persistent, monitored service on the new host. Bind forwarded ports to loopback in the bridge's network namespace and reconnect after bridge recreation. Confirm research, drafter, Typesense, file server, and the optional original-DOCX gateway separately. Keep source credentials in the bridge's `.env`, never in the Pi image or runner. Do not assume the old server's container IPs remain stable.
2. **Adapt Compose for the new host.** The current Compose file requires an external `librechat_default` network on the same Docker host. Replace that dependency with a local edge network for bridge egress and OpenResty access; preserve the internal runner control and isolated per-slot networks. Keep the bridge's port bound to `127.0.0.1:8160` and the runner's port unpublished. Set a private absolute `DS_HOST_DATA_ROOT` and `JUNIOR_DE_SARAM_WIKI_HOST_PATH`, owned by the container UID. The new local wiki is only `catalog.json` metadata; initialize or copy it deliberately. Original DOCX and Markdown source files remain on the old server.
3. **Prepare gVisor on the new Docker host.** Check whether Docker advertises `runsc`. If absent, inspect `/etc/docker/daemon.json`, back it up, use the repository's checksum-verifying `install-gvisor.sh`, and test an ephemeral `--runtime=runsc` container. The script reloads Docker; schedule this around the new server's existing workloads. Never substitute ordinary Docker or local Pi process mode for a multi-user rollout.
4. **Create the new server's private `.env`.** Set provider and source credentials, `DS_IDENTITY_SECRET`, `DS_RUNNER_SECRET`, `JUNIOR_DE_SARAM_ARTIFACT_SECRET`, model allowlist, concurrency limits, source URLs, `JUNIOR_DE_SARAM_PUBLIC_URL=https://desaram.com/agent`, and the local host paths. Generate new independent secrets; preserve them across subsequent restarts. The old LibreChat endpoint key must match `JUNIOR_DE_SARAM_API_KEY` on the new bridge. If the original-DOCX source gateway and matching token are absent, catalog/Markdown drafting can work, but template copying cannot be claimed or tested.
5. **Add the `/agent/` location to the new server's actual virtual host.** Preserve all existing `desaram.com` routes and certificates. Strip only the `/agent/` prefix when forwarding to `127.0.0.1:8160`; keep query strings for signed downloads. Configure streaming without response buffering, a request size that accommodates the configured attachment limit, and timeouts covering `DS_RUN_TIMEOUT_MS`. Restrict `/agent/v1/` to the old LibreChat server's verified IP or private route when feasible; keep signed artifact links reachable by users. Check proxy order and test config before reload. Write the exact `.conf` only after reading `01-*`.
6. **Update the old server's LibreChat endpoint.** Point only Junior De Saram Pi's `baseURL` to `https://desaram.com/agent/v1`, preserve `resendFiles: false`, identity headers, model picker/defaults, and the endpoint's API key. Confirm the old server's frontend and backend use the same allowed model list. Determine the exact attachment URL shape LibreChat sends: the bridge accepts data URLs or URLs on `JUNIOR_DE_SARAM_ATTACHMENT_ORIGINS`, and `http://api:3080` on the old server is not resolvable on the new server. Provide an authenticated, reachable route or a narrowly scoped adaptation if required; test both upload modes without allowing arbitrary URLs.
7. **Build and verify in stages.** Build with cache the bridge, runner, and Pi image on the new host; start the two long-lived services; establish source connectivity; then validate `/health`, `runsc`, isolated slot networks, a simple greeting, research with citations, direct source retrieval, PDF/DOCX upload, sample drafting, original-template copying only if its gateway works, signed download/preview, token usage, and trace logging. Confirm temporary Pi containers are removed and other users cannot read another chat's files. Then recreate only the old LibreChat API if its YAML or `.env` changed. Preserve the old server's services and data throughout.
8. **Rollback.** Save the prior LibreChat YAML, `.env`, and new-server proxy file before editing. If the new endpoint fails, restore the old LibreChat endpoint settings and reload the tested proxy configuration; leave source services and databases untouched. Do not use `docker compose down -v` or remove the private data/catalog directories. Record new server image tags and secrets needed to keep existing sessions and artifact links valid.

## Current repository audit before the planned branch

As checked on 2026-11-18, the checkout is `feat/junior-de-saram-all-in-one-model`. There are modified and new security files but **no staged files**. `.env`, `junior-de-saram/private-wiki/`, and `junior-de-saram/logs/` are ignored and not tracked. `git diff --check` passed. A local pattern scan found no live-looking provider keys or private keys in the changed security code; its long secret strings are test fixtures. An existing upstream Google test contains a key-shaped fixture, and an upstream P2 test contains a private-key fixture; neither is part of this change. Recheck explicit staged paths and run a secret scanner before committing `feat/security-features`; never stage the private bundle, `.env`, wiki catalog, or traces.

## Reference documentation

- [Docker bridge networks](https://docs.docker.com/engine/network/drivers/bridge/) apply to one Docker host.
- [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) defines prefix replacement and buffering behavior used by OpenResty.
- [gVisor installation](https://gvisor.dev/docs/user_guide/install/) describes the `runsc` Docker runtime check.
