# fata 任务看板

> 最后更新：2026-08-07。状态：`[ ]` 待办 / `[~]` 进行中 / `[x]` 已完成。

## 框架与基线（2026-08-03）

- `[x]` v2 框架：AUDIT / RISKS / METRICS / RUNBOOK / DECISIONS 已建立。
- `[x]` 只读快照：`codex/snapshots/2026-08-03/` 已保存 Worker 与关键配置。
- `[x]` 只读基线审计：`codex/audit/2026-08-03-baseline.md` 已产出。
- `[x]` 修复 E2E 盲区（P0-2），真实链路 E2E 14/14 通过。
- `[x]` 修复后快照：`codex/snapshots/2026-08-03-final/`。

## 目标人群与定位（2026-08-03）

- `[x]` 多轮研究海外深夜文字人群，产出候选定义：`codex/AUDIENCE.md`。
- `[x]` 采访确认 v1 人群决策（8 项，见 `codex/AUDIENCE.md`）。
- `[x]` 把英文定位与首页/Onboarding 文案改造成 “2 a.m.” 叙事（index.html + about.html + README）。
- `[x]` 2026-08-04：推送 main 并部署线上（Pages + Worker，Worker 版本 `80431684-9950-4abc-9895-0b1eadc2155f`）。
- `[x]` 把醒着原因标签与 3 小时时区窗口接入匹配特征（涉及 Worker，E2E 15/15 验证）。
- `[x]` Worker 自动匹配通知邮件改成 2 a.m. 信笺文案（中英邮件与前端 mailto 兜底同步）。
- `[x]` 移除匹配引擎 `_kv<=3` 历史兼容读取（`findMatchInPool` 与旧邮件重试分支）。
- `[x]` `select_reason` 原因标签接入 beacon 存储与审计统计。
- `[ ]` 用真实用户数据验证细分人群优先级，淘汰无效子人群。

## P0 — 必须先修

### P0-1 接通匹配成功后的 close-match + 邮件通知

- 状态：`[x]` 已完成（E2E 验证）
- 问题：`/api/submit` 返回匹配结果，但 Worker 不关闭双方 Issue、不创建 Match Issue、不发 Resend 通知；`handleCloseMatch` 和前端 `closeMatchedIssues()` 都没有被调用。
- 文件：`index.html`、`config/worker.js`、`modules/resend-retry.js`
- 验收：两个用户走 `/api/submit` 完成匹配后，双方 Issue 关闭、Match Issue 创建、双方各收到一封指向对方的通知邮件、KV 数据清理。

### P0-2 让 E2E 覆盖真实 `/api/submit` 链路

- 状态：`[x]` 已完成（E2E 14/14）
- 问题：`tools/e2e-test.js` 手动创建/关闭 Issue 并单独测 Resend，绕过了真实提交与匹配路径，无法发现 P0-1。
- 文件：`tools/e2e-test.js`
- 验收：E2E 使用测试标记走 `/api/submit`，断言匹配、close、通知、清理全部发生。

### P0-3 修复 PoW 难度不一致

- 状态：`[x]` 已完成（E2E 验证）
- 问题：`/api/bootstrap` 下发 14 位，`/api/challenge` 校验 16 位，真实提交大概率 `pow_invalid`。
- 文件：`config/worker.js:507`、`config/worker.js:526`、`modules/pow-solver.js`
- 验收：浏览器端用服务端下发的难度求解后，`/api/challenge` 稳定返回 submit token。

### P0-4 用户撤回改走 `/api/withdraw`

- 状态：`[x]` 已完成（E2E 验证）
- 问题：前端用 token PATCH `/api/github/issues/{n}`，被 Worker 的“token 只读代理”拒绝。
- 文件：`index.html:1593`、`config/worker.js:1207`
- 验收：回访用户撤回 pending 文字后，Issue 关闭且 KV 清理。

### P0-5 修复 close-match 邮件逻辑

- 状态：`[x]` 已完成（E2E 验证）
- 问题：`handleCloseMatch` 只解密并发送一方邮箱，且邮件内容指向收件人自己的邮箱。
- 文件：`config/worker.js:1116`、`config/worker.js:1139`
- 验收：两封独立通知邮件，各自内容指向对方邮箱。

