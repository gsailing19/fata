# fata 验证矩阵

> 最后更新：2026-08-07

## 命令

| 命令 | 类型 | 是否联网 | 说明 |
|------|------|----------|------|
| `node tools/invariant-tests.js` | 本地 | 否 | 算法不变量，70 项 |
| `node tools/worker-match-core-test.js` | 本地 | 否 | Worker 匹配纯逻辑，37 项 |
| `node tools/algo-test.js --lang zh` | 本地 | 否 | 中文配对 F1 |
| `node tools/algo-test.js --lang en` | 本地 | 否 | 英文配对 F1 |
| `node tools/evaluate-matching.js` | 本地 | 否 | 场景等级相关性 |
| `node tools/verify-local.js` | 本地 | 否 | 语法 + invariant + algo + 场景评估 |
| `node tools/weekly-backtest.js` | 本地 | 否 | 生成 `codex/backtests/<date>.txt` |
| `node tools/e2e-test.js` | 线上 | 是 | 真实 PoW + `/api/submit` + 匹配 + 通知 + 撤回，15 项断言，会修改线上池 |
| `node tools/audit.js` | 线上 | 是 | 每日健康审计，写审计日志 |
| `node tools/sanitize-legacy-issues.js` | 线上 | 是 | 历史敏感 Issue 脱敏，需 HMAC，受 30 req/min 限制 |

## 改动分类

| 改动范围 | 必须验证 |
|----------|----------|
| 纯 UI 样式 / 文案 / 文档 | 无，需在总结中说明 |
| 算法或浏览器模块 | invariant + algo |
| Worker API / 匹配 / 邮件 / HMAC / 部署配置 | e2e + audit |

## 重要提醒

- `tools/e2e-test.js` 已是完整匹配链路测试：走 `/api/submit`，断言匹配、关闭、Match Issue、双邮件通知和撤回；还会校验醒着原因与时区元数据。
- E2E 需要 `FATA_HMAC_KEY` 环境变量；测试使用唯一 email hash，避免撞到单邮箱日限流。
- `tools/audit.js` 的检查数量以脚本输出为准，当前每日审计为 12 项左右。
- E2E 和审计需要生产环境变量（如 `FATA_HMAC_KEY`），失败时要先确认环境变量，不要只改测试掩盖问题。
