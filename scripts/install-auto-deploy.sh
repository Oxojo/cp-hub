#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID != 0 ]]; then
  echo 'Run with sudo: sudo bash scripts/install-auto-deploy.sh' >&2
  exit 1
fi
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
owner="$(stat -c '%U' "$root")"
case "$root" in *[!a-zA-Z0-9_./-]*) echo 'Install path must contain only letters, digits, underscores, dots, slashes and hyphens.' >&2; exit 1;; esac
case "$owner" in ''|*[!a-zA-Z0-9_-]*) echo 'Unsupported checkout owner.' >&2; exit 1;; esac
test -f "$root/.env" || { echo 'Configure .env first.' >&2; exit 1; }
for tool in systemctl git docker curl flock timeout; do command -v "$tool" >/dev/null; done
getent group docker >/dev/null || { echo 'The docker group is missing; install Docker Engine first.' >&2; exit 1; }
docker compose version
if [[ ${1:-} == --check ]]; then
  printf 'Ready: checkout=%s service-user=%s\n' "$root" "$owner"
  exit 0
fi
[[ $# == 0 ]] || { echo 'Only --check is supported.' >&2; exit 1; }
printf 'Installing deployment timer for %s as %s (Docker access for this service).\n' "$root" "$owner"
cat > /etc/systemd/system/cp-hub-deploy.service <<EOF
[Unit]
Description=Update CP Hub from GitHub main
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$owner
SupplementaryGroups=docker
WorkingDirectory=$root
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/bash $root/scripts/deploy-main.sh
TimeoutStartSec=20min
UMask=0077
EOF
cat > /etc/systemd/system/cp-hub-deploy.timer <<'EOF'
[Unit]
Description=Check CP Hub main every minute

[Timer]
OnActiveSec=15s
OnUnitInactiveSec=60s
RandomizedDelaySec=10s
AccuracySec=1s
Unit=cp-hub-deploy.service

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now cp-hub-deploy.timer
echo 'Installed. First check starts in about 15 seconds.'
echo 'Logs: sudo journalctl -u cp-hub-deploy.service -n 100 --no-pager'
