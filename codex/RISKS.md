# fata 风险台账

> 最后更新：2026-08-07。状态：open / mitigated / fixed / verified

| ID | 严重度 | 风险 | 证据 | 状态 |
|----|--------|------|------|------|
| R-01 | P0 | PoW 难度不一致：bootstrap 下发 14，challenge 校验 16，真实提交大概率失败 | `config/worker.js:507`、`config/worker.js:526`、`modules/pow-solver.js:31` | verified |
| R-02 | P0 | 匹配成功后不关闭 Issue、不创建 Match Issue、不发通知 | `config/worker.js:582`、`config/worker.js:765`、`index.html:1491` | verified |
| R-03 | P0 | `handleCloseMatch` 邮件逻辑把匹配对象自己的邮箱发给自己，且只发一封 | `config/worker.js:1116`、`config/worker.js:1139` | verified |
| R-04 | P1 | 用户撤回走 token PATCH，被 GitHub 代理的“token 只读”策略拒绝 | `config/worker.js:282`、`index.html:1593`、`config/worker.js:1207` | verified |
| R-05 | P1 | E2E 绕过 `/api/submit` 和 close-match，无法发现 R-01 到 R-04 | `tools/e2e-test.js` | verified |
| R-06 | P1 | Worker 源码和关键配置不在 git，无法回滚和追溯 | `.gitignore:12`、`.gitignore:15` | mitigated |
| R-07 | P1 | 旧 `_kv<=3` Issue 兼容路径仍可能读取公开 body 中的明文 snippet 和旧加密数据 | `config/worker.js:1695`、`config/worker.js:1721` | verified |
| R-08 | P2 | Resend 发送前未检查退订列表 | `ideas-todo.md:33`、`config/worker.js:921` | mitigated |
| R-09 | P2 | beacon 漏斗与 Cloudflare PV 偏差巨大（1 vs 73） | `tools/audit-logs/audit-latest.log:47`、`:48` | mitigated |
| R-10 | P2 | 旧模块仍引用 `worker.fata.uk` 和 `HMAC_KEY_RAW`，存在误导和误用风险 | `modules/match-engine.js` | verified |
| R-11 | P2 | 无本地 Worker 测试/CI，回归只能依赖线上 E2E | `tools/worker-match-core-test.js`、`.github/workflows/ci.yml` | verified |
| R-12 | P2 | 匹配池仍无真实用户 pending，冷启动和真实匹配未验证 | `tools/audit-logs/audit-latest.log` | mitigated |
| R-13 | P3 | `max_match_count` 等配置为死代码，优化指标缺失 | `config/algorithm-config.json` | verified |
| R-14 | P2 | 新增时区硬过滤：双方都有偏移且重叠不足 3 小时时直接跳过，小池匹配率可能下降；旧 seed 无偏移不受影响 | `tools/match-core.js`、`config/worker.js` | open |
| R-15 | P2 | `/api/github/issues` 旧创建路径仍会把 Issue 写成 `_kv=2`，若仍有客户端走该路径将不再参与匹配 | `config/worker.js` | verified |
| R-16 | P2 | E2E CI 仍是手动工作流，未配置受保护 secrets/私有仓库，误触发会污染线上池 | `.github/workflows/e2e.yml` | mitigated |
| R-17 | P2 | 旧 seed 注入工具已废弃，尚未提供新的 `_kv4` + FATA_DATA KV seed 写入路径 | `tools/inject-zh-seeds.js`、`tools/inject-en-seeds.js`、`tools/inject-en-bootstrap.js` | open |

## 风险更新规则

- 修复后不能直接标 fixed，必须先用新的 E2E 或等价验证证明。
- 验证通过后把状态改为 verified，并在 `DECISIONS.md` 记录。
