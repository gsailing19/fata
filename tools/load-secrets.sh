#!/usr/bin/env bash
#
# fata 统一密钥加载入口。
#
# 使用方式（必须在当前 shell 中 source，export 才会保留）：
#   source tools/load-secrets.sh
#
# 加载顺序：
#   1. 先 source ~/.codex/secrets.env（权限 600），作为基础层。
#   2. 再补读 .claude/settings.local.json 的 env 中尚未设置的键，
#      不覆盖当前 shell 已存在的环境变量。
#
# 本脚本不打印任何密钥值。

if [[ -n "${BASH_SOURCE:-}" && "${BASH_SOURCE:-}" == "$0" ]]; then
  echo "load-secrets: 请用 source tools/load-secrets.sh 加载，直接执行不会保留环境变量" >&2
  exit 1
fi

set -a
if [[ -f "$HOME/.codex/secrets.env" ]]; then
  source "$HOME/.codex/secrets.env"
else
  echo "load-secrets: warning: $HOME/.codex/secrets.env not found" >&2
fi
set +a

if [[ -n "${BASH_SOURCE:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  SCRIPT_DIR="$PWD"
fi

SETTINGS_FILE="${FATA_SETTINGS_FILE:-$SCRIPT_DIR/../.claude/settings.local.json}"

if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "load-secrets: warning: $SETTINGS_FILE not found" >&2
  return 0 2>/dev/null || exit 0
fi

while IFS= read -r -d '' key; do
  IFS= read -r -d '' value
  if [[ -z "${!key:-}" ]]; then
    export "$key=$value"
  fi
done < <(node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const env = data.env || {};
  for (const [key, value] of Object.entries(env)) {
    process.stdout.write(key + "\0" + String(value) + "\0");
  }
' "$SETTINGS_FILE")
