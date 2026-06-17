# fata — 无服务器陌生交友

> fata = fate（命运）+ data（数据）。两个陌生人的相遇，既是 AI 加持的"数据匹配"，也是一场"命运"的安排。Fata viam invenient.

## 一句话

一个静态 HTML 文件，用户打开网页写文字 → 浏览器里跑 AI 做情感频率匹配 → 撮合同频陌生人 → 双方用**自己的邮箱**通信。零服务器、零数据库、零聊天记录——"架构即隐私"。

## 开发规则

- **改完必跑 E2E** — 任何涉及 Worker API、匹配流程、邮件发送、HMAC 签名的代码改动，改完后必须自动运行 `node tools/e2e-test.js`，确认全部通过后才算完成。不依赖用户提醒。
- 只有纯 UI 样式、纯文案、纯文档类改动可以跳过 E2E。
- commit message 用英文写 — GitHub 是海外用户第一落地页，英文 commit 历史对路过的开发者和用户更友好。

## 硬约束

- 不注册公司、不备案、不建服务器
- 域名 fata.uk 已注册
- 分发策略：先海外，暂缓国内（详见 `分发.md`）。海外渠道 Twitter/X、Reddit、Product Hunt、Hacker News、GitHub 开源社区。国内用户口耳相传自然流入，不做主动分发。

## 匹配引擎（2026-06-17 经过完整 E2E 测试验证 + CSP 修复）

匹配流程已跑通并部署生产环境：

```
用户投递
  → 安全检测 (safety-handler.js)
  → 信号引导 (low-signal-guide.js)
  → 创建 GitHub Issue 入池 (AES-GCM 加密 embedding + email)
  → 拉取同语言池子 → 多通道评分 → MMR 重排
  → 匹配成功: 关闭双方 Issue → 创建 Match Issue → Resend 发邮件
  → 暂无匹配: Issue 留在池中等待
```

所有 Worker API 调用需要 HMAC 签名（`X-Fata-Signature` + `X-Fata-Timestamp`），密钥从 `GET /api/hmac-key` 获取。

**密钥分离（2026-06-17 安全加固）**：HMAC_KEY 仅用于 API 签名（可公开）。数据静态存储使用 `ENCRYPTION_KEY`（Worker secret，不对浏览器暴露）。Worker 在写入 GitHub 前自动重加密，读取时解密。即使 HMAC_KEY 泄露，池中数据不可解密。

### 修复过的关键 bug（记在这里防止重犯）

- **GitHub Issue body 是 JSON 字符串不是对象** — `_fetchPendingIssues` 必须 `JSON.parse(issue.body)`
- **HMAC 签名路径必须匹配实际请求路径** — 每个不同端点的请求单独生成签名
- **TF-IDF 模式 embedding = null** — MMR 重排需要 embedding，TF-IDF 路径跳过 MMR
- **`issue.labels` 是对象数组不是字符串数组** — 用 `_getLabelNames()` 统一提取
- **`window.HMAC_KEY_RAW` 在 init 后为空** — 必须显式赋值 `window.HMAC_KEY_RAW = HMAC_KEY_RAW`
- **`window.currentLang` 从未被赋值** — `MatchEngine.lang` 永远为 `'zh'`，英文用户匹配时传 `lang:'zh'` 给 Worker，语言隔离把英文 Issue 全部跳过（2026-06-17）
- **动态阈值在池子 ≥100 时超过 1.0** — `baseThreshold + coolingFactor` 做加法，100 pending 时 0.55+0.25=0.80，复合得分几乎不可能达到；改为 0.46+0.04=0.50（2026-06-17）
- **`matchResult.bestIssue` 不存在** — `MatchEngine.findMatch()` 返回的是 `matchIssueNumber`（数字）不是 `bestIssue`（对象），导致匹配后对方 Issue 永不关闭，僵尸 pending 累积（2026-06-17）
- **`t('model.fallbackMsg')` I18N key 拼写错误** — 不存在，正确 key 是 `'model.fallback'`，模型加载失败时用户看到原始字符串（2026-06-17）
- **CSP `connect-src` 缺少 `huggingface.co`** — Transformers.js 从 HuggingFace 下载模型权重被 CSP 拦截，在所有浏览器中静默回退到 TF-IDF（2026-06-17）
- **引导种子嵌入类型必须与浏览器一致** — Node.js 注入的种子用 TF-IDF，浏览器用 BGE，两种向量空间不兼容，余弦相似度无意义。必须用 Python sentence-transformers 或浏览器端生成 BGE 嵌入（2026-06-17）
- **`MatchEngine.initialize({mode:'fallback'})` 不传 `dim`** — 回退模式下 `this.dim` 保持默认 512，英文 TF-IDF 用 512 维但 Worker 期望 384 维，维度不匹配。改为直接传 `result`（含 `dim`）（2026-06-17）

