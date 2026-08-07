# fata 指标基线

> 最后更新：2026-08-07

## 当前基线

| 指标 | 值 | 来源/日期 |
|------|-----|-----------|
| 每日审计 | 12/12 PASS | `tools/audit-logs/audit-latest.log`，2026-08-02 |
| 真实链路 E2E | 15/15 PASS | `node tools/e2e-test.js`，2026-08-07 |
| Worker 版本 | `0083d0e4-26c5-46f1-881d-6140132e359b` | wrangler deploy，2026-08-07（Worker 硬化后） |
| 历史敏感 Issue | 168 条已脱敏，剩余 sensitive=0 | 2026-08-03 清理复查 |
| 匹配池 pending | 93（全部 seed） | 2026-08-02 审计 |
| 匹配池 matched | 8 | 2026-08-02 审计 |
| 真实用户 pending | 0 | 2026-08-02 审计 |
| 站点 PV | 73（2026-08-01） | Cloudflare 统计 |
| 站点 UV | 38（2026-08-01） | Cloudflare 统计 |
| beacon page_view | 1（2026-08-01） | KV funnel，与 PV 不一致 |
| 算法 invariant | 70/70 | `node tools/invariant-tests.js` |
| Worker match-core 单测 | 37/37 | `node tools/worker-match-core-test.js`，2026-08-07 |
| 中文算法 F1 | 94.1%（1 个已知 FP） | `node tools/algo-test.js --lang zh` |
| 英文算法 F1 | 84.2%（3 个已知 FP） | `node tools/algo-test.js --lang en`，2026-08-07 |
| 场景评估 Spearman | 0.902（强相关，等级重叠严重） | `node tools/evaluate-matching.js`，2026-08-03 |
| 本地验证 | verify-local 全绿 | `node tools/verify-local.js`，2026-08-07 |

## 新增能力（2026-08-07）

- `select_reason` 已进入 beacon 与 `/api/audit/stats`，可看原因标签漏斗。
- 匹配引擎只处理 `_kv>=4` 候选；旧格式直接跳过并记录 debug。
- E2E CI 提供手动 `workflow_dispatch` 入口，密钥缺失会失败而不是静默跳过。
- 成本采集：Cloudflare 本月用量已自动记录；Resend/SiliconFlow 待人工填写。

## 待建立基线

- Worker 延迟：本机审计日志曾记录健康检查约 4.8s；本次只读实测约 2.0s（2026-08-03），不代表真实 p95，需接入观测后重测。
- 提交成功率：PoW 已修复，真实提交链路 E2E 通过；仍待有机用户数据。
- 匹配率：真实用户未入池，暂无数据。
- 邮件送达率：E2E 已验证 Worker 调用 Resend 成功（`delivered@resend.dev`），真实收件箱送达仍需 dashboard 验证。
- API 成本：SiliconFlow/DeepSeek/Resend 用量和费用未做台账。
- 真实用户数据：仍为 0，冷启动验证待运营触发。

## 优化目标

| 目标 | 定义 |
|------|------|
| 主流程可用 | 修复 PoW 后，真实提交成功率 > 0，完整 E2E 通过 |
| 通知闭环 | 每次测试匹配双方各收到 1 封通知，Issue 正常关闭 |
| 漏斗可信 | beacon page_view 与 Cloudflare PV 偏差 < 20% |
| 回归门禁 | 本地 invariant + algo + Worker 语法检查全绿，E2E 只在安全窗口运行 |
| 成本透明 | 每月记录 API 费用和发送量，异常时告警 |
