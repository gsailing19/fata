# fata Codex 项目框架

> 最后更新：2026-08-03

本目录是 Codex 在 fata 仓库内工作的统一入口。根目录 `AGENTS.md` 是 Codex 启动时读取的规则文件，这里的文档负责补充细节、任务状态和验证方式。

## 导航

| 文件 | 内容 |
|------|------|
| [PROJECT.md](PROJECT.md) | 项目现状、产品定位、关键指标 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 当前 v3 架构、数据流、端点、安全模型 |
| [TASKS.md](TASKS.md) | 任务看板，按优先级排列 |
| [VERIFY.md](VERIFY.md) | 验证命令、覆盖范围和改动分类 |
| [AUDIT.md](AUDIT.md) | 审计范围、检查清单、证据模板 |
| [RISKS.md](RISKS.md) | 风险台账 |
| [METRICS.md](METRICS.md) | 指标基线与优化目标 |
| [RUNBOOK.md](RUNBOOK.md) | 部署、回滚、secrets、安全操作手册 |
| [DECISIONS.md](DECISIONS.md) | 修复与架构决策日志 |
| [COSTS.md](COSTS.md) | 成本台账 |
| [COLD-START.md](COLD-START.md) | 冷启动验证清单 |

审计产出保存在 `codex/audit/`，改动前快照保存在 `codex/snapshots/`。

## 工作方式

1. 任何新任务先更新任务看板中的对应条目（状态：待办/进行中/已完成）。
2. 修改代码前先确认当前架构，不要被 `state-stranger-matcher.md` 等历史研究报告误导。
3. 改完按 `VERIFY.md` 的矩阵跑对应验证，尤其是 Worker API 和匹配链路。
4. 发现文档与代码不一致时，先修 `codex/` 文档，再继续实现。
5. 任何生产代码改动前，先按 `RUNBOOK.md` 制作快照；改动后更新 `DECISIONS.md` 和 `RISKS.md`。
