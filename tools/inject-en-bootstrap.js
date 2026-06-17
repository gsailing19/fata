/**
 * fata English Bootstrap Injector
 *
 * Injects 20 English bootstrap texts as pure `pending` (NOT `seed`)
 * with intent profiles, so they participate in matching.
 * This bootstraps the English matching pool for cold start.
 *
 * Usage: FATA_HMAC_KEY="<key>" node tools/inject-en-bootstrap.js
 */

const crypto = require('crypto');
const https = require('https');

const WORKER = 'https://worker.fata.uk';
const HMAC_KEY = process.env.FATA_HMAC_KEY || '';

// 20 seeds covering diverse needs, emotions, styles
const BOOTSTRAPS = [
  // --- be heard / loneliness ---
  {
    text: "I moved to a new city a few months ago for work and still haven't found my people here. The loneliness gets heavy at night when I'm just sitting with my thoughts. I'm not looking for advice — I just need someone to genuinely hear me out without judgment.",
    intent: { need: "be heard", emo: "lonely", topics: ["loneliness", "moving", "belonging"], style: "serious", expect: "listening", depth: "deep", signalDensity: 0.85 }
  },
  {
    text: "Sometimes I go entire weekends without speaking to another person. Not because I want to, but because I don't know how to reach out anymore. I have hundreds of friends online but not one person I could call when things feel heavy.",
    intent: { need: "be heard", emo: "lonely", topics: ["isolation", "friendship", "vulnerability"], style: "serious", expect: "being heard", depth: "deep", signalDensity: 0.80 }
  },
  {
    text: "I keep telling everyone I'm fine but the truth is I'm exhausted in a way sleep can't fix. It's like my soul is tired. I've been running on empty for so long I forgot what full feels like.",
    intent: { need: "be heard", emo: "exhausted", topics: ["burnout", "mental health", "masking"], style: "serious", expect: "empathy", depth: "deep", signalDensity: 0.82 }
  },
  {
    text: "It's been four months and I still check my phone hoping it's them. I know it won't be. I check anyway. When does this stop? The hardest part isn't missing them — it's missing the version of myself I was when I was with them.",
    intent: { need: "be heard", emo: "sad", topics: ["heartbreak", "healing", "self-worth"], style: "serious", expect: "acknowledgment", depth: "deep", signalDensity: 0.88 }
  },
  // --- listen to others ---
  {
    text: "I've always been the person my friends turn to when life gets heavy. There's something deeply meaningful about being fully present for someone — no advice, no fixing things, just listening with an open heart. If you need that kind of space, I'm here.",
    intent: { need: "listen to others", emo: "warm", topics: ["listening", "support", "presence"], style: "responsive", expect: "being there", depth: "deep", signalDensity: 0.78 }
  },
  {
    text: "I find real meaning in holding space for people who are going through hard times. Not trying to solve anything — just being a witness. I think we underestimate how healing it is to feel truly heard by another person.",
    intent: { need: "listen to others", emo: "calm", topics: ["healing", "witnessing", "empathy"], style: "responsive", expect: "holding space", depth: "deep", signalDensity: 0.75 }
  },
  // --- give advice ---
  {
    text: "I've been through a career change, a cross-country move, and a pretty brutal burnout — and came out the other side. If you're in the middle of something hard and could use perspective from someone who's been there, I'm happy to share what I learned.",
    intent: { need: "give advice", emo: "hopeful", topics: ["career", "resilience", "growth"], style: "active", expect: "sharing experience", depth: "medium", signalDensity: 0.72 }
  },
  {
    text: "I quit my corporate job two years ago to do something completely different. It was terrifying and the best decision I ever made. If you're standing at a crossroads trying to figure out which way to go, I might have some useful thoughts.",
    intent: { need: "give advice", emo: "excited", topics: ["career change", "risk", "purpose"], style: "active", expect: "guidance", depth: "medium", signalDensity: 0.74 }
  },
  // --- get advice ---
  {
    text: "I turned 30 last month and I feel like I'm supposed to have figured something out by now. But I haven't. I feel more lost than ever. If anyone has navigated this kind of quarter-life identity crisis, I'd love to hear how you got through it.",
    intent: { need: "get advice", emo: "lost", topics: ["identity", "aging", "life direction"], style: "serious", expect: "guidance", depth: "deep", signalDensity: 0.80 }
  },
  {
    text: "I'm thinking about leaving my stable job to pursue something more creative, but everyone in my life thinks it's a terrible idea. I don't know if I'm being brave or stupid. Would love to hear from someone who's made a similar leap.",
    intent: { need: "get advice", emo: "anxious", topics: ["career", "risk", "creativity"], style: "serious", expect: "real talk", depth: "medium", signalDensity: 0.76 }
  },
  // --- find resonance / creative ---
  {
    text: "I started learning piano at 32. My fingers don't do what I want them to do, but it's the first thing I've done just for myself in years. There's something about making music — even bad music — that reminds me I'm human.",
    intent: { need: "find resonance", emo: "hopeful", topics: ["creativity", "music", "self-discovery"], style: "playful", expect: "shared joy", depth: "medium", signalDensity: 0.70 }
  },
  {
    text: "I used to write poetry in college. I found an old notebook yesterday and it made me cry — not because it was good, but because I recognized that person. I want to find my way back to being someone who makes things, not just someone who gets things done.",
    intent: { need: "find resonance", emo: "warm", topics: ["creativity", "writing", "identity"], style: "serious", expect: "mutual understanding", depth: "deep", signalDensity: 0.82 }
  },
  // --- deep discussion ---
  {
    text: "I've been thinking a lot about what it means to live a good life — not a successful one, a good one. I think they might be different things. Would love to talk with someone who also sits with these kinds of questions.",
    intent: { need: "deep discussion", emo: "curious", topics: ["philosophy", "meaning", "values"], style: "serious", expect: "exploration", depth: "deep", signalDensity: 0.73 }
  },
  {
    text: "Sometimes I lie awake wondering if we're all just performing for each other. Social media, work, even friendships — how much of it is real and how much is a script we've learned? I want to have conversations that go beneath the surface.",
    intent: { need: "deep discussion", emo: "curious", topics: ["authenticity", "society", "connection"], style: "serious", expect: "deep dialogue", depth: "deep", signalDensity: 0.78 }
  },
  // --- casual chat / daily joy ---
  {
    text: "I saw an old man feeding pigeons in the park today. He was talking to them like they were old friends. It made me smile for the first time all week. Sometimes the smallest things are the most human.",
    intent: { need: "casual chat", emo: "warm", topics: ["daily life", "small joys", "humanity"], style: "playful", expect: "shared moment", depth: "surface", signalDensity: 0.65 }
  },
  {
    text: "I cooked myself a real meal tonight for the first time in weeks. Nothing fancy, just pasta. But I used the good olive oil. I think that counts for something. Small victories, right?",
    intent: { need: "casual chat", emo: "lighthearted", topics: ["cooking", "self-care", "small wins"], style: "playful", expect: "light conversation", depth: "surface", signalDensity: 0.60 }
  },
  // --- self-discovery ---
  {
    text: "I said no to something I didn't want to do today. It was such a small thing but it felt enormous. I'm learning that my time matters and that I don't have to earn rest. That's a new thought for me.",
    intent: { need: "find resonance", emo: "hopeful", topics: ["boundaries", "growth", "self-worth"], style: "serious", expect: "encouragement", depth: "medium", signalDensity: 0.72 }
  },
  {
    text: "Someone asked me what I like to do for fun and I didn't have an answer. That scared me. I've been so busy being productive I forgot how to play. I'm trying to remember what brings me joy — it's harder than I thought.",
    intent: { need: "be heard", emo: "lost", topics: ["identity", "play", "work-life balance"], style: "serious", expect: "understanding", depth: "medium", signalDensity: 0.75 }
  },
  // --- quiet hope ---
  {
    text: "There's this tiny plant on my windowsill that I've been keeping alive for three months. If I can do that, maybe I can do other things too. Maybe growth is slow and quiet and doesn't need to be announced.",
    intent: { need: "find resonance", emo: "hopeful", topics: ["growth", "patience", "small joys"], style: "playful", expect: "shared hope", depth: "medium", signalDensity: 0.68 }
  },
  {
    text: "I'm starting to believe that the best things happen slowly. That connection isn't something you force — it's something you make space for. I'm making space. That feels like a promise I'm making to myself.",
    intent: { need: "find resonance", emo: "calm", topics: ["patience", "connection", "hope"], style: "serious", expect: "quiet understanding", depth: "medium", signalDensity: 0.70 }
  }
];

