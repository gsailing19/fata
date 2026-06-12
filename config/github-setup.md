# GitHub Issues 初始化指南
# Loop 3.3: 基础设施部署

## 需要创建的 Labels

在 GitHub repo 的 Issues → Labels 中创建以下标签：

| Label 名称 | 颜色 | 用途 |
|-----------|------|------|
| `pending` | `#2da44e` 绿色 | 文字在匹配池中等待匹配 |
| `matched` | `#8250df` 紫色 | 匹配成功，双方 Issue 已关闭 |
| `matched-pending-notification` | `#bf8700` 橙色 | 匹配成功但通知邮件尚未发出（Resend 故障重试中） |
| `seed` | `#768390` 灰色 | AI 种子文字，不参与真实匹配 |
| `expired` | `#cf222e` 红色 | 文字已过期（超过有效期或手动关闭） |
| `opt-out` | `#6e7781` 暗灰 | 用户退订通知（邮箱哈希登记） |
| `feedback` | `#1f883d` 深绿 | 用户反馈/投诉 |

## Fine-grained PAT 权限配置

在 GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens：

1. Resource owner: 你的 GitHub 用户名
2. Repository access: Only select repositories → 选择 fata repo
3. Permissions:
   - Issues: Read and Write ✅
   - Metadata: Read (自动授予)
   - **不勾选任何其他权限**
4. 过期时间：建议 90 天（记得续）

## 用户反馈 Issue 模板

在 repo 中创建 `.github/ISSUE_TEMPLATE/feedback.md`：

```markdown
---
name: 反馈与帮助
about: 在使用 fata 时遇到了问题？这里告诉我们
title: ''
labels: ['feedback']
assignees: ''
---

## 我遇到了什么问题

<!-- 尽量详细描述。fata 是匿名工具，不需要提供个人信息 -->


## 发生的时间

<!-- 大概什么时候遇到的？ -->


## 补充信息

<!-- 任何你觉得可能有用的信息。你的邮箱不会出现在这里 -->
```

## 通知邮件退订 Issue 模板

创建 `config/opt-out-template.json`：

```json
{
  "title": "opt-out:{email_hash}",
  "body": "用户邮箱哈希：{email_hash}\n退订时间：{timestamp}\n自动创建。CF Worker 发送通知前检查此 label。",
  "labels": ["opt-out"]
}
```

## 种子文字生成后写入流程

```bash
# 生成 50 条 AI 种子文字（通过 LLM）后，每条：
# 1. 用 Transformers.js 生成 embedding
# 2. 加密虚拟邮箱 "seed@fata.uk"
# 3. 创建 Issue

# Issue body 格式：
{
  "v": 1,
  "e": "<base64 encrypted embedding>",
  "i": "<base64 encrypted intent_profile>",
  "m": "<base64 encrypted seed@fata.uk>",
  "h": "<SHA-256 of text>",
  "s": "<signal_density>",
  "t": "<timestamp>",
  "seed_theme": "<主题标签>"
}

# Issue labels: ["seed"]
# 种子不参与真实匹配 — 前端拉取时排除 label:seed
```
