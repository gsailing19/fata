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

SETTINGS_FILE="${FATA_SETTINGS_FILE:-}"
if [[ -z "$SETTINGS_FILE" && -f "$PWD/.claude/settings.local.json" ]]; then
  SETTINGS_FILE="$PWD/.claude/settings.local.json"
fi
if [[ -z "$SETTINGS_FILE" && -n "${BASH_SOURCE:-}" ]]; then
  SETTINGS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)/.claude/settings.local.json"
fi
if [[ -z "$SETTINGS_FILE" && -f "$HOME/.claude/settings.local.json" ]]; then
  SETTINGS_FILE="$HOME/.claude/settings.local.json"
fi

if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "load-secrets: warning: $SETTINGS_FILE not found" >&2
  return 0 2>/dev/null || exit 0
fi

NODE_HELPER="${FATA_LOAD_SECRETS_NODE:-}"
if [[ -z "$NODE_HELPER" && -f "$PWD/tools/load-secrets-node.js" ]]; then
  NODE_HELPER="$PWD/tools/load-secrets-node.js"
fi
if [[ -z "$NODE_HELPER" && -n "${BASH_SOURCE:-}" ]]; then
  NODE_HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)/load-secrets-node.js"
fi
if [[ -z "$NODE_HELPER" || ! -f "$NODE_HELPER" ]]; then
  echo "load-secrets: warning: load-secrets-node.js not found" >&2
  return 0 2>/dev/null || exit 0
fi

eval "$(node "$NODE_HELPER" "$SETTINGS_FILE")"