## 部署

```bash
# 部署整个站点到 Cloudflare Pages（仅白名单文件）
./deploy.sh

# E2E 测试
node tools/e2e-test.js

# Worker 部署（独立）
cd config && npx wrangler deploy
```

API token 存储在 `.claude/settings.local.json`（gitignored）。

## 安全防线

| 层级 | 机制 | 说明 |
|------|------|------|
| 传输 | HTTPS + HMAC 签名 | 浏览器→Worker 请求签名，5 分钟防重放窗口 |
| 存储 | 双密钥 AES-GCM | HMAC_KEY 签名 / ENCRYPTION_KEY 加密，密钥分离 |
| 速率 | KV 滑动窗口 | GitHub 30/min, LLM 20/min, Resend 5/min（per IP） |
| 响应头 | `_headers` + CSP meta | X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy；CSP `connect-src` 必须包含 `huggingface.co`（模型下载）和 `worker.fata.uk`（API） |
| 部署 | `deploy.sh` 白名单 | 仅 15 个公开文件部署到 Pages，Worker 源码/算法/工具不外泄 |
| 监控 | 每日审计 + 限流统计 | `node tools/audit.js` 9 项检查含速率限制命中预警 |

## 每日审计

```bash
node tools/audit.js
```

9 项自动检查：Worker 健康 → HMAC 密钥 → 网站可用 → 过期 Issue → 匹配池计数 → Cron 状态 → Resend 通道 → E2E 匹配 → **速率限制命中预警**（单 IP 20+ 次/天会报警，提示共享 NAT 网关风险）。

审计日志写入 `tools/audit-logs/`，保留 30 天。限流统计数据通过 `/api/audit/stats`（HMAC 保护）从 Worker KV 读取。

## 文档导航

所有研究和方案文档在 `/agent/fata/` 下：

| 先读 | 文件 | 说明 |
|------|------|------|
| ⭐⭐⭐ | `state-stranger-matcher.md` | **总索引**——方案矩阵、技术栈、约束清单、开发路线图 |
| ⭐⭐ | `00-pencils-original.md` | 原始产品设计理念（灵魂——邮件媒介、AI隐身撮合、异步优先、架构即隐私） |
| ⭐⭐ | `17-tech-fusion-r4.md` | 最新技术融合报告（四轮研发后的最终方案） |
| ⭐ | `13-product-blueprint-r3.md` | 产品蓝图（用户旅程、冷启动、UX设计） |

其余 `02-16` 号文件是四轮 Loop 研发的分轮报告，按需查阅。

## 核心架构（一句话技术栈）

```
浏览器 AI (Transformers.js + bge-small-zh/en, 24MB)
  → HMAC_KEY 签名请求 → Worker 重加密 (ENCRYPTION_KEY) → GitHub Issues 静态加密存储
  → 文字匹配 (多通道评分 + MMR 多样性重排)
    → Resend (匹配通知邮件，3000封/月免费)
      → 用户自己邮箱 (SMTP/IMAP 通信，产品零接触)

安全: 密钥分离 (HMAC ≠ AES) + KV 速率限制 + CSP/_headers + 每日审计
```
