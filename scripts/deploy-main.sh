#!/usr/bin/env bash
set -Eeuo pipefail

# Load the complete function before Git updates this script on disk.
main() {
  export GIT_TERMINAL_PROMPT=0
  umask 077
  local root target current deployed running backup body
  root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
  cd "$root"
  for tool in git docker curl flock timeout; do
    command -v "$tool" >/dev/null || { echo "Missing required command: $tool" >&2; return 1; }
  done
  test -f .env || { echo 'Missing .env; configure the VPS first.' >&2; return 1; }
  test "$(git rev-parse --show-toplevel)" = "$root" || { echo 'Not the expected Git checkout.' >&2; return 1; }
  test "$(git branch --show-current)" = main || { echo 'Checkout must be on main.' >&2; return 1; }
  case "$(git remote get-url origin)" in
    https://github.com/Oxojo/cp-hub|https://github.com/Oxojo/cp-hub.git) ;;
    *) echo 'origin must point to https://github.com/Oxojo/cp-hub.git' >&2; return 1 ;;
  esac
  mkdir -p .deploy/backups
  chmod 700 .deploy .deploy/backups
  exec 9>.deploy/lock
  flock -n 9 || { echo 'Another deployment is running; skipping.'; return 0; }
  trap 'echo "Deployment failed near line $LINENO. See journalctl -u cp-hub-deploy.service" >&2' ERR
  git diff --quiet && git diff --cached --quiet || { echo 'Tracked local edits found. Commit or reconcile them before deploying.' >&2; return 1; }
  timeout 120 git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
  target="$(git rev-parse refs/remotes/origin/main)"
  current="$(git rev-parse HEAD)"
  deployed="$(cat .deploy/deployed-sha 2>/dev/null || true)"
  if [[ "$current" = "$target" && "$deployed" = "$target" ]]; then
    body="$(curl --silent --show-error --fail --max-time 5 http://127.0.0.1:4173/api/health || true)"
    if [[ "$body" = *'"ok":true'* && "$body" = *'"storage":"postgres"'* ]]; then
      echo "Already deployed: $target"
      return 0
    fi
    echo 'Health check failed; attempting to recover the current version.'
  fi
  git merge-base --is-ancestor "$current" "$target" || { echo 'main is not a fast-forward. Resolve local/remote history manually.' >&2; return 1; }
  git merge --ff-only "$target"
  test "$(git rev-parse HEAD)" = "$target"
  docker compose config --quiet
  echo "Building and testing $target"
  docker compose build web
  docker compose run --rm --no-deps web npm run check
  # Tests use a writable temporary working directory, not /app owned by root.
  docker compose run --rm --no-deps --workdir /tmp web node --test '/app/test/*.test.mjs'
  running="$(docker compose ps --status running --services)"
  if [[ $'\n'"$running"$'\n' = *$'\ndb\n'* ]]; then
    backup=".deploy/backups/$(date -u +%Y%m%dT%H%M%SZ)-${target:0:12}.sql"
    echo 'Backing up PostgreSQL before changing containers.'
    docker compose exec -T db pg_dump -U cphub -d cphub > "$backup.partial"
    test -s "$backup.partial"
    mv -- "$backup.partial" "$backup"
  else
    echo 'Database is not running; no pre-deployment dump can be made.'
  fi
  # Never remove volumes. Only the web container is force-recreated.
  docker compose up -d --wait --wait-timeout 120 db
  docker compose up -d --no-deps --no-build --force-recreate web
  local attempt
  for attempt in {1..30}; do
    body="$(curl --silent --show-error --fail --max-time 5 http://127.0.0.1:4173/api/health || true)"
    if [[ "$body" = *'"ok":true'* && "$body" = *'"storage":"postgres"'* ]]; then
      printf '%s\n' "$target" > .deploy/deployed-sha.tmp
      mv -- .deploy/deployed-sha.tmp .deploy/deployed-sha
      echo "Deployment succeeded: $target"
      return 0
    fi
    sleep 2
  done
  echo 'Post-deployment health check failed. No success marker was written; next timer tick will retry.' >&2
  return 1
}

main "$@"
