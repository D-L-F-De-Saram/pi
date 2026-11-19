# Junior De Saram: two-server deployment plan

> **Status update (2026-11-19):** Junior De Saram runs on `dev.desaram.com/agent`. LibreChat connects directly to the new HTTPS origin through `extra_hosts`. The original apex-host proposal below is historical. Use [Browser artifact delivery](#browser-artifact-delivery) for the signed download and preview rollout.

Status: information gathering. This file is a plan, not a configuration to apply unchanged. Do not deploy until the two servers' current proxy, Docker, LibreChat, and source-service settings have been checked. Keep every collected `.env` outside Git and do not paste its secret values into tickets or chat. On 2026-11-18, the new server's active OpenResty configuration had virtual hosts for `dev.desaram.com` and `cms.desaram.com`, but **no explicit `desaram.com` virtual host**. `/etc/openresty` is a symlink to `/usr/local/openresty/nginx/conf`; the two reported paths are the same files. Confirm the apex domain's actual origin, TLS certificate, and existing site owner before creating a new apex virtual host. Do not add `/agent/` to the dev or CMS host by assumption.

## Target and request flow

- **New server:** `desaram-com-prod-hetzner-desaramuser` hosts Junior De Saram's bridge, runner, and short-lived gVisor Pi containers. After confirming that `desaram.com` actually routes to this host, an HTTPS `/agent/` location in the correct apex virtual host will proxy to the bridge on `127.0.0.1:8160`. The currently loaded OpenResty files alone do not prove that the apex site is on this host.
- **Existing server:** `desaram-ai-dev-hetzner-paralegaluser` continues to host LibreChat and the firm's research, drafting, Typesense, file, upload, and original-document services. Do not move or edit the firm's indexed data or originals as part of this deployment.
- LibreChat calls `https://desaram.com/agent/v1/...`; the new server's OpenResty (or the actual proxy found below) removes `/agent/` before forwarding to the bridge. The bridge launches Pi through the runner. The Pi sandbox reaches tools and models only through the bridge's token-bound gateway.
- The bridge reaches the old server's source services through a **verified private route**. Docker bridge networks are local to one Docker host, so the existing `librechat_default` and `docs-desaram-ai-network` names cannot connect these servers by themselves. Decide between a private host network and authenticated persistent SSH forwards after examining the servers. Never publish Typesense, the file server, or the original-DOCX source gateway solely to make this work.
- The user's browser fetches signed artifacts from `https://desaram.com/agent/artifacts/...`. Set `JUNIOR_DE_SARAM_PUBLIC_URL=https://desaram.com/agent`; verify that the proxy preserves artifact paths and query strings.

## Information bundle to supply

Put the following files in **one folder outside every Git checkout**, for example `D:\Intern\Work\deployment-input\junior-de-saram-2026-11-18\`. Keep the `.env` file private. Give me that folder's path; do not paste credentials in chat. If a proxy configuration uses `include` files, copy those with the same numbered prefix. Add `00-paths.txt` listing the hostname and original absolute path of each copied file.

| Filename in bundle | Source | Needed to determine |
| --- | --- | --- |
| `01-new-openresty-nginx.conf` | New server's active OpenResty main config | Loaded include tree and default virtual host |
| `01-new-dev-desaram-com.conf`, `01-new-cms-desaram-com.conf` | The two currently loaded subdomain configs; one copy of each, from `/etc/openresty/conf.d/` | Existing conventions only; neither is the apex config |
| `01-new-desaram-com-main.conf` | The actual apex virtual host, **if found elsewhere** | Correct `/agent/` placement, TLS, redirects, existing locations |
| `01-new-desaram-com-include-<name>.conf` | Any included snippets affecting an apex host, if one exists | Location precedence and headers |
| `02-new-server-docker.txt` | New server | Docker version, runtime, socket group, networks, current containers, listening ports, resource headroom |
| `03-old-librechat.yaml` | Existing server's active LibreChat YAML | Endpoint name, file handling, model picker, headers, context settings |
| `04-old-librechat-env-presence.txt` | Existing server | Report only whether `JUNIOR_DE_SARAM_API_KEY` and `JUNIOR_DE_SARAM_ALLOWED_MODELS` exist and are nonempty; do not include their values |
| `05-old-librechat-main.conf` and relevant includes | Existing server, **only if needed after attachment URL inspection** | Whether its file URLs can be fetched from the new server |
| `06-old-server-docker.txt` | Existing server | Exact source container names, ports, networks, and service health |
| `07-source-notes.txt` | Existing server | Original-DOCX gateway deployed or absent; read-only source route and authentication inventory; paths of any existing private catalog/wiki, without copying firm documents |
| `08-network-notes.txt` | Both servers | Private IP reachability or SSH-forward feasibility; domain DNS/TLS owner; old server outbound IP as seen by new server |

### Find the proxy files

Run these **read-only** commands on the new server to find the loaded configuration and exact apex match:

```bash
command -v openresty || true
command -v nginx || true
systemctl is-active openresty nginx 2>/dev/null || true
sudo find /etc/openresty /usr/local/openresty/nginx/conf /etc/nginx -type f -name '*.conf' 2>/dev/null
sudo grep -RIl --include='*.conf' -E 'server_name[^;]*desaram\.com' \
  /etc/openresty /usr/local/openresty/nginx/conf /etc/nginx 2>/dev/null
sudo openresty -T 2>&1 | grep -E '^# configuration file|^[[:space:]]*server_name[[:space:]]'
```

The check above currently shows only `dev.desaram.com` and `cms.desaram.com`. Copy `/usr/local/openresty/nginx/conf/nginx.conf` as `01-new-openresty-nginx.conf` and one copy of each loaded subdomain file with the names in the table. Do not copy the `/etc/openresty/` aliases a second time. Ask the DNS/site administrator which origin receives apex `desaram.com` traffic and where its TLS certificate and site configuration live; record this in `08-network-notes.txt`. An apex `.conf` must be created or found only after that is confirmed. On the old server, provide just the active LibreChat YAML initially. Its proxy file is needed only if the observed upload URLs cannot be fetched from the new server. Copy any needed virtual-host file and its includes, record original paths in `00-paths.txt`, and do not overwrite live `.conf` while collecting. After copying a root-owned file into a private staging folder, set its owner to your user and mode to `600` before transfer.

After preparing each server's numbered files in a private home-directory staging folder, transfer them to the laptop over the existing SSH aliases using `scp -r 'desaram-com-prod-hetzner-desaramuser:~/staging-folder/.' '<local-bundle-folder>/'` and the corresponding `desaram-ai-dev-hetzner-paralegaluser` alias. No LibreChat `.env` values need to be copied for the initial review. Remove the server-side staging copies after confirming the local bundle is complete.

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

On the **old** server, save `docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'` and `docker network ls` as `06-old-server-docker.txt`. Include `docker inspect --format '{{.Name}} | {{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}' <container>` for LibreChat, research, drafter, Typesense, file server, and upload process. Record whether the original-DOCX source gateway is deployed and has `DRAFTING_SOURCE_TOKEN` configured; record **presence only**, not the value. Check where the active `librechat.yaml` is mounted and copy that file as `03`. For `04`, report variable **presence only**. Record the old server's relevant listening/egress paths in `08-network-notes.txt` without opening new ports.

## Work after reviewing the bundle

1. **Resolve the cross-host network path.** Prefer a private route if both hosts share an appropriate network. Otherwise adapt the existing `Connect-DeSaramSources.sh` forward pattern into a persistent, monitored service on the new host. Bind forwarded ports to loopback in the bridge's network namespace and reconnect after bridge recreation. Confirm research, drafter, Typesense, file server, and the optional original-DOCX gateway separately. Keep source credentials in the bridge's `.env`, never in the Pi image or runner. Do not assume the old server's container IPs remain stable.
2. **Adapt Compose for the new host.** The current Compose file requires an external `librechat_default` network on the same Docker host. Replace that dependency with a local edge network for bridge egress and OpenResty access; preserve the internal runner control and isolated per-slot networks. Keep the bridge's port bound to `127.0.0.1:8160` and the runner's port unpublished. Set a private absolute `DS_HOST_DATA_ROOT` and `JUNIOR_DE_SARAM_WIKI_HOST_PATH`, owned by the container UID. The new local wiki is only `catalog.json` metadata; initialize or copy it deliberately. Original DOCX and Markdown source files remain on the old server.
3. **Prepare gVisor on the new Docker host.** Check whether Docker advertises `runsc`. If absent, inspect `/etc/docker/daemon.json`, back it up, use the repository's checksum-verifying `install-gvisor.sh`, and test an ephemeral `--runtime=runsc` container. The script reloads Docker; schedule this around the new server's existing workloads. Never substitute ordinary Docker or local Pi process mode for a multi-user rollout.
4. **Create the new server's private `.env`.** Set provider and source credentials, `DS_IDENTITY_SECRET`, `DS_RUNNER_SECRET`, `JUNIOR_DE_SARAM_ARTIFACT_SECRET`, model allowlist, concurrency limits, source URLs, `JUNIOR_DE_SARAM_PUBLIC_URL=https://desaram.com/agent`, and the local host paths. Generate new independent secrets; preserve them across subsequent restarts. The old LibreChat endpoint key must match `JUNIOR_DE_SARAM_API_KEY` on the new bridge. If the original-DOCX source gateway and matching token are absent, catalog/Markdown drafting can work, but template copying cannot be claimed or tested.
5. **Confirm the apex origin, then add `/agent/` to the correct virtual host.** No explicit `desaram.com` host was loaded on the new server at the initial check. Determine whether the current apex site is on another origin, behind Cloudflare, or handled by a default server. Preserve all existing routes and certificates. Once the correct host is known, strip only `/agent/` when forwarding to `127.0.0.1:8160`; keep query strings for signed downloads. Configure streaming without response buffering, a request size that accommodates the configured attachment limit, and timeouts covering `DS_RUN_TIMEOUT_MS`. Restrict `/agent/v1/` to the old LibreChat server's verified IP or private route when feasible; keep signed artifact links reachable by users. Check proxy order and test config before reload. Never put the apex route in the `dev.` or `cms.` file merely because those are currently present.
6. **Update the old server's LibreChat endpoint.** The initial input can be only the active `librechat.yaml`. Point only Junior De Saram Pi's `baseURL` to `https://desaram.com/agent/v1`, preserve `resendFiles: false`, identity headers, model picker/defaults, and the endpoint's API key. If LibreChat already has the required API-key and model-allowlist variables, this is a YAML-only change; otherwise those variables must be added privately to its `.env`, without sending their values in the information bundle. Determine the exact attachment URL shape LibreChat sends: the bridge accepts data URLs or URLs on `JUNIOR_DE_SARAM_ATTACHMENT_ORIGINS`, and `http://api:3080` on the old server is not resolvable on the new server. Provide an authenticated, reachable route or a narrowly scoped adaptation if required; test both upload modes without allowing arbitrary URLs. Inspect the old proxy config only if that file route requires it.
7. **Build and verify in stages.** Build with cache the bridge, runner, and Pi image on the new host; start the two long-lived services; establish source connectivity; then validate `/health`, `runsc`, isolated slot networks, a simple greeting, research with citations, direct source retrieval, PDF/DOCX upload, sample drafting, original-template copying only if its gateway works, signed download/preview, token usage, and trace logging. Confirm temporary Pi containers are removed and other users cannot read another chat's files. Then recreate only the old LibreChat API if its YAML or `.env` changed. Preserve the old server's services and data throughout.
8. **Rollback.** Save the prior LibreChat YAML, `.env`, and new-server proxy file before editing. If the new endpoint fails, restore the old LibreChat endpoint settings and reload the tested proxy configuration; leave source services and databases untouched. Do not use `docker compose down -v` or remove the private data/catalog directories. Record new server image tags and secrets needed to keep existing sessions and artifact links valid.

## Current repository audit before the planned branch

As checked on 2026-11-18, `feat/security-features` on the fork points to commit `5d9980d3315d1d2293f94bf872dec6af13eb4451`, which contains the hosted security implementation and deployment docs. `.env`, `junior-de-saram/private-wiki/`, and `junior-de-saram/logs/` are ignored and not tracked. The committed `.env.example` has empty credential fields, and the committed Pi seed JSON files have no credentials. A local pattern scan found no live-looking provider keys or private keys in the changed security code; its long secret strings are test fixtures. An existing upstream Google test contains a key-shaped fixture, and an upstream P2 test contains a private-key fixture; neither is part of this change. **Two local tests are still untracked and absent from the pushed commit:** `junior-de-saram/test/hosted-security.test.mjs` and `junior-de-saram/test/migration.test.mjs`. Both pass locally (six subtests total), but the deployment guide's test command will fail in a fresh clone until these test files are committed and pushed. This plan has also been updated locally after that push to reflect the actual proxy findings; include its update in a follow-up commit. Run a final staged-file secret scan before pushing more files; never stage the private bundle, `.env`, wiki catalog, or traces.

## Browser artifact delivery

The browser can reach LibreChat on `https://dev.desaram.ai`. Requests to the public `https://dev.desaram.com/agent/` route loop, while direct HTTPS to the new origin works. The old server can stream signed artifacts from that origin using [the OpenResty include](deploy/openresty/junior-de-saram-artifacts.conf). The include covers the bridge's current `/agent/artifacts/` downloads and preview images. The bridge verifies each signature and its expiry.

1. On the old server, find the active HTTPS virtual host for `dev.desaram.ai` using `sudo openresty -T`. Back up its configuration. Install the include in `/etc/openresty/snippets/junior-de-saram-artifacts.conf` and add `include /etc/openresty/snippets/junior-de-saram-artifacts.conf;` inside that HTTPS `server` block alongside the existing locations. Keep any HTTP redirect block separate.
2. From the old server, verify direct TLS with `curl --resolve dev.desaram.com:443:89.167.101.222 https://dev.desaram.com/agent/health`. Expect HTTP 200. If the agent origin IP changes, update the proxy target and LibreChat's existing `extra_hosts` entry. Verify the certificate without disabling TLS checks.
3. Run `sudo openresty -t && sudo systemctl reload openresty` on the old server. In a browser, take a valid signed test download and replace only `dev.desaram.com` with `dev.desaram.ai`. Keep the full path and expiry query. Confirm it downloads, then change one character in the signature and expect HTTP 404.
4. On the new server, back up the private `.env` and set `JUNIOR_DE_SARAM_PUBLIC_URL=https://dev.desaram.ai/agent`. Preserve the signing secret. Run `docker compose up -d --no-deps --no-build --force-recreate junior-de-saram`. Reconnect the deployed SSH source forwards using the same command or service used for the original deployment. The forwards live in the bridge's network namespace, which changes during recreation.
5. In LibreChat, generate a new PPTX and DOCX and verify the download and preview in the browser. Run a sourced research query to confirm the SSH forwards are back. Historical chat messages retain their stored URLs. As long as the file and signature are still valid, replacing the hostname in one of those links can recover it.

For the manually deployed source tunnel, run this on the new server immediately after recreating the bridge. The command uses the existing SSH key and verified host key.

```bash
bridge_pid=$(docker inspect -f '{{.State.Pid}}' junior-de-saram)
sudo nsenter -t "$bridge_pid" -n runuser -u desaramuser -- \
  ssh -i /home/desaramuser/.ssh/junior_de_saram_sources \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=2 \
  -f -N \
  -L 127.0.0.1:18124:127.0.0.1:8123 \
  -L 127.0.0.1:18108:127.0.0.1:8108 \
  -L 127.0.0.1:19125:127.0.0.1:9124 \
  paralegaluser@46.224.219.108
```

Rollback by restoring the previous `.env`, recreating the bridge, and reconnecting its source forwards. Remove the include from the old virtual host and validate the configuration before reloading.

## Reference documentation

- [Docker bridge networks](https://docs.docker.com/engine/network/drivers/bridge/) apply to one Docker host.
- [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) defines prefix replacement and buffering behavior used by OpenResty.
- [gVisor installation](https://gvisor.dev/docs/user_guide/install/) describes the `runsc` Docker runtime check.
