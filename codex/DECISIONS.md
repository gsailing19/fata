# fata 决策日志

> 最后更新：2026-08-03

## D-2026-08-03-01：Codex 项目框架升级到 v2

- 决策：以 `codex/` 为项目事实源，根 `AGENTS.md` 为 Codex 入口；历史研究报告不再作为当前架构依据。
- 原因：旧文档与 v3 代码存在代差，继续引用会误导修改。

## D-2026-08-03-02：先快照后改动

- 决策：所有生产代码改动前，先复制 gitignored Worker/配置到 `codex/snapshots/<date>/` 并记录校验和。
- 原因：`config/worker.js` 不在 git，直接改动没有回滚依据。

## D-2026-08-03-03：先修 E2E，再修主流程

- 决策：P0-2（真实 `/api/submit` E2E）必须先于 P0-1 修复；修复后必须用新 E2E 验证。
- 原因：现有 E2E 绕过真实链路，无法证明修复有效。

## D-2026-08-03-04：基线审计只读

- 决策：基线审计不运行 `e2e-test.js` 和 `audit.js`，不写线上数据。
- 原因：在验证基础设施修复前，线上测试脚本本身会制造数据并可能掩盖断链。

## D-2026-08-03-05：P0 修复已上线并通过 E2E

- 决策：修复 PoW 难度、`_kv4` 匹配读取、双邮件通知、close-match、撤回路径，并重写 E2E。
- 验证：`node tools/e2e-test.js` 14/14 通过；Worker 版本 `7337f5d0-141a-40d2-b63d-f2fc3e29f745`。
- 快照：`codex/snapshots/2026-08-03-final/`。

## D-2026-08-03-06：P1 处理完成

- 决策：完成私有 Worker 备份、历史 `_kv<=3` 脱敏、退订检查、旧模块清理和 beacon 计数修复。
- 验证：历史敏感字段 0；E2E 14/14；审计 11/12（唯一警告为 Cloudflare PV 峰值）。
- 备份：`codex/private-worker/` 本地 git 仓库 + `codex/backup-worker.sh`。

## D-2026-08-03-07：P2 基础设施建立

- 决策：新增 `tools/verify-local.js`、`.github/workflows/ci.yml`、`tools/weekly-backtest.js`、`codex/COLD-START.md`、`codex/COSTS.md`。
- 基线：zh F1 94.1%，en F1 80.0%，Spearman ρ 0.902。
- 限制：公开 CI 只跑本地测试，不跑线上 E2E，避免暴露密钥和污染线上池。

## D-2026-08-03-08：真实用户验证延期

- 决策：当前无真实用户，真人匹配回测从 P2 待办改为“延期等待外部触发”。
- 原因：该任务依赖真实流量和运营入口，不是代码阻塞项；工程侧继续推进算法、CI 和产品能力。
- 保留：`codex/COLD-START.md` 作为真实用户到来时的验证清单，不删除。
