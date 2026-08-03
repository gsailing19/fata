# fata 冷启动验证清单（P2-2）

> 最后更新：2026-08-03

## 池健康检查

```bash
node tools/audit.js
```

重点看：

- `pending`：93 条 seed 是否完整。
- `test`：不应残留 open 测试 Issue。
- `matched-pending-notification`：应为 0，若大于 0 说明邮件重试队列积压。

## 首次真实用户验证

当出现第一个非 seed、非 test 的真实 pending 时：

- 记录真实用户 pending 数量、提交时间、语言。
- 确认 funnel：`page_view → start_typing → click_send → submit_success`。
- 如果提交成功但未匹配，检查匹配池规模和阈值。
- 如果匹配成功，确认双方收到通知邮件、Issue 关闭、Match Issue 创建。

## 冷启动指标

| 指标 | 目标 |
|------|------|
| 真实用户 pending | > 0 |
| 首次真人匹配 | 发生 |
| seed:real 比例 | 随真实用户增长逐步下降 |
| 通知送达 | 测试链路 100%，真实邮件进收件箱 |
| funnel | beacon PV 与 Cloudflare PV 偏差 < 20% |

## 分发入口

- Twitter/X、Reddit、Product Hunt、Hacker News、GitHub 开源社区。
- 国内不主动分发，等待自然流入。
