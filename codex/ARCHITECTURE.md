# fata v3 架构

> 最后更新：2026-08-07。本文件描述当前代码和线上部署的架构，历史文档如 `state-stranger-matcher.md` 是 R4 规划，不代表现状。

## 数据流

```text
用户写文字
  → SafetyHandler.localCheck()（浏览器）
  → SignalHeuristic.computeSignalDensity()（浏览器，毫秒级）
  → LowSignalGuide（文字过短时引导）
  → 邮箱弹窗
  → PoWSolver：/api/bootstrap → 解 SHA-256 → /api/challenge 换 submit token
  → MatchEngine._generateEmbedding()：本地 TF-IDF 兜底向量
  → APIClient.call('/api/submit')（含 awakeReason、timezone、timezoneOffset）
  → Worker：BGE-M3 embedding（SiliconFlow）→ AES-GCM 加密 → KV + GitHub Issue
  → Worker findMatchInPool()：多通道评分 + MMR 重排
  → 匹配成功：DeepSeek 生成共振描述 → 服务端双邮件通知 → 关闭 Issue → Match Issue → KV 清理
  → 用户在自己邮箱通信
```

## 前端模块

| 模块 | 职责 |
|------|------|
| `modules/signal-heuristic.js` | 信号密度、意图、话题、风格启发式 |
| `modules/safety-handler.js` | 自伤/仇恨关键词兜底 + 资源页面 |
| `modules/low-signal-guide.js` | 短文字引导、草稿 |
| `modules/pow-solver.js` | PoW 挑战求解 |
| `modules/api-client.js` | Worker API 客户端，token 认证 |
| `modules/match-engine.js` | 匹配辅助 + TF-IDF 兜底向量 |

## Worker 端点

| 端点 | 认证 | 说明 |
|------|------|------|
| `/api/health` | 公开 | 健康检查 |
| `/api/beacon` | 公开 | 漏斗追踪 |
| `/api/bootstrap` | 公开 | 发 PoW 挑战 + session cookie |
| `/api/challenge` | 公开 | 验证 PoW，签发 submit token |
| `/api/submit` | token | 嵌入、加密、入池、自动匹配、共振描述 |
| `/api/close-match` | token | 兼容端点；主流程已在 `/api/submit` 内完成收尾 |
| `/api/withdraw` | token | 用户撤回 pending Issue |
| `/api/github/*` | token/HMAC | GitHub Issues 代理 |
| `/api/resend/send` | token/HMAC | Resend 邮件代理（需匹配上下文） |
| `/api/retry-pending` | token/HMAC | Cron 重试 pending 通知 |
| `/api/audit/stats` | token/HMAC | 限流统计 |

## 存储

| 存储 | 内容 |
|------|------|
| GitHub Issues | 匹配池索引：语言、embedding 类型、维度等元数据 |
| `FATA_DATA` KV | 加密 email、embedding、snippet、email hash |
| `RATE_LIMIT_KV` | token、PoW nonce、owner 关系、限流计数、beacon |
| `UNSUBSCRIBE_KV` | 退订邮箱 hash |
| 浏览器 IndexedDB | 用户匹配历史、回访状态 |

## 安全模型

- 客户端零长期密钥；token 由 PoW + session cookie 换取。
- PoW 难度 16，提交限流：单邮箱 3 次/天、全局 500 次/天、IP 分级限流。
- `ENCRYPTION_KEY` 只存在 Worker secrets；GitHub Issue 只存元数据。
- 没有公开 LLM 代理端点；共振 LLM 只在匹配流程内部调用。
- KV 不可用时 fail-closed，拒绝提交。

## 已知遗留

- 旧模块 `resend-retry.js`、`llm-fallback.js`、`model-loader.js` 已删除；`match-engine.js` 已精简为 TF-IDF 兜底。
- `config/worker.js`、`config/wrangler.toml` 被 `.gitignore` 排除，但已纳入 `codex/private-worker/` 私有 git 备份。
- beacon 使用唯一 key + 前缀统计，避免并发计数丢失；Cloudflare PV 仍可能高于 beacon（包含无 JS 流量）。
- `select_reason` 事件按 reason 写入唯一 key，`/api/audit/stats` 返回原因分布。
- 匹配引擎只处理 `_kv>=4` + FATA_DATA KV 候选；旧格式直接跳过并记录 debug。