## P1 — 架构与运维健康

### P1-1 给 Worker 源码建立版本管理/备份方案

- 状态：`[x]` 已完成（本地私有 git + `codex/backup-worker.sh`）
- 问题：`config/worker.js`、`wrangler.toml` 被 gitignore，线上 Worker 与仓库脱节。
- 方案：私有备份仓库、受保护的内部 git 分支，或重新评估“护城河”策略。

### P1-2 清理旧架构残留

- 状态：`[x]` 已完成（删除 `resend-retry.js`、`llm-fallback.js`、`model-loader.js`，精简 `match-engine.js`）
- 内容：清理或标注 `worker.fata.uk`、`HMAC_KEY_RAW`、未使用的 `ResendRetry` 路径，避免误导。
- 文件：`modules/match-engine.js`、`modules/resend-retry.js`、`modules/llm-fallback.js`

### P1-3 退订检查接入邮件发送

- 状态：`[x]` 已完成（主通知路径和 `/api/resend/send` 旧代理均检查退订）
- 内容：`/api/resend/send` 发送前检查 `UNSUBSCRIBE_KV`。
- 文件：`config/worker.js`、`ideas-todo.md`

### P1-4 调查漏斗埋点偏差

- 状态：`[x]` 已完成（beacon 改为唯一 key + 前缀统计；Cloudflare PV 仍可能包含无 JS 流量）
- 现象：Cloudflare 统计 2026-08-01 有 73 PV，KV beacon 只有 1 次 `page_view`。
- 文件：`index.html`、`config/worker.js`（`/api/beacon`）

### P1-5 盘点并迁移历史 `_kv<=3` Issue

- 状态：`[x]` 已完成（168 条脱敏，sensitive=0）
- 问题：匹配引擎仍兼容旧 Issue body 中的明文 snippet 和加密字段，公开仓库可能残留敏感数据。
- 文件：`config/worker.js:1695`、`config/worker.js:1721`
- 验收：历史数据迁移/关闭后，移除旧格式兼容路径，GitHub 中只存在 `_kv4` 元数据。

## P2 — 增长与质量

- `[x]` 本地验证脚本：`tools/verify-local.js`。
- `[x]` GitHub Actions CI：`.github/workflows/ci.yml`（语法 + invariant）。
- `[x]` 首次回测基线：`codex/backtests/2026-08-03.txt`（zh F1 94.1%，en F1 80.0%，Spearman ρ 0.902）。
- `[x]` 冷启动验证清单：`codex/COLD-START.md`。
- `[x]` 成本台账：`codex/COSTS.md`。
- `[ ]` 获取第一批真实用户并完成真人匹配回测（已决定延期，等待真实流量/运营入口触发，不阻塞工程任务）。
- `[~]` CI 纳入 E2E：已建 `workflow_dispatch` 工作流脚手架，待配置受保护 secrets/私有 `fata-ops` 仓库。
- `[ ]` 根据真实反馈决定 Model2Vec、PWA 安装引导、高级信纸等路线图项。

## P2.5 — 运维与可观测性（2026-08-07）

- `[x]` 统一密钥加载入口：`tools/load-secrets.sh`，`~/.codex/secrets.env` 为 Codex 基础层。
- `[x]` E2E CI 工作流脚手架：`.github/workflows/e2e.yml`，仅手动触发。
- `[x]` 成本台账工具：`tools/cost-ledger.js` + `codex/COSTS.md` 月度模板。
- `[x]` 延迟项路线图：`codex/ROADMAP-2026-08-07.md`（Worker 单测、观测、算法校准）。

## 已完成基线

- `[x]` v3 重构：移除 24MB 浏览器模型和公开 LLM 端点。
- `[x]` PoW + token 认证、KV 限流、fail-closed。
- `[x]` GitHub Issue 元数据 + `FATA_DATA` KV 加密存储。
- `[x]` 中英双语 UI 和 93 条 seed 池。
- `[x]` 每日审计脚本和审计日志。
