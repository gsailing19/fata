# fata — 无服务器陌生交友

> fata = fate（命运）+ data（数据）。两个陌生人的相遇，既是 AI 加持的"数据匹配"，也是一场"命运"的安排。Fata viam invenient.

## 一句话

一个静态 HTML 文件，用户打开网页写文字 → 浏览器端启发式算法即时评分 → Worker 调 API 生成智能匹配指纹 → 撮合同频陌生人 → 双方用**自己的邮箱**通信。零服务器、零数据库、零聊天记录、零模型下载——"打开即用"。

## 开发规则

- **改完必跑 E2E** — 任何涉及 Worker API、匹配流程、邮件发送、HMAC 签名的代码改动，改完后必须自动运行 `node tools/e2e-test.js`，确认全部通过后才算完成。不依赖用户提醒。
- 只有纯 UI 样式、纯文案、纯文档类改动可以跳过 E2E。
- commit message 用英文写 — GitHub 是海外用户第一落地页，英文 commit 历史对路过的开发者和用户更友好。

## 硬约束

- 不注册公司、不备案、不建服务器
- 域名 fata.uk 已注册
- 分发策略：先海外，暂缓国内（详见 `分发.md`）。海外渠道 Twitter/X、Reddit、Product Hunt、Hacker News、GitHub 开源社区。国内用户口耳相传自然流入，不做主动分发。

## 匹配引擎（2026-06-22 v3 重构 — 移除 24MB 模型 + LLM 端点内部化）

匹配流程 v3，首屏秒开，零模型下载：

```
用户投递
  → 安全检测 (safety-handler.js)
  → 信号密度评分 (signal-heuristic.js, 浏览器端毫秒级)
  → Worker /api/submit → 调 BGE-M3 embedding API (1024维) → 加密入池
  → 拉取同语言池子 → 多通道评分 → MMR 重排
  → 匹配成功: 关闭双方 Issue → 创建 Match Issue → Worker 内部调共振 LLM → Resend 发邮件
  → 暂无匹配: Issue 留在池中等待
```

关键变化：
- **删除了 `/api/llm/*` 公开代理端点** — LLM 调用不再经过浏览器
- **24MB BGE 模型已移除** — embedding 通过 Worker → SiliconFlow BGE-M3 API 生成，浏览器端 TF-IDF 做即时兜底
- **信号密度 + 意图解析改用浏览器端启发式**（`modules/signal-heuristic.js`），零 API 成本
- **共振描述保留 Worker 端 LLM** — 唯一的服务端 AI 调用，仅在匹配成功时触发
- **Worker observability 已关闭** — 不做文字采样

所有 Worker API 调用需要 HMAC 签名（`X-Fata-Signature` + `X-Fata-Timestamp`）。HMAC 密钥前端静态嵌入（不再通过 API 端点获取，参见 `SECURITY-PREVENTION.md` 规则 2）。

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
- **CSP `connect-src` 缺少 `huggingface.co`** — Transformers.js 从 HuggingFace 下载模型权重被 CSP 拦截，在所有浏览器中静默回退到 TF-IDF（2026-06-17）**→ 更深的根因：`env.remoteHost` 未设置，模型 URL 被解析为 `fata.uk/models/`（当前页面 origin），不是 CSP 拦截。修复：`env.remoteHost = 'https://huggingface.co'`（2026-06-18）**
- **引导种子嵌入类型必须与浏览器一致** — Node.js 注入的种子用 TF-IDF，浏览器用 BGE，两种向量空间不兼容，余弦相似度无意义。必须用 Python sentence-transformers 或浏览器端生成 BGE 嵌入（2026-06-17）
- **`MatchEngine.initialize({mode:'fallback'})` 不传 `dim`** — 回退模式下 `this.dim` 保持默认 512，英文 TF-IDF 用 512 维但 Worker 期望 384 维，维度不匹配。改为直接传 `result`（含 `dim`）（2026-06-17）
- **`env.localModelPath` 默认 `/models/`** — Transformers.js 的模型本地路径默认值是 `/models/`，相对于当前页面 origin。fata.uk 是 SPA，所有路径返回 HTML 200，Transformers.js 拿 HTML 当 JSON 解析失败，静默回退 TF-IDF。**更深的根因（2026-06-18）：CDN import URL 指向了 UMD 构建（`/dist/transformers.min.js`），没有 ES named exports，`pipeline` 和 `env` 均为 `undefined`。** 修复：(1) CDN URL 改为裸包名 `@xenova/transformers@2.17.2`（去掉 `/dist/transformers.min.js`）；(2) 只设 `env.remoteHost = 'https://huggingface.co'`，不手动设 `localModelPath`。SPA 对默认 `/models/` 返回 HTML，JSON 解析失败后自动触发远程 HuggingFace 回退。
- **LLM 返回组合 need 标签导致匹配失败** — LLM 对英文"倾听者"文本返回 `"give advice / listen to others"` 等组合标签。`normalizeNeed` 的 `/` 分割逻辑取第一个匹配，导致"give advice"被采纳，真正的"listen to others"被忽略。修复：(1) 添加常见组合标签的精确映射；(2) `/` 分割时优先采纳 `listen to others` / `be heard` 而非 `give advice`，因为 LLM 常把倾听误标为建议当次要标签附加（2026-06-18）
- **多余 `}` 导致页面白屏** — 在 `init()` 的 else 分支添加 `showFallbackIndicator()` 时多了一个 `}`，提前关闭了函数，`renderHome()` 永远不被调用（2026-06-18）
- **`/api/hmac-key` 公开端点导致 LLM 被白嫖** — HMAC 密钥通过无认证 API 公开获取，攻击者拿到密钥后伪造签名，通过 Worker LLM 代理端点免费调用 DeepSeek。2026-06-20 一天被刷 1,262 次、3.49 亿 token、¥272。修复：删除公开端点、HMAC 密钥静态嵌入前端、速率限制 fail-closed、LLM 日 token 上限（2026-06-20，详见 `INCIDENT-2026-06-20.md`）
- **v3 重构：删除所有公开 LLM 端点 + 移除 24MB 模型** — `/api/llm/*` 路由彻底删除，信号密度/意图解析改为浏览器端启发式，embedding 移到 Worker 端 API 调用（BGE-M3），首屏秒开。共振 LLM 保留为 Worker 内部调用（需匹配上下文验证）。（2026-06-22，详见 `INCIDENT-2026-06-20.md` 和 `SECURITY-PREVENTION.md`）

