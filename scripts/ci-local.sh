#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

bun install --frozen-lockfile
bun test --timeout 30000
bun run typecheck
