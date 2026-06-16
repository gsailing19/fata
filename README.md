<p align="center">
  <img src="logo/logo-horizontal.svg" alt="fata" width="240">
</p>

# fata

> *Fata viam invenient.* — Fate will find a way.

English | [中文](README_ZH.md)

---

You open a webpage, write a few lines. AI reads your words in the browser, finds another stranger whose frequency matches yours. Then you talk — using your **own email**.

## What is fata

fata is an open-source, serverless tool for meeting strangers through writing. AI runs entirely in your browser — it analyzes your text's emotional frequency, finds someone whose words resonate, and connects you. No sign-up. No database. No chat history. Communication happens in your own email.

fata 是一个开源的无服务器陌生人匹配工具。写一段话，浏览器里的 AI 分析你的文字情绪频率，找到另一个与你共振的人。无需注册，没有数据库，没有聊天记录。通信在你自己的邮箱里进行。

---

## Why trust fata

**fata *cannot* read your conversations — not "promises not to", it's technically incapable.**

- **Your words never leave your browser.** The AI model (Transformers.js + bge-small-zh-v1.5, 24MB) runs entirely locally. See `modules/model-loader.js`
- **The matching pool is public GitHub Issues.** Your encrypted text waits in an Issue. When matched, the Issue closes. Like a padlocked box on a public bulletin board — and the padlock key never leaves the server. See `config/github-setup.md`
- **High-risk text never enters the pool.** When AI detects self-harm signals, fata creates no Issue, makes no match, keeps no record — only shows support resources. See `modules/safety-handler.js`
- **Communication happens in your own email.** fata sends only one notification (via Resend). After that, you talk in your email client. fata sees none of it. See `modules/resend-retry.js`
- **No servers. No database. No chat history.** fata is a static HTML file + one CF Worker proxy. There's nothing to hack, no chat logs to subpoena.

---

## How it works

1. Open fata.uk
2. Write — what's on your mind, what keeps you up, the color outside your window
3. AI analyzes your text's signal density and emotional frequency
4. If your text is too brief, fata gently invites you to write more (no judgment, no rejection)
5. Your encrypted text enters the matching pool
6. When matched, both sides get an email with the other's address and an icebreaker
7. Open your email client and write to them

---

## Tech stack

| Layer | Tech | Runs on |
|---|------|---------|
| AI inference | Transformers.js + bge-small-zh-v1.5 (24MB) | Browser (local) |
| Matching engine | Multi-channel scoring + MMR re-rank | CF Worker |
| Matching pool | GitHub Issues API | CF Worker proxy |
| Intent parsing | LLM API (optional, opt-in deep match) | CF Worker proxy |
| Email notification | Resend | CF Worker proxy |
| Communication | SMTP / IMAP | User's own email |

---

## Self-host

fata is a static HTML file. You don't need a server.

### 1. Prerequisites

- GitHub account (for Issues as matching pool)
- Cloudflare account (for Worker proxy)
- Resend account (for notification emails, 3,000/month free)
- Domain (optional — Cloudflare Pages default domain works)

### 2. Set up GitHub Issues

See `config/github-setup.md` for creating Labels and Fine-grained PAT.

### 3. Configure Cloudflare Worker

```bash
cp config/wrangler.toml.example config/wrangler.toml
# Edit wrangler.toml with your domain and GitHub username

cp config/worker.example.js config/worker.js
# Edit worker.js, replace SYSTEM_PROMPTS with your prompt text

cp config/algorithm-config.example.json config/algorithm-config.json
# Edit algorithm-config.json with your parameter values

# Inject secrets
wrangler secret put GITHUB_PAT
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put HMAC_KEY
wrangler secret put ENCRYPTION_KEY

# Deploy
cd config && npx wrangler deploy
```

### 4. Deploy frontend

```bash
./deploy.sh
```

This copies only public files to `dist/` and deploys to Cloudflare Pages. The full list:

```
index.html  privacy.html  privacy-en.html
modules/*.js  (6 files: model-loader, safety-handler, llm-fallback, resend-retry, low-signal-guide, match-engine)
logo/logo.svg  logo/logo-unified-v2.png  logo/logo-horizontal.svg
manifest.json  _redirects  _headers
```

---

## Design philosophy

- **Async-first.** No push, no online status, no instant messaging. Waiting reframed as anticipation.
- **Invisible AI.** AI reads, matches, generates a resonance description — then exits. The user never knows AI was there.
- **Architecture is privacy.** "We don't collect data" is not a promise — it's the architecture.
- **No company, no ICP filing, no servers.** A three-person team is three people. A one-person tool is one person.

---

## License

MIT
