/**
 * fata English Seed Injector (Node.js)
 *
 * Injects 50 English seed texts into the matching pool via Worker API.
 * Uses word-bigram embeddings (matching the English fallback path).
 *
 * Usage: FATA_HMAC_KEY="<key>" node tools/inject-en-seeds.js
 */

const crypto = require('crypto');
const https = require('https');

const WORKER = 'https://worker.fata.uk';
const HMAC_KEY = process.env.FATA_HMAC_KEY || '';

const SEEDS = [
  // Loneliness (5)
  "I deleted all my dating apps last week and now I don't know how to meet anyone. It feels like everyone already has their people and I missed the window.",
  "Sometimes I go entire weekends without speaking to another person. Not because I want to, but because I don't know how to reach out anymore.",
  "I have hundreds of friends online but not one person I could call at 3am when I can't sleep and everything feels heavy.",
  "Being alone and being lonely are different things. I'm good at being alone. I'm not good at being lonely. Does that make sense?",
  "I moved to a new city six months ago and I still know exactly zero people here outside of work. How do adults even make friends?",
  // Burnout (5)
  "My therapist suggested I write more, so here I am. I'm not sure what to say. I've been running on empty for so long I forgot what full feels like.",
  "I keep telling everyone I'm fine but the truth is I'm exhausted in a way sleep can't fix. It's like my soul is tired.",
  "Work has been consuming everything. I wake up, work, eat at my desk, work more, collapse into bed. Rinse and repeat. When did my life become this?",
  "I took a mental health day today. Didn't tell anyone. Just sat in a park and watched dogs. It was the most peaceful I've felt in months.",
  "I used to be passionate about my career. Now I just feel numb. I don't know if it's the job or me or both.",
  // Existential questioning (5)
  "Sometimes I lie awake at 3am wondering if this is all there is. Wake up, work, eat, sleep, repeat. What's the point of any of it?",
  "I turned 30 last month and I feel like I'm supposed to have figured something out by now. But I haven't. I feel more lost than ever.",
  "Do you ever feel like you're watching your life from the outside? Like you're not really in it, just going through the motions?",
  "I keep thinking about the version of me that took the other path. The one who didn't play it safe. I wonder if she's happier.",
  "What if the life I'm living isn't the one I'm supposed to be living? What if I made a wrong turn somewhere and didn't notice?",
  // Creative longing (5)
  "I started learning piano at 32. My fingers don't do what I want them to do, but it's the first thing I've done just for myself in years.",
  "I used to write poetry in college. I found an old notebook yesterday and it made me cry. Not because it was good, but because I recognized that person.",
  "There's this painting I've been wanting to start for three years. The canvas is still blank. I'm scared it won't look the way I imagine it.",
  "I bought watercolors last weekend. I have no idea what I'm doing but for an hour I forgot about everything else. That felt like something.",
  "Sometimes I think my real self is buried under layers of being practical and responsible. I want to dig her out but I don't know how.",
  // Friendship drift (5)
  "All my friends are getting married and having kids and I feel like I'm on a completely different planet. I'm happy for them but I miss them.",
  "I realized today that I haven't seen my best friend in two years. We still text but it's not the same. When did we become strangers?",
  "I'm always the one who reaches out first. Always. If I stopped texting, I wonder how many people would notice. I'm scared to find out.",
  "There's this specific kind of loneliness that comes from being surrounded by people who don't really know you. It's almost worse than being alone.",
  "I miss having someone who just gets it without me having to explain. The kind of friend where silence isn't awkward.",
  // Heartbreak (5)
  "It's been four months and I still check my phone hoping it's them. I know it won't be. I check anyway. When does this stop?",
  "We weren't even together that long. So why does it still hurt? Why do I still think about them every single day?",
  "I saw them with someone new today. I smiled and said hi like everything was fine. Then I cried in my car for twenty minutes.",
  "The hardest part isn't missing them. It's missing the version of myself I was when I was with them. I liked that person better.",
  "I think I'm finally ready to let someone in again. Not to replace what I lost, but to build something new. That feels like progress.",
  // Daily small things (5)
  "I saw an old man feeding pigeons in the park today. He was talking to them like they were old friends. It made me cry for no reason.",
  "There's a coffee shop I go to every Sunday. The barista knows my order now. That tiny recognition is the highlight of my week.",
  "I found a four-leaf clover today. I don't believe in luck but I pressed it in a book anyway. Just in case.",
  "The light this morning was incredible. Golden and soft, like the world had been dipped in honey. I stood at my window for ten minutes just watching.",
  "I cooked myself a real meal tonight for the first time in weeks. Nothing fancy, just pasta. But I used the good olive oil. I think that counts for something.",
  // Self-discovery (5)
  "I quit my job three weeks ago. I don't have a plan. Everyone thinks I'm crazy. But for the first time in years, I feel free.",
  "I've been in therapy for six months now. Yesterday I caught myself setting a boundary without apologizing. I almost didn't recognize myself.",
  "I'm trying to figure out who I am when I'm not performing for anyone. No audience, no expectations, no resume. Just me. It's harder than I thought.",
  "Someone asked me what I like to do for fun and I didn't have an answer. That scared me. I've been so busy being productive I forgot how to play.",
  "I said no to something I didn't want to do today. It was such a small thing but it felt enormous. I'm learning that my time matters.",
  // Quiet hope (5)
  "I think maybe I'm ready to let someone in again. Not because I'm lonely, but because I have something to share now. That feels different.",
  "Spring is coming. I know it's just a season but it feels like a promise. Like maybe things can change. Like maybe I can change.",
  "There's this tiny plant on my windowsill that I've been keeping alive for three months. If I can do that, maybe I can do other things too.",
  "I had a genuinely good day today. Nothing special happened. I just felt okay. That's the first time I've said that in a while.",
  "I'm starting to believe that the best things happen slowly. That connection isn't something you force, it's something you make space for. I'm making space."
];

