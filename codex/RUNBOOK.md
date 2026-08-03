# fata 运行手册

> 最后更新：2026-08-03

## 本地验证

```bash
node tools/invariant-tests.js
node tools/algo-test.js --lang zh
node tools/algo-test.js --lang en
node --check config/worker.js
node tools/verify-local.js
```

## Worker 私有备份

```bash
./codex/backup-worker.sh
```

备份仓库：`codex/private-worker/`。每次生产改动前运行，不推公开仓库。

## 历史数据脱敏

```bash
FATA_HMAC_KEY=... node tools/sanitize-legacy-issues.js
```

该工具按 30 req/min 限速处理旧 `_kv<=3` 敏感 Issue，运行约 6 分钟。

## 每周回测

```bash
node tools/weekly-backtest.js
```

报告写入 `codex/backtests/YYYY-MM-DD.txt`。

## 只读审计

```bash
# 先快照
mkdir -p codex/snapshots/$(date +%F)
cp config/worker.js config/wrangler.toml config/algorithm-config.json config/changelog.md tools/audit.js tools/e2e-test.js codex/snapshots/$(date +%F)/
cd codex/snapshots/$(date +%F) && shasum -a 256 * > SNAPSHOT.sha256
```

然后按 `codex/AUDIT.md` 做静态审查和本地测试，不运行线上 E2E。

## 部署

```bash
# 前端 Pages
./deploy.sh

# Worker
cd config && npx wrangler deploy
```

## Secrets（不写值，只记录清单）

- `GITHUB_PAT`
- `RESEND_API_KEY`
- `SILICONFLOW_API_KEY`
- `HMAC_KEY`
- `ENCRYPTION_KEY`
- `ALLOWED_ORIGINS`（非敏感）

## 安全操作规则

- 不把 secrets 写入代码、快照、文档或日志。
- `tools/e2e-test.js` 会创建测试 Issue 并触发 Resend，只在需要验证匹配链路时运行。
- `tools/audit.js` 会执行 E2E 并清理 stale Issue，不作为只读审计的一部分。
- 生产 Worker 改动前必须先快照；能通过 `wrangler rollback` 回滚，但每次改动前仍保留本地副本。
- 本地快照目录 `codex/snapshots/` 不提交到公开仓库。

## 回滚

1. Worker：确认当前部署版本，使用 `cd config && npx wrangler rollback`；若不可用，则重新部署快照文件。
2. Pages：通过 deploy.sh 重新部署上一个已发布版本，或通过 Cloudflare Pages 历史部署回滚。
3. 回滚后必须跑只读验证，并记录到 `DECISIONS.md`。
