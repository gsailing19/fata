<p align="center">
  <img src="logo/logo-horizontal.svg" alt="fata" width="240">
</p>

# fata

> *Fata viam invenient.* — Fate will find a way.

**[fata.uk](https://fata.uk)** — open a webpage, write a few lines, find a stranger whose emotional frequency matches yours. Then talk in your **own email**. No app. No signup. No server.

---

## What is fata

fata matches strangers by emotional frequency, not by photos or tags. You write what's on your mind. A signal heuristic in your browser scores your text instantly. A Cloudflare Worker generates a BGE-M3 embedding, encrypts it, and finds your match in the pool. Matched users get each other's email address. Communication happens entirely in your own inbox — fata never touches your messages.

**fata = fate + data.** Two strangers meeting — part AI matching, part serendipity.

---

## Why people trust fata

**fata *cannot* read your conversations — not "promises not to", it's technically incapable.**

- **Your text is encrypted before it enters the pool.** AES-GCM with key separation (HMAC_KEY ≠ ENCRYPTION_KEY). Even if GitHub Issues leak, ciphertext is useless.
- **Zero public inference endpoints.** LLM calls are Worker-internal only. There is no `/api/llm` route. Model API abuse is prevented by design.
- **PoW + session-bound token auth.** Every submission requires solving a SHA-256 challenge. Tokens are single-use, IP-bound, and expire. Rate limits are fail-closed.
- **Communication stays in your email.** fata sends one notification (via Resend), hands over the matched email address, and exits. No chat server. No database of messages.
- **The architecture is the privacy policy.** Static HTML + Cloudflare Pages + GitHub Issues as encrypted pool. There's nothing to hack, no database to subpoena, no logs to leak.

[Security incident report](INCIDENT-2026-06-20.md) · [Prevention rules](SECURITY-PREVENTION.md) · [Daily audit](tools/audit.js)

---

## How it works

```
You write text
  → Safety check (browser-side)
  → Signal density score (browser heuristic, sub-millisecond)
  → PoW challenge → session token
  → Worker: BGE-M3 embedding (1024-dim) via SiliconFlow
  → AES-GCM encrypt → GitHub Issues pool
  → Multi-channel scoring + MMR diversity rerank
  → Match found: close both Issues, generate resonance via LLM, email via Resend
  → You talk in your own inbox
```

- **First visit**: ~100ms (no model download)
- **Matching**: Chinese F1=94.1% / English F1=80.0% (see [algo tests](tools/algo-test.js))
- **Invariants**: 54/54 assertions pass (see [invariant tests](tools/invariant-tests.js))

---

## Tech stack

| Layer | Tech | Where |
|---|------|--------|
| Signal density + intent parse | Heuristic engine | Browser (instant) |
| Semantic embedding | BGE-M3 (SiliconFlow API) | CF Worker |
| Matching algorithm | Multi-channel scoring + MMR | CF Worker |
| Encrypted storage | AES-GCM + GitHub Issues | CF Worker proxy |
| Resonance description | DeepSeek-V4 (Worker-internal) | CF Worker |
| Email delivery | Resend (3,000/month free) | CF Worker proxy |
| Auth + anti-abuse | PoW + token + HMAC + rate limit KV | CF Worker |
| Frontend | Single static HTML + vanilla JS | Cloudflare Pages |

Zero browser model download. Zero public API keys. Zero user database.

---

## Self-host

fata is a single static HTML file + one Cloudflare Worker.

### Prerequisites

- GitHub account (Issues as matching pool)
- Cloudflare account (Workers + Pages + KV)
- Resend account (email delivery, free tier 3,000/month)
- SiliconFlow account (BGE-M3 embeddings)

### Quick start

```bash
# 1. Set up GitHub labels & PAT
#    See config/github-setup.md

# 2. Configure and deploy Worker
cd config
cp wrangler.toml.example wrangler.toml   # Edit with your repo details
npx wrangler secret put GITHUB_PAT
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SILICONFLOW_API_KEY
npx wrangler secret put HMAC_KEY
npx wrangler secret put ENCRYPTION_KEY
npx wrangler deploy

# 3. Deploy frontend
./deploy.sh
```

---

## Design philosophy

- **Async-first.** No push. No online status. No instant messaging. Waiting is anticipation.
- **AI as bridge, not companion.** AI reads, matches, describes resonance — then exits. You never see a chatbot.
- **Architecture is privacy.** "We don't collect data" is a fact about the architecture, not a promise.
- **Email is the product.** No in-app chat. Communication returns to the most universal, private tool you already own.

---

## What people are saying

"Like Slowly but with AI that actually reads your words" · "The anti-Omegle — slow, thoughtful, asynchronous" · "A webpage that introduces you to someone and then disappears"

---

## License

MIT
