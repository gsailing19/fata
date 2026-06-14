<p align="center">
  <img src="logo/logo.svg" alt="fata logo" width="80">
</p>

# fata

> *Fata viam invenient.* — 命运会找到出路。Fate will find a way.

你打开一个网页，写一段话。AI 在浏览器里读懂你的文字，帮你找到另一个频率最接近的陌生人。然后你们用**各自的邮箱**通信。

You open a webpage, write a few lines. AI reads your words in the browser, and finds another stranger whose frequency matches yours. Then you talk — using your **own email**.

---

## 为什么可以信任 fata / Why trust fata

**fata 没有办法偷看你的对话——不是"承诺不偷看"，是技术上做不到。**

**fata *cannot* read your conversations — not "promises not to", but technically incapable.**

- **你的文字不出浏览器。** AI 模型（Transformers.js + bge-small-zh-v1.5, 24MB）在你的浏览器里纯本地运行。见 `modules/model-loader.js`
- **Your words never leave your browser.** The AI model runs entirely locally in your browser. See `modules/model-loader.js`
- **文字池是公开的 GitHub Issues。** 你的文字加密后存入 Issue 等待匹配，匹配成功后 Issue 关闭。像公共公告板上的密码锁盒子。见 `config/github-setup.md`
- **The matching pool is public GitHub Issues.** Your encrypted text waits in an Issue. When matched, the Issue closes. Like a padlocked box on a public bulletin board. See `config/github-setup.md`
- **高危文字不进入匹配池。** 当 AI 检测到文字中有自伤或自杀意图时，fata 不创建 Issue、不匹配、不记录——只展示心理援助资源。见 `modules/safety-handler.js`
- **High-risk text never enters the pool.** When AI detects self-harm signals, fata creates no Issue, makes no match, keeps no record — only shows support resources. See `modules/safety-handler.js`
- **通信在你自己的邮箱里。** fata 只发送一封通知邮件（通过 Resend），之后你们在各自的邮箱客户端里通信。fata 看不到你们的对话内容。见 `modules/resend-retry.js`
- **Communication happens in your own email.** fata sends only one notification (via Resend). After that, you talk in your email client. fata sees none of it. See `modules/resend-retry.js`
- **没有服务器。没有数据库。没有聊天记录。** fata 是一个静态 HTML 文件 + 一个 CF Worker 代理。没有东西可以被黑客拖库，没有聊天记录可以被法院调取
- **No servers. No database. No chat history.** fata is a static HTML file + one CF Worker proxy. There's nothing to hack, no chat logs to subpoena.

---

## 如何使用 / How it works

1. 打开 fata.uk / Open fata.uk
2. 写一段话——此刻在想什么，什么让你睡不着，窗外是什么颜色 / Write — what's on your mind, what keeps you up, the color outside your window
3. AI 分析你文字的"信号密度"和"情绪频率" / AI analyzes your text's signal density and emotional frequency
4. 如果文字不够丰富，fata 会温和地邀请你多写一点（不评判、不拒绝） / If your text is too brief, fata gently invites you to write more (no judgment, no rejection)
5. 文字加密存入匹配池 / Your encrypted text enters the matching pool
6. 找到匹配后，双方各自收到一封邮件——里面有对方的邮箱地址和一个破冰问题 / When matched, both sides get an email with the other's address and an icebreaker
7. 打开自己的邮箱客户端，写信给 TA / Open your email client and write to them

---

## 技术栈 / Tech stack

| 层 / Layer | 技术 / Tech | 运行位置 / Runs on |
|---|------|---------|
| AI inference | Transformers.js + bge-small-zh-v1.5 (24MB) | Browser (local) |
| Vector search | Orama | Browser (local) |
| Matching pool | GitHub Issues API | CF Worker proxy |
| Intent parsing | LLM API (optional, opt-in deep match) | CF Worker proxy |
| Email notification | Resend | CF Worker proxy |
| Communication | SMTP / IMAP | User's own email |

---

## 自己部署 / Self-host

fata 是一个静态 HTML 文件。你不需要服务器。

fata is a static HTML file. You don't need a server.

### 1. 准备工作 / Prerequisites

- GitHub 账号 / account（for Issues as matching pool）
- Cloudflare 账号 / account（for Worker proxy）
- Resend 账号 / account（for notification emails, 3,000/month free）
- 域名 / Domain（optional — Cloudflare Pages default domain works）

### 2. 初始化 GitHub Issues / Set up GitHub Issues

参考 `config/github-setup.md` 创建 Labels 和 Fine-grained PAT。

### 3. 配置 Cloudflare Worker / Configure Cloudflare Worker

```bash
# Copy the template
cp config/wrangler.toml.example config/wrangler.toml
# Edit wrangler.toml with your domain and GitHub username

# Create worker code (start from worker.example.js)
cp config/worker.example.js config/worker.js
# Edit worker.js, replace SYSTEM_PROMPTS with your prompt text

# Copy algorithm config
cp config/algorithm-config.example.json config/algorithm-config.json
# Edit algorithm-config.json with your parameter values

# Inject secrets
wrangler secret put GITHUB_PAT
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put HMAC_SECRET

# Deploy
wrangler deploy
```

### 4. 部署前端 / Deploy frontend

Deploy these files to Cloudflare Pages / GitHub Pages / any static host:

```
index.html
privacy.html
privacy-en.html
modules/model-loader.js
modules/safety-handler.js
modules/llm-fallback.js
modules/resend-retry.js
modules/low-signal-guide.js
modules/match-engine.js
config/algorithm-config.json
logo/logo.svg
manifest.json
```

---

## 开发哲学 / Design philosophy

- **异步优先 / Async-first.** 不推送、不显示在线状态、不即时通讯。把等待包装成期待。No push, no online status, no instant messaging. Waiting reframed as anticipation.
- **AI 隐身 / Invisible AI.** AI 读文字、做匹配、生成共鸣描述——然后退场。用户不知道 AI 的存在。AI reads, matches, generates a resonance description — then exits. The user never knows AI was there.
- **架构即隐私 / Architecture is privacy.** 不收集数据不是承诺，是架构。"We don't collect data" is not a promise — it's the architecture.
- **不注册公司、不备案、不建服务器 / No company, no ICP filing, no servers.** 三个人的团队是三个人，一个人的工具就是一个人的工具。A three-person team is three people. A one-person tool is one person.

---

## 许可 / License

MIT
