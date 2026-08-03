# fata 成本台账

> 最后更新：2026-08-03。每月从各平台后台填写实际值。

| 项目 | 计划 | 数据来源 | 上月 | 本月 | 备注 |
|------|------|----------|------|------|------|
| Resend | 免费 3000 封/月 | Resend Dashboard | 未记录 | 未记录 | 超量后按量计费 |
| SiliconFlow / DeepSeek | 按量 | SiliconFlow 控制台 | 未记录 | 未记录 | BGE-M3 embedding + 共振 LLM |
| Cloudflare Workers/Pages/KV | 免费层 | Cloudflare Dashboard | 未记录 | 未记录 | 10K DAU 以下预计免费 |
| fata.uk 域名 | 年费 | 域名注册商 | 未记录 | 未记录 | 约 ¥70/年 |
| GitHub | 免费 | GitHub | 0 | 0 | Public repo |

## 月度记录流程

1. 每月 1 日从 Resend、SiliconFlow、Cloudflare 后台读取费用和用量。
2. 更新本表，并在 `DECISIONS.md` 记录异常。
3. 任一服务单日费用超过 ¥10 时告警，超过 ¥50 时暂停对应端点并排查。
