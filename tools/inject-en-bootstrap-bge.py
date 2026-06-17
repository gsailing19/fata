"""
fata English Bootstrap Injector — with REAL BGE-small-en embeddings

Uses sentence-transformers (BAAI/bge-small-en-v1.5) to generate embeddings
that are IDENTICAL to what the browser's Transformers.js produces.
This ensures cross-type embedding matching between seeds and real users.

Usage: python3 tools/inject-en-bootstrap-bge.py
Requires: FATA_HMAC_KEY env var (fetched automatically from API)
"""

import json, hashlib, hmac, base64, time, os, sys, struct
import urllib.request
import ssl

WORKER = "https://worker.fata.uk"

# 20 bootstrap texts with intent profiles (same as inject-en-bootstrap.js)
BOOTSTRAPS = [
    {
        "text": "I moved to a new city a few months ago for work and still haven't found my people here. The loneliness gets heavy at night when I'm just sitting with my thoughts. I'm not looking for advice — I just need someone to genuinely hear me out without judgment.",
        "intent": {"need": "be heard", "emo": "lonely", "topics": ["loneliness", "moving", "belonging"], "style": "serious", "expect": "listening", "depth": "deep", "signalDensity": 0.85}
    },
    {
        "text": "Sometimes I go entire weekends without speaking to another person. Not because I want to, but because I don't know how to reach out anymore. I have hundreds of friends online but not one person I could call when things feel heavy.",
        "intent": {"need": "be heard", "emo": "lonely", "topics": ["isolation", "friendship", "vulnerability"], "style": "serious", "expect": "being heard", "depth": "deep", "signalDensity": 0.80}
    },
    {
        "text": "I keep telling everyone I'm fine but the truth is I'm exhausted in a way sleep can't fix. It's like my soul is tired. I've been running on empty for so long I forgot what full feels like.",
        "intent": {"need": "be heard", "emo": "exhausted", "topics": ["burnout", "mental health", "masking"], "style": "serious", "expect": "empathy", "depth": "deep", "signalDensity": 0.82}
    },
    {
        "text": "It's been four months and I still check my phone hoping it's them. I know it won't be. I check anyway. When does this stop? The hardest part isn't missing them — it's missing the version of myself I was when I was with them.",
        "intent": {"need": "be heard", "emo": "sad", "topics": ["heartbreak", "healing", "self-worth"], "style": "serious", "expect": "acknowledgment", "depth": "deep", "signalDensity": 0.88}
    },
    {
        "text": "I've always been the person my friends turn to when life gets heavy. There's something deeply meaningful about being fully present for someone — no advice, no fixing things, just listening with an open heart. If you need that kind of space, I'm here.",
        "intent": {"need": "listen to others", "emo": "warm", "topics": ["listening", "support", "presence"], "style": "responsive", "expect": "being there", "depth": "deep", "signalDensity": 0.78}
    },
    {
        "text": "I find real meaning in holding space for people who are going through hard times. Not trying to solve anything — just being a witness. I think we underestimate how healing it is to feel truly heard by another person.",
        "intent": {"need": "listen to others", "emo": "calm", "topics": ["healing", "witnessing", "empathy"], "style": "responsive", "expect": "holding space", "depth": "deep", "signalDensity": 0.75}
    },
    {
        "text": "I've been through a career change, a cross-country move, and a pretty brutal burnout — and came out the other side. If you're in the middle of something hard and could use perspective from someone who's been there, I'm happy to share what I learned.",
        "intent": {"need": "give advice", "emo": "hopeful", "topics": ["career", "resilience", "growth"], "style": "active", "expect": "sharing experience", "depth": "medium", "signalDensity": 0.72}
    },
    {
        "text": "I quit my corporate job two years ago to do something completely different. It was terrifying and the best decision I ever made. If you're standing at a crossroads trying to figure out which way to go, I might have some useful thoughts.",
        "intent": {"need": "give advice", "emo": "excited", "topics": ["career change", "risk", "purpose"], "style": "active", "expect": "guidance", "depth": "medium", "signalDensity": 0.74}
    },
    {
        "text": "I turned 30 last month and I feel like I'm supposed to have figured something out by now. But I haven't. I feel more lost than ever. If anyone has navigated this kind of quarter-life identity crisis, I'd love to hear how you got through it.",
        "intent": {"need": "get advice", "emo": "lost", "topics": ["identity", "aging", "life direction"], "style": "serious", "expect": "guidance", "depth": "deep", "signalDensity": 0.80}
    },
    {
        "text": "I'm thinking about leaving my stable job to pursue something more creative, but everyone in my life thinks it's a terrible idea. I don't know if I'm being brave or stupid. Would love to hear from someone who's made a similar leap.",
        "intent": {"need": "get advice", "emo": "anxious", "topics": ["career", "risk", "creativity"], "style": "serious", "expect": "real talk", "depth": "medium", "signalDensity": 0.76}
    },
    {
        "text": "I started learning piano at 32. My fingers don't do what I want them to do, but it's the first thing I've done just for myself in years. There's something about making music — even bad music — that reminds me I'm human.",
        "intent": {"need": "find resonance", "emo": "hopeful", "topics": ["creativity", "music", "self-discovery"], "style": "playful", "expect": "shared joy", "depth": "medium", "signalDensity": 0.70}
    },
    {
        "text": "I used to write poetry in college. I found an old notebook yesterday and it made me cry — not because it was good, but because I recognized that person. I want to find my way back to being someone who makes things, not just someone who gets things done.",
        "intent": {"need": "find resonance", "emo": "warm", "topics": ["creativity", "writing", "identity"], "style": "serious", "expect": "mutual understanding", "depth": "deep", "signalDensity": 0.82}
    },
    {
        "text": "I've been thinking a lot about what it means to live a good life — not a successful one, a good one. I think they might be different things. Would love to talk with someone who also sits with these kinds of questions.",
        "intent": {"need": "deep discussion", "emo": "curious", "topics": ["philosophy", "meaning", "values"], "style": "serious", "expect": "exploration", "depth": "deep", "signalDensity": 0.73}
    },
    {
        "text": "Sometimes I lie awake wondering if we're all just performing for each other. Social media, work, even friendships — how much of it is real and how much is a script we've learned? I want to have conversations that go beneath the surface.",
        "intent": {"need": "deep discussion", "emo": "curious", "topics": ["authenticity", "society", "connection"], "style": "serious", "expect": "deep dialogue", "depth": "deep", "signalDensity": 0.78}
    },
    {
        "text": "I saw an old man feeding pigeons in the park today. He was talking to them like they were old friends. It made me smile for the first time all week. Sometimes the smallest things are the most human.",
        "intent": {"need": "casual chat", "emo": "warm", "topics": ["daily life", "small joys", "humanity"], "style": "playful", "expect": "shared moment", "depth": "surface", "signalDensity": 0.65}
    },
    {
        "text": "I cooked myself a real meal tonight for the first time in weeks. Nothing fancy, just pasta. But I used the good olive oil. I think that counts for something. Small victories, right?",
        "intent": {"need": "casual chat", "emo": "lighthearted", "topics": ["cooking", "self-care", "small wins"], "style": "playful", "expect": "light conversation", "depth": "surface", "signalDensity": 0.60}
    },
    {
        "text": "I said no to something I didn't want to do today. It was such a small thing but it felt enormous. I'm learning that my time matters and that I don't have to earn rest. That's a new thought for me.",
        "intent": {"need": "find resonance", "emo": "hopeful", "topics": ["boundaries", "growth", "self-worth"], "style": "serious", "expect": "encouragement", "depth": "medium", "signalDensity": 0.72}
    },
    {
        "text": "Someone asked me what I like to do for fun and I didn't have an answer. That scared me. I've been so busy being productive I forgot how to play. I'm trying to remember what brings me joy — it's harder than I thought.",
        "intent": {"need": "be heard", "emo": "lost", "topics": ["identity", "play", "work-life balance"], "style": "serious", "expect": "understanding", "depth": "medium", "signalDensity": 0.75}
    },
    {
        "text": "There's this tiny plant on my windowsill that I've been keeping alive for three months. If I can do that, maybe I can do other things too. Maybe growth is slow and quiet and doesn't need to be announced.",
        "intent": {"need": "find resonance", "emo": "hopeful", "topics": ["growth", "patience", "small joys"], "style": "playful", "expect": "shared hope", "depth": "medium", "signalDensity": 0.68}
    },
    {
        "text": "I'm starting to believe that the best things happen slowly. That connection isn't something you force — it's something you make space for. I'm making space. That feels like a promise I'm making to myself.",
        "intent": {"need": "find resonance", "emo": "calm", "topics": ["patience", "connection", "hope"], "style": "serious", "expect": "quiet understanding", "depth": "medium", "signalDensity": 0.70}
    }
]


