#!/usr/bin/env bash
set -euo pipefail
cd /opt/schedule_surgery
image="${1:?Supply immutable webapp image}"
[[ "$image" =~ ^ghcr\.io/aschroedermd/schedule_surgery:sha-[a-f0-9]{40}$ ]] || exit 2
exec 9>.webapp-deploy.lock
flock 9
compose() { PLANNER_IMAGE="$1" docker compose --env-file .env.production -f docker-compose.production.yml "${@:2}"; }
previous="$(docker inspect --format '{{.Config.Image}}' "$(compose "$image" ps -q app)" 2>/dev/null || true)"
rollback() { if [[ -n "$previous" ]]; then compose "$previous" up -d --no-deps app; fi; }
compose "$image" pull app
if ! compose "$image" up -d app caddy; then rollback; exit 1; fi
for attempt in {1..30}; do
  id="$(compose "$image" ps -q app)"
  if [[ -n "$id" ]] && [[ "$(docker inspect --format '{{.State.Health.Status}}' "$id")" == healthy ]]; then
    if ! compose "$image" exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then rollback; exit 1; fi
    printf 'PLANNER_IMAGE=%s\n' "$image" > webapp-release.env.tmp
    mv webapp-release.env.tmp webapp-release.env
    repository="${image%:*}"
    while read -r tag; do
      if [[ "$tag" =~ :sha-[a-f0-9]{40}$ ]] && [[ "$tag" != "$image" ]] && [[ "$tag" != "$previous" ]]; then
        docker image rm "$tag" >/dev/null 2>&1 || true
      fi
    done < <(docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}')
    echo "Webapp deployed: $image"
    exit 0
  fi
  sleep 3
done
rollback
exit 1