// English word-bigram embedding (384-dim)
function wordBigramVector(text) {
  const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2) words.push('.');
  const bigrams = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bg = words[i] + '_' + words[i + 1];
    bigrams[bg] = (bigrams[bg] || 0) + 1;
  }
  const total = Object.values(bigrams).reduce((a, b) => a + b, 0) || 1;
  const vec = new Array(384).fill(0);
  for (const [bg, cnt] of Object.entries(bigrams)) {
    let h = 0;
    for (let i = 0; i < bg.length; i++) h = ((h << 5) - h + bg.charCodeAt(i)) | 0;
    vec[Math.abs(h) % 384] += cnt / total;
  }
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < 384; i++) vec[i] /= norm;
  return vec;
}

function encryptAES(plaintext) {
  const key = Buffer.from(HMAC_KEY, 'utf8').slice(0, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hmacSign(message, key) {
  return crypto.createHmac('sha256', key).update(message).digest('base64');
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(urlObj, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('fata English Bootstrap Injector');
  console.log('Model: word-bigram (384-dim) + intent profiles');
  console.log('Labels: pending only (no seed — will participate in matching)');
  console.log('Count: ' + BOOTSTRAPS.length);
  console.log('');

  let ok = 0, fail = 0;

  for (let i = 0; i < BOOTSTRAPS.length; i++) {
    const { text, intent } = BOOTSTRAPS[i];
    const emb = wordBigramVector(text);
    const email = 'bootstrap-' + (i + 1) + '@fata.uk';
    const emailHash = sha256(email);
    const snippet = text.length > 80 ? text.slice(0, 80) : text;

    const body = {
      l: 'en',
      e: encryptAES(JSON.stringify(emb)),
      m: encryptAES(email),
      h: emailHash,
      i: encryptAES(JSON.stringify(intent)),
      text_snippet: snippet,
      allow_snippet: true
    };

    const endpoint = '/api/github/issues';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = hmacSign(ts + ':' + new URL(endpoint, WORKER).pathname, HMAC_KEY);
    const headers = {
      'Content-Type': 'application/json',
      'X-Fata-Signature': sig,
      'X-Fata-Timestamp': ts
    };

    try {
      const resp = await fetchJSON(WORKER + endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: '[EN] ' + snippet.slice(0, 50),
          body: JSON.stringify(body),
          labels: ['pending']  // NO seed label — these participate in matching
        })
      });

      if (resp.status === 201 || resp.status === 200) {
        ok++;
        const need = intent.need.slice(0, 12);
        console.log('  [' + (i + 1) + '/' + BOOTSTRAPS.length + '] OK  #' + resp.data.number + '  need=' + need + '  "' + snippet.slice(0, 45) + '..."');
      } else {
        fail++;
        console.log('  [' + (i + 1) + '/' + BOOTSTRAPS.length + '] FAIL  HTTP ' + resp.status + ' — ' + JSON.stringify(resp.data).slice(0, 100));
      }
    } catch (e) {
      fail++;
      console.log('  [' + (i + 1) + '/' + BOOTSTRAPS.length + '] ERROR  ' + e.message);
    }

    await sleep(2500); // rate limit: 30 req/min → ~2.5s apart
  }

  console.log('');
  console.log('Done. ' + ok + ' OK, ' + fail + ' failed.');
  process.exit(fail > 0 ? 1 : 0);
}

main();
