#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$ROOT/codex/private-worker"

mkdir -p "$REPO"
cp "$ROOT/config/worker.js" "$REPO/"
cp "$ROOT/config/wrangler.toml" "$REPO/"
cp "$ROOT/config/algorithm-config.json" "$REPO/"
cp "$ROOT/config/changelog.md" "$REPO/"
cp "$ROOT/tools/audit.js" "$REPO/"
cp "$ROOT/tools/e2e-test.js" "$REPO/"
cp "$ROOT/tools/verify-local.js" "$REPO/"
cp "$ROOT/tools/weekly-backtest.js" "$REPO/"
cp "$ROOT/tools/match-core.js" "$REPO/"
cp "$ROOT/tools/invariant-tests.js" "$REPO/"
cp "$ROOT/tools/cost-ledger.js" "$REPO/"
cp "$ROOT/tools/load-secrets.sh" "$REPO/"
cp "$ROOT/tools/load-secrets-node.js" "$REPO/"
cp "$ROOT/index.html" "$REPO/"
mkdir -p "$REPO/modules"
cp "$ROOT"/modules/*.js "$REPO/modules/"
mkdir -p "$REPO/.github/workflows"
cp "$ROOT/.github/workflows/ci.yml" "$REPO/.github/workflows/"
cp "$ROOT/.github/workflows/e2e.yml" "$REPO/.github/workflows/"

cd "$REPO"
git add -A
if git diff --cached --quiet; then
  echo "no changes to backup"
else
  git commit -q -m "backup $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "backup committed"
fi
git log --oneline -1