def get_hmac_key():
    """Fetch HMAC key from env var or Worker API."""
    key = os.environ.get('FATA_HMAC_KEY', '')
    if key:
        return key
    ctx = ssl.create_default_context()
    req = urllib.request.Request(f"{WORKER}/api/hmac-key", headers={'User-Agent': 'fata-bootstrap/1.0'})
    with urllib.request.urlopen(req, context=ctx) as resp:
        return json.loads(resp.read())["hmac_key"]


def encrypt_aes(plaintext, hmac_key):
    """AES-256-GCM encrypt, matching browser encryptData()."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import os as _os
    key = hmac_key.encode('utf-8')[:32]
    iv = _os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, plaintext.encode('utf-8'), None)
    # ciphertext includes the 16-byte auth tag at the end
    return base64.b64encode(iv + ciphertext).decode('ascii')


def sha256(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def hmac_sign(message, key):
    return base64.b64encode(
        hmac.new(key.encode('utf-8'), message.encode('utf-8'), hashlib.sha256).digest()
    ).decode('ascii')


def fetch_json(url, method='GET', headers=None, body=None):
    ctx = ssl.create_default_context()
    data = body.encode('utf-8') if body else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, context=ctx) as resp:
        return resp.status, json.loads(resp.read())


def main():
    print("Loading BGE-small-en-v1.5 model...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("BAAI/bge-small-en-v1.5")
    print("  Model loaded. dim=" + str(model.get_sentence_embedding_dimension()))

    print("Fetching HMAC key...")
    hmac_key = get_hmac_key()
    print(f"  Got key (len={len(hmac_key)})")

    print(f"\nGenerating embeddings for {len(BOOTSTRAPS)} bootstrap texts...")
    texts = [b["text"] for b in BOOTSTRAPS]
    embeddings = model.encode(texts, normalize_embeddings=True)
    print(f"  Generated {len(embeddings)} embeddings, dim={embeddings[0].shape[0]}")

    # Close old bootstrap issues (#294-#313)
    print("\nClosing old bootstrap issues (#294-#313)...")
    closed = 0
    for num in range(294, 314):
        try:
            ts = str(int(time.time()))
            endpoint = f"/api/github/issues/{num}"
            sig = hmac_sign(f"{ts}:{endpoint}", hmac_key)
            status, _ = fetch_json(
                f"{WORKER}{endpoint}",
                method='PATCH',
                headers={
                    'Content-Type': 'application/json',
                    'X-Fata-Signature': sig,
                    'X-Fata-Timestamp': ts
                },
                body=json.dumps({"state": "closed"})
            )
            if status == 200:
                closed += 1
                print(f"  Closed #{num}")
        except Exception as e:
            print(f"  Skip #{num}: {e}")
    print(f"  Closed {closed}/20 old issues")

    # Inject new bootstrap issues with BGE embeddings
    print("\nInjecting new bootstrap issues with BGE embeddings...")
    ok, fail = 0, 0

    for i, (b, emb) in enumerate(zip(BOOTSTRAPS, embeddings)):
        text = b["text"]
        intent = b["intent"]
        email = f"bootstrap-{i+1}@fata.uk"
        email_hash = sha256(email)
        snippet = text[:80] if len(text) > 80 else text

        # Use the same encryption as the browser: HMAC_KEY based AES-256-GCM
        enc_emb = encrypt_aes(json.dumps(emb.tolist()), hmac_key)
        enc_email = encrypt_aes(email, hmac_key)
        enc_intent = encrypt_aes(json.dumps(intent), hmac_key)

        body = json.dumps({
            "l": "en",
            "e": enc_emb,
            "m": enc_email,
            "h": email_hash,
            "i": enc_intent,
            "text_snippet": snippet,
            "allow_snippet": True
        })

        try:
            import time as _time
            ts = str(int(_time.time()))
            endpoint = "/api/github/issues"
            sig = hmac_sign(f"{ts}:{endpoint}", hmac_key)
            status, data = fetch_json(
                f"{WORKER}{endpoint}",
                method='POST',
                headers={
                    'Content-Type': 'application/json',
                    'X-Fata-Signature': sig,
                    'X-Fata-Timestamp': ts
                },
                body=json.dumps({
                    "title": f"[EN] {snippet[:50]}",
                    "body": body,
                    "labels": ["pending"]  # NO seed label — participates in matching
                })
            )
            if status in (200, 201):
                ok += 1
                need_short = intent["need"][:15]
                print(f"  [{i+1}/{len(BOOTSTRAPS)}] OK  #{data['number']}  need={need_short}  \"{snippet[:45]}...\"")
            else:
                fail += 1
                print(f"  [{i+1}/{len(BOOTSTRAPS)}] FAIL  HTTP {status} — {str(data)[:100]}")
        except Exception as e:
            fail += 1
            print(f"  [{i+1}/{len(BOOTSTRAPS)}] ERROR  {e}")

        import time as _time
        _time.sleep(2.5)  # rate limit: under 30/min

    print(f"\nDone. {ok} OK, {fail} failed.")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