## 安全事故记录 + 预防措施

- **`INCIDENT-2026-06-20.md`** — LLM 端点白嫖事故完整报告（时间线、根因、损失、教训）
- **`SECURITY-PREVENTION.md`** — 从事故提取的 9 条预防规则（公开端点检查、限流 fail-closed、API Key 隔离、审计增强等）
- **`SECURITY-HMAC-LLM-LEAK.md`** — 漏洞发现时的原始分析记录

## 部署

```bash
# 部署整个站点到 Cloudflare Pages（仅白名单文件）
./deploy.sh

# E2E 测试
node tools/e2e-test.js

# Worker 部署（独立）
cd config && npx wrangler deploy
```

## 离线测试与参数调优

匹配算法的评分函数和配置已提取到 `tools/match-core.js`，作为唯一真相来源。Worker 生产环境和所有测试工具都从这里导入。

```bash
# 不变量测试（<1s，54 项断言，中英文覆盖）
node tools/invariant-tests.js

# 配对测试（精确率/召回率/F1）
node tools/algo-test.js --lang zh           # 中文 bigram 模式
node tools/algo-test.js --lang en           # 英文 bigram 模式
node tools/algo-test.js --mode transformers --lang zh  # BGE 保真度验证（需 @xenova/transformers）

# 场景评估（Spearman 等级相关）
node tools/evaluate-matching.js             # bigram 模式
node tools/evaluate-matching.js --mode transformers  # BGE 保真度
```

**测试工具架构**：
```
tools/match-core.js       — 评分函数 + 算法配置（单点维护）
tools/embed.js             — 嵌入生成：bigram / transformers / python 三种模式
tools/invariant-tests.js  — 纯函数断言，<1 秒跑完
tools/algo-test.js         — 配对分类测试（F1）
tools/evaluate-matching.js — 场景等级评估（Spearman ρ）
```

API token 存储在 `.claude/settings.local.json`（gitignored）。

## 安全防线

| 层级 | 机制 | 说明 |
|------|------|------|
| 传输 | HTTPS + HMAC 签名 | 浏览器→Worker 请求签名，5 分钟防重放窗口 |
| 存储 | 双密钥 AES-GCM | HMAC_KEY 签名 / ENCRYPTION_KEY 加密，密钥分离 |
| 速率 | KV 滑动窗口 | GitHub 30/min, Submit 3/email/day + 500/day global cap, Resend 5/min（per IP） |
| 反滥用 | PoW + 邮箱限流 + 信号门 | 提交前需解 SHA-256 挑战，单邮箱日限 3 次，低信号文本不入池 |
| 响应头 | `_headers` + CSP meta | X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy；CSP `connect-src` 包含 `worker.fata.uk`（API）和 `api.github.com` |
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
浏览器启发式 (signal-heuristic.js, 毫秒级)
  → HMAC 签名请求 → Worker → BGE-M3 embedding API (SiliconFlow, 1024维)
  → 加密存储 (AES-GCM + ENCRYPTION_KEY) → GitHub Issues 静态加密存储
  → 文字匹配 (多通道评分 + MMR 多样性重排)
    → Worker 内部共振 LLM (仅在匹配成功时调用)
      → Resend (匹配通知邮件，3000封/月免费)
        → 用户自己邮箱 (SMTP/IMAP 通信，产品零接触)

安全: 密钥分离 (HMAC ≠ AES) + PoW + 邮箱限流 + CSP + 每日审计
```
