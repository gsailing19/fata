# fata 成本台账

> 最后更新：2026-08-07。每月从各平台后台填写实际值。

| 项目 | 计划 | 数据来源 | 上月 | 本月 | 备注 |
|------|------|----------|------|------|------|
| Resend | 免费 3000 封/月 | Resend Dashboard | 未记录 | 未记录 | 超量后按量计费；E2E 会触发测试邮件 |
| SiliconFlow / DeepSeek | 按量 | SiliconFlow 控制台 | 未记录 | 未记录 | BGE-M3 embedding + 共振 LLM |
| Cloudflare Workers/Pages/KV | 免费层 | Cloudflare Dashboard | 未记录 | 未记录 | 10K DAU 以下预计免费 |
| GitHub Actions / GitHub | 免费 / 公开仓库 | GitHub 用量页 | 未记录 | 未记录 | E2E 为手动触发的真实链路，会占用 Actions 分钟数 |
| fata.uk 域名 | 年费 | 域名注册商 | 未记录 | 未记录 | 约 ¥70/年 |

## 月度记录

每月记录用 `tools/cost-ledger.js` 追加，不联网、不含密钥：

```bash
node tools/cost-ledger.js --month 2026-08 \
  --entry "Resend|0|免费层" \
  --entry "SiliconFlow|12.34|BGE-M3 + DeepSeek"
```

### 2026-08

| 日期 | 服务 | 金额 (CNY) | 备注 |
|------|------|------------|------|

## 月度记录流程

1. 每月 1 日从 Resend、SiliconFlow、Cloudflare、GitHub Actions 后台读取费用和用量。
2. 更新服务清单表，并用 `node tools/cost-ledger.js` 追加到月度记录。
3. 在 `DECISIONS.md` 记录异常。
4. 任一服务单日费用超过 ¥10 时告警，超过 ¥50 时暂停对应端点并排查。
