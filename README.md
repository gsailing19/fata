# fata — 找到文字频率最接近的陌生人

> fata = fate（命运）+ data（数据）。Fata viam invenient — 命运会找到出路。

你打开一个网页，写一段话。AI 在浏览器里读懂你的文字，帮你找到另一个频率最接近的陌生人。然后你们用**各自的邮箱**通信。

---

## 为什么可以信任 fata

**fata 没有办法偷看你的对话——不是"承诺不偷看"，是技术上做不到。**

- **你的文字不出浏览器。** AI 模型（Transformers.js + bge-small-zh-v1.5, 24MB）在你的浏览器里纯本地运行。见 `modules/model-loader.js`
- **文字池是公开的 GitHub Issues。** 你的文字加密后存入 Issue 等待匹配，匹配成功后 Issue 关闭。像公共公告板上的密码锁盒子。见 `config/github-setup.md`
- **高危文字不进入匹配池。** 当 AI 检测到文字中有自伤或自杀意图时，fata 不创建 Issue、不匹配、不记录——只展示心理援助资源。你可以在 `modules/safety-handler.js` 中审查这段逻辑
- **通信在你自己的邮箱里。** fata 只发送一封通知邮件（通过 Resend），之后你们在各自的邮箱客户端里通信。fata 看不到你们的对话内容。见 `modules/resend-retry.js`
- **没有服务器。没有数据库。没有聊天记录。** fata 是一个静态 HTML 文件 + 一个 CF Worker 代理。没有东西可以被黑客拖库，没有聊天记录可以被法院调取

---

## 如何使用

1. 打开 fata.uk
2. 写一段话——此刻在想什么，什么让你睡不着，窗外是什么颜色
3. AI 分析你文字的"信号密度"和"情绪频率"
4. 如果文字不够丰富，fata 会温和地邀请你多写一点（不评判、不拒绝）
5. 文字加密存入匹配池
6. 找到匹配后，双方各自收到一封邮件——里面有对方的邮箱地址和一个破冰问题
7. 打开自己的邮箱客户端，写信给 TA

---

## 技术栈

| 层 | 技术 | 运行位置 |
|---|------|---------|
| AI 推理 | Transformers.js + bge-small-zh-v1.5 (24MB) | 浏览器本地 |
| 向量搜索 | Orama | 浏览器本地 |
| 文字池 | GitHub Issues API | CF Worker 代理 |
| 意图解析 | LLM API（可选，用户可选择快速匹配） | CF Worker 代理 |
| 邮件通知 | Resend | CF Worker 代理 |
| 通信 | SMTP / IMAP | 用户自己的邮箱 |

---

## 自己部署

fata 是一个静态 HTML 文件。你不需要服务器。

### 1. 准备工作

- GitHub 账号（用于 Issues 作为文字池）
- Cloudflare 账号（用于 Worker 代理）
- Resend 账号（用于发送通知邮件，3000 封/月免费）
- 域名（可选，Cloudflare Pages 默认域名也可用）

### 2. 初始化 GitHub Issues

参考 `config/github-setup.md` 创建 Labels 和 Fine-grained PAT。

### 3. 配置 Cloudflare Worker

```bash
# 复制模板
cp config/wrangler.toml.example config/wrangler.toml
# 编辑 wrangler.toml，填入你的域名和 GitHub 用户名

# 创建 Worker 代码（从 worker.example.js 出发，填入你的 system prompt）
cp config/worker.example.js config/worker.js
# 编辑 worker.js，修改 SYSTEM_PROMPTS 为你的 prompt 文本

# 复制算法配置
cp config/algorithm-config.example.json config/algorithm-config.json
# 编辑 algorithm-config.json，填入你的参数值

# 注入密钥
wrangler secret put GITHUB_PAT
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put HMAC_SECRET

# 部署
wrangler deploy
```

### 4. 部署前端

将以下文件部署到 Cloudflare Pages / GitHub Pages / 任何静态托管：

```
index.html
modules/model-loader.js
modules/safety-handler.js
modules/llm-fallback.js
modules/resend-retry.js
modules/low-signal-guide.js
config/algorithm-config.json
```

---

## 开发哲学

- **异步优先。** 不推送、不显示在线状态、不即时通讯。把等待包装成期待
- **AI 隐身。** AI 读文字、做匹配、生成共鸣描述——然后退场。用户不知道 AI 的存在
- **架构即隐私。** 不收集数据不是承诺，是架构
- **不注册公司、不备案、不建服务器。** 三个人的团队是三个人，一个人的工具就是一个人的工具

---

## 许可

MIT
