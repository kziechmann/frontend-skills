#!/usr/bin/env bash
# Copies an eval fixture site into the current directory (the eval workspace).
# Usage (from a case's scaffold.sh): bash <evals>/fixtures/_tools/stage-fixture.sh <fixture-name>
set -euo pipefail
name="${1:?fixture name required}"
tools="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$tools/../$name"
[ -d "$src" ] || { echo "unknown fixture: $name" >&2; exit 1; }
cp -R "$src/." .
if [ "$name" = "perf-site" ]; then
  node "$tools/generate-perf-assets.mjs" . >/dev/null
fi
