# fata Worker LLM 端点可被白嫖

**发现时间**：2026-06-20
**严重程度**：高危 — API key 可被任意第三方免费使用

## 漏洞

fata Cloudflare Worker (`worker.fata.uk`) 的 LLM 代理端点可以被任何人调用，费用记在 fata 的 DeepSeek API key 上。

## 攻击链（已复现验证）

```
1. GET https://worker.fata.uk/api/hmac-key
   → 返回 64 位 HMAC 密钥（公开端点，无需认证）

2. 用拿到的 HMAC 密钥伪造签名头
   X-Fata-Signature = Base64(HMAC-SHA256(HMAC_KEY, "{timestamp}:{path}"))
   X-Fata-Timestamp = 当前 Unix 时间戳

3. POST https://worker.fata.uk/api/llm/analyze
   Body: {"prompt_type":"signal_density","text_a":"任意文字","lang":"zh"}
   → Worker 用 fata 的 DeepSeek API key 调用 DeepSeek，返回 LLM 结果
   → 费用从 fata 账号扣除
```

攻击者可调用四种 prompt：
- `signal_density`
- `intent_parse`
- `resonance`
- `interview_compose`

全部走 `deepseek-chat`（→ v4-flash），每次消耗几百 token。但可无限调用。

## 三个设计问题凑在一起才成立

### 1. HMAC 密钥公开

`GET /api/hmac-key` 不做任何认证就返回 HMAC 密钥。虽然 HMAC_KEY 设计为"仅用于 API 签名、可公开"（参见 CLAUDE.md），但这个设计假设了**只有合法浏览器用户会调用 API**。实际上任何人拿到 HMAC key 都能伪造请求。

### 2. 速率限制的降级逻辑是反的

```javascript
// config/worker.js line 146-167
async function checkRateLimit(env, key, maxRequests, windowSeconds) {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return true; // ← BUG: KV 不可用时放行所有请求
  try { ... } catch (e) {
    return true; // ← BUG: KV 异常时也放行
  }
}
```

安全原则：限流系统故障时应该**拒绝请求**（fail closed），而不是放行（fail open）。

### 3. LLM 端点没有用户身份校验

即使 HMAC 签名正确，Worker 也无法区分请求来自真实 fata 用户还是攻击者。HMAC 只能验证"请求来自知道 HMAC_KEY 的人"——而这个 key 是公开的。

## 实际损失

DeepSeek 后台 2026-06-20 数据（fata key `sk-e2616...`）：

| 模型 | 请求数 | 缓存命中 | 缓存未命中 | 估算费用 |
|------|--------|---------|-----------|---------|
| v4-flash | 1,262 | 6,216 万 | 2.87 亿 | ~¥272 |

对比正常用量（6/13-6/19 平均每天 ~40 次、¥1-2），6/20 暴涨约 30 倍。

GitHub Issues 当天只创建了 14 个（8 pending + 6 matched），对应约 40-56 次正常 LLM 调用。其余 1,200+ 次是白嫖流量。

## 修复方案

### 必须做（立即）

1. **Revoke 当前 API key** — DeepSeek 后台作废 `sk-e2616d6ac19246cda5e76390f159f01b`，换新 key 用 `wrangler secret put DEEPSEEK_API_KEY` 部署

2. **删除 `/api/hmac-key` 公开端点** — 将 HMAC 密钥写死在浏览器端 JS 代码中（它已经在 `index.html` 和 `modules/match-engine.js` 的 `window.HMAC_KEY_RAW` 里用到了），不再从 Worker 动态获取。或者至少加一个简单的认证（如 Referer 检查、captcha、或预共享的 bootstrap token）

3. **修复速率限制降级逻辑** — `checkRateLimit` 中 `if (!kv) return true` 改为 `return false`（KV 不可用时拒绝请求）

### 应该做（短期）

4. **LLM 端点加请求签名校验之外的防护**：
   - 要求请求必须携带有效的 `userIssueNumber` 或 session token
   - 限制单 IP 每日总 token 消耗上限

5. **Worker 加监控告警** — 当 LLM 调用量异常时（如日请求 > 200），自动告警

### 建议做（长期）

6. **为 fata 单独注册一个 DeepSeek API key**，与 cc-switch/Claude Code 用的 key 隔离。这样即使 Worker 的 key 泄漏，也不会影响主 key
