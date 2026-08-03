<p align="center">
  <img src="logo/logo-horizontal.svg" alt="fata" width="240">
</p>

# fata

> *Fata viam invenient.* — 命运会找到出路。

[English](README.md) | 中文

---

**[fata.uk](https://fata.uk)** — 打开网页，写下让你醒着的事，遇到另一个同样醒着的人。然后用**你自己的邮箱**通信。没有 App、没有照片、没有滑动、没有即时聊天。

## 这是什么

fata 用文字的情绪形状匹配同样醒着的人，不靠照片或标签。你写下深夜让你醒着的事。浏览器里的启发式算法即时给文字打分。Cloudflare Worker 调用 BGE-M3 生成语义嵌入、加密后放入匹配池。匹配成功后，双方收到对方的邮箱地址。之后的通信完全在你自己的邮箱里进行——fata 全程不碰你们的对话。

**fata = fate（命运）+ data（数据）。** 两个醒着的人相遇——既是 AI 加持的数据匹配，也是一场命运的安排。

## 为什么可以信任 fata

**fata 没有办法偷看你的对话——不是"承诺不偷看"，是技术上做不到。**

- **你的文字在进入匹配池之前已加密。** AES-GCM，密钥分离（HMAC_KEY ≠ ENCRYPTION_KEY）。即使 GitHub Issues 泄露，密文也无法解密。
- **零公开推理端点。** LLM 调用仅在 Worker 内部触发。没有 `/api/llm` 路由。模型 API 防滥用是架构层面实现的，不是靠限速事后补救。
- **PoW + session 绑定 token 认证。** 每次提交需解 SHA-256 挑战。Token 一次性使用、绑定 IP、有时效。所有限速 fail-closed（KV 不可用 → 拒接请求）。
- **通信在你自己的邮箱里。** fata 只发一封通知邮件（通过 Resend），交出对方邮箱地址后即退场。没有聊天服务器，没有消息数据库。
- **架构即隐私。** 静态 HTML + Cloudflare Pages + GitHub Issues 加密池。没有数据库可被拖库，没有聊天记录可被调取，没有日志可泄露。

[预防规则](SECURITY-PREVENTION.md)

## 如何使用

1. 打开 fata.uk
2. 写下今晚让你醒着的事——什么放不下、窗外是什么颜色、此刻在想什么
3. 浏览器端启发式引擎即时分析信号密度和意图（毫秒级，零 API 成本）
4. 如果文字太短，fata 会温和地引导你多写一点（不评判、不拒绝）
5. Worker 端调用 BGE-M3 生成语义嵌入 → AES-GCM 加密 → 存入 GitHub Issues 池
6. 多通道评分 + MMR 多样性重排，找到最佳匹配
7. 匹配成功：双方各收到一封邮件——里面有对方的邮箱地址和一段共振描述

## 技术栈

| 层 | 技术 | 运行位置 |
|---|------|---------|
| 信号密度 + 意图解析 | 启发式引擎 | 浏览器（瞬间） |
| 语义嵌入 | BGE-M3（SiliconFlow API） | CF Worker |
| 匹配算法 | 多通道评分 + MMR 重排 | CF Worker |
| 加密存储 | AES-GCM + GitHub Issues | CF Worker 代理 |
| 共振描述 | DeepSeek-V4（Worker 内部调用） | CF Worker |
| 邮件投递 | Resend（3000 封/月免费） | CF Worker 代理 |
| 认证 + 反滥用 | PoW + token + HMAC + KV 限速 | CF Worker |
| 前端 | 单个静态 HTML + 原生 JS | Cloudflare Pages |

首屏秒开，零模型下载。零公开 API Key。零用户数据库。

## 自己部署

fata 是一个静态 HTML 文件 + 一个 Cloudflare Worker。

### 准备工作

- GitHub 账号（Issues 作为匹配池）
- Cloudflare 账号（Workers + Pages + KV）
- Resend 账号（邮件投递，免费 tier 3000 封/月）
- SiliconFlow 账号（BGE-M3 嵌入）

### 快速开始

```bash
# 1. 创建 GitHub Labels 和 PAT
#    参考 config/github-setup.md

# 2. 配置并部署 Worker
cd config
cp wrangler.toml.example wrangler.toml   # 编辑填入你的仓库信息
npx wrangler secret put GITHUB_PAT
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SILICONFLOW_API_KEY
npx wrangler secret put HMAC_KEY
npx wrangler secret put ENCRYPTION_KEY
npx wrangler deploy

# 3. 部署前端
./deploy.sh
```

## 开发哲学

- **异步优先。** 不推送、无在线状态、无即时通讯。等待是期待。
- **AI 是桥，不是伴。** AI 读文字、做匹配、写共振描述——然后退场。你永远看不到聊天机器人。
- **架构即隐私。** "不收集数据"是对架构的事实陈述，不是承诺。
- **邮箱即产品。** 没有内置聊天。通信回归到你手里最通用、最私密的工具。

## 用户怎么说

"像 Slowly 但 AI 真的读了你的文字" · "Omegle 的反面——慢、有深度、异步" · "一个网页给你介绍一个人，然后它自己消失了"

## 许可

MIT