// English word-bigram embedding (384-dim, matching match-engine.js _wordBigramVector)
function wordBigramVector(text) {
  const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2) words.push('.');
  const bigrams = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bg = words[i] + '_' + words[i + 1];
    bigrams[bg] = (bigrams[bg] || 0) + 1;
  }
  const total = Object.values(bigrams).reduce((a, b) => a + b, 0) || 1;
  const dim = 384;
  const vec = new Array(dim).fill(0);
  for (const [bg, cnt] of Object.entries(bigrams)) {
    let h = 0;
    for (let i = 0; i < bg.length; i++) h = ((h << 5) - h + bg.charCodeAt(i)) | 0;
    vec[Math.abs(h) % dim] += cnt / total;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hmacSign(message, key) {
  return crypto.createHmac('sha256', key).update(message).digest('base64');
}

function encryptAES(plaintext) {
  const key = Buffer.from(HMAC_KEY, 'utf8').slice(0, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function buildHMACHeaders(endpoint) {
  const ts = String(Math.floor(Date.now() / 1000));
  const path = new URL(endpoint, WORKER).pathname;
  const msg = ts + ':' + path;
  const sig = hmacSign(msg, HMAC_KEY);
  return { 'X-Fata-Signature': sig, 'X-Fata-Timestamp': ts };
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
  console.log('fata English Seed Injector (Node.js)');
  console.log('Model: word-bigram (384-dim, en fallback)');
  console.log('Seeds: ' + SEEDS.length);
  console.log('');

  let ok = 0, fail = 0;

  for (let i = 0; i < SEEDS.length; i++) {
    const text = SEEDS[i];
    const emb = wordBigramVector(text);
    const embEncrypted = encryptAES(JSON.stringify(emb));
    const emailEncrypted = encryptAES('seed@fata.uk');
    const snippet = text.length > 80 ? text.slice(0, 80) : text;

    const body = JSON.stringify({
      e: embEncrypted,
      m: emailEncrypted,
      h: '',
      text_snippet: snippet,
      lang: 'en'
    });

    const endpoint = '/api/github/issues';
    const headers = {
      'Content-Type': 'application/json',
      ...buildHMACHeaders(endpoint)
    };

    try {
      const resp = await fetchJSON(WORKER + endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: '[Seed EN] ' + snippet.slice(0, 40),
          body,
          labels: ['seed', 'pending']
        })
      });

      if (resp.status === 201 || resp.status === 200) {
        ok++;
        console.log('  [' + (i + 1) + '/' + SEEDS.length + '] OK  #' + resp.data.number + '  "' + snippet.slice(0, 50) + '..."');
      } else {
        fail++;
        console.log('  [' + (i + 1) + '/' + SEEDS.length + '] FAIL  HTTP ' + resp.status);
      }
    } catch (e) {
      fail++;
      console.log('  [' + (i + 1) + '/' + SEEDS.length + '] ERROR  ' + e.message);
    }

    await sleep(500);
  }

  console.log('');
  console.log('Done. ' + ok + ' OK, ' + fail + ' failed.');
  process.exit(fail > 0 ? 1 : 0);
}

main();
