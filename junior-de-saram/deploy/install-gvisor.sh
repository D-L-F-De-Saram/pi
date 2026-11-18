#!/usr/bin/env bash
# Install a pinned gVisor (runsc) release and register it with Docker.
#
#   sudo bash junior-de-saram/deploy/install-gvisor.sh <release> [folder-with-downloaded-files]
#   sudo bash junior-de-saram/deploy/install-gvisor.sh 20261026.0
#
# Pass a folder when the archive and its .sha512 file are already downloaded.
# Uses zstd when available, otherwise the official bzip2 archive. The checksum
# is always verified. See SECURITY_DEPLOYMENT.md.
set -euo pipefail

release="${1:-}"
local_dir="${2:-}"

if [[ ! "$release" =~ ^[0-9]{8}(\.[0-9]+)?$ ]]; then
	echo "Usage: sudo bash $0 <release, e.g. 20261026.0> [folder-with-downloaded-files]" >&2
	exit 2
fi
if [[ "$(id -u)" != "0" ]]; then
	echo "Run this with sudo." >&2
	exit 1
fi
for tool in curl sha512sum tar docker dockerd systemctl; do
	command -v "$tool" >/dev/null || { echo "Missing $tool. Nothing was changed." >&2; exit 1; }
done

# Name, start time and restart count of every running container.
container_starts() {
	docker ps -q | xargs -r docker inspect -f '{{.Name}} {{.State.StartedAt}} {{.RestartCount}}' | sort
}

arch="$(uname -m)"
url="https://storage.googleapis.com/gvisor/releases/release/${release}/${arch}"
if command -v zstd >/dev/null; then archive=gvisor.tar.zstd; else archive=gvisor.tar.bz2; fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

if [[ -n "$local_dir" ]]; then
	echo "Using downloaded files from $local_dir"
	cp "$local_dir/$archive" "$local_dir/$archive.sha512" .
else
	echo "Downloading gVisor $release for $arch (about 58 MB)"
	curl -fsSL --retry 8 --retry-delay 5 --retry-all-errors -O "$url/$archive"
	curl -fsSL --retry 8 --retry-delay 5 --retry-all-errors -O "$url/$archive.sha512"
fi
sha512sum -c "$archive.sha512"

echo "Containers before install:"
docker ps --format '  {{.Names}}: {{.Status}}'
starts_before="$(container_starts)"

if [[ "$archive" == *.zstd ]]; then tar --zstd -xf "$archive" -C /usr/local/bin; else tar -xjf "$archive" -C /usr/local/bin; fi
chmod a+rx /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1
if [[ -d /usr/local/bin/gvisor-bin ]]; then
	chmod -R a+rX /usr/local/bin/gvisor-bin
fi

config=/etc/docker/daemon.json
backup=""
if [[ -e "$config" ]]; then
	backup="$config.before-gvisor-$(date +%Y%m%d-%H%M%S)"
	cp -p "$config" "$backup"
	echo "Saved Docker's settings to $backup"
else
	echo "$config does not exist yet, so runsc install will create it."
fi

put_settings_back() {
	if [[ -n "$backup" ]]; then cp -p "$backup" "$config"; else rm -f "$config"; fi
}

# Some Docker installations leave a zero-length or whitespace-only daemon.json.
# Treat it as the empty object before asking runsc to add its runtime entry.
if [[ ! -s "$config" ]] || ! grep -q '[^[:space:]]' "$config"; then
	printf '{}\n' > "$config"
fi
if ! /usr/local/bin/runsc install; then
	put_settings_back
	echo "runsc could not update Docker's settings. The old file is back." >&2
	exit 1
fi
if ! dockerd --validate --config-file "$config"; then
	put_settings_back
	echo "The new settings file failed Docker's check. The old file is back, and Docker was not reloaded." >&2
	exit 1
fi
if [[ -n "$backup" ]]; then
	echo "Change to Docker's settings:"
	diff "$backup" "$config" || true
fi

# The gVisor install guide uses reload, which does not restart containers.
systemctl reload docker

for attempt in 1 2 3 4 5; do
	if docker info --format '{{json .Runtimes}}' | grep -q '"runsc"'; then
		break
	fi
	if [[ "$attempt" == "5" ]]; then
		echo "runsc is not registered after the reload." >&2
		echo "Nothing else was changed. A restart would stop running containers, so decide before running: sudo systemctl restart docker" >&2
		exit 1
	fi
	sleep 2
done

echo "Containers after install:"
docker ps --format '  {{.Names}}: {{.Status}}'
if [[ "$(container_starts)" == "$starts_before" ]]; then
	echo "PASS: every container has the same start time and restart count as before"
else
	echo "WARNING: a container changed during the install:"
	diff <(printf '%s\n' "$starts_before") <(container_starts) || true
fi

echo "To undo this install:"
if [[ -n "$backup" ]]; then echo "  sudo cp -p $backup $config"; else echo "  sudo rm $config"; fi
echo "  sudo systemctl reload docker"
echo "  sudo rm -rf /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1 /usr/local/bin/gvisor-bin"

/usr/local/bin/runsc --version
# An image already on this machine, so a shared server gains nothing new.
if docker image inspect junior-de-saram:local >/dev/null 2>&1; then
	sandbox_kernel="$(docker run --rm --runtime=runsc --network none --entrypoint uname junior-de-saram:local -r)"
	if [[ -z "$sandbox_kernel" || "$sandbox_kernel" == "$(uname -r)" ]]; then
		echo "FAIL: the test container did not run under gVisor (kernel: '$sandbox_kernel')" >&2
		exit 1
	fi
	echo "PASS: a container ran under runsc. Sandbox kernel $sandbox_kernel, host $(uname -r)"
else
	docker run --rm --runtime=runsc --network none hello-world | grep -q 'Hello from Docker' && echo "PASS: hello-world ran under runsc"
fi
