#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
base_compose="$repository_root/compose.sync-proof.yml"
browser_compose="$repository_root/compose.browser-proof.yml"

docker compose -f "$base_compose" -f "$browser_compose" down --volumes --remove-orphans
docker compose -f "$base_compose" -f "$browser_compose" up --build coordination-proof
