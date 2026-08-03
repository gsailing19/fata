# fata 审计框架

> 最后更新：2026-08-03

## 原则

- 只读优先：基线审计不得运行会写线上数据的脚本，不得部署、不得发送真实邮件。
- 证据驱动：每个发现必须有文件/行号、现状、影响、复现或证据。
- 先快照后改动：审计前制作 `codex/snapshots/<date>/` 快照。
- 可复查：每次审计产出一份 `codex/audit/YYYY-MM-DD-*.md` 报告，并同步更新风险台账和任务看板。

## 严重度

| 级别 | 定义 |
|------|------|
| P0 | 主流程不可用、用户数据受损、隐私承诺被破坏 |
| P1 | 主流程局部功能不可用、生产代码不可回滚、审计存在明显盲区 |
| P2 | 可用但不符合设计、运维成本高、有潜在风险 |
| P3 | 代码卫生、文档一致性、可读性 |

## 审计范围

| 域 | 检查点 |
|----|--------|
| 产品主流程 | 提交、匹配、关闭、通知、撤回、回访、草稿恢复 |
| Worker 安全 | 公开端点、认证、PoW、限流、secrets、fail-closed |
| 数据与隐私 | GitHub Issue 是否只存元数据、KV 加密、密钥分离、无明文片段 |
| 算法 | 评分、阈值、MMR、语言隔离、TF-IDF 兜底 |
| 前端 | 安全检测、低信号引导、邮箱弹窗、i18n、漏斗埋点 |
| 部署运维 | git 版本管理、wrangler 配置、部署脚本、回滚能力、Cron |
| 监控指标 | 审计日志、beacon、Cloudflare 统计、成本、延迟、邮件送达 |

## 证据模板

```markdown
### F-xx [P0] 标题

- 文件/行号：`config/worker.js:507`
- 现状：具体代码行为
- 影响：对用户或系统的后果
- 证据：审计日志、命令输出、源码引用
- 建议：最小修复方案
- 状态：待办 / 修复中 / 已修复 / 已验证
```

## 审计流程

1. 制作快照：`mkdir -p codex/snapshots/$(date +%F)` 并复制 gitignored 生产文件。
2. 静态审查：源码、路由、配置、测试、gitignore。
3. 本地只读测试：`node tools/invariant-tests.js`、`node tools/algo-test.js`、`node --check config/worker.js`。
4. 线上只读检查：公开健康检查、已有审计日志、GitHub 公开元数据；不写数据。
5. 产出报告并更新 `RISKS.md`、`TASKS.md`、`METRICS.md`。

## 明确不做

- 不运行 `tools/e2e-test.js`（会创建测试 Issue 并触发 Resend）。
- 不运行 `tools/audit.js`（会执行 E2E 并清理线上 Issue）。
- 不部署 Worker 或 Pages。
- 不修改生产数据、不发送真实邮件。
