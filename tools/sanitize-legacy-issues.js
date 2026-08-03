/**
 * fata 历史 Issue 脱敏工具（P1-5）
 *
 * 用途：把旧 _kv<=3 测试/匹配 Issue 中的明文 snippet、加密字段从公开 body 中移除。
 * 只处理已确认的历史测试数据，不改动 _kv4 当前数据。
 *
 * 注意：经 Worker HMAC 代理写入，需保持 30 req/min 以内。
 */

const crypto = require('crypto');

const WORKER = process.env.FATA_WORKER_URL || 'https://fata.uk';
const HMAC_KEY = process.env.FATA_HMAC_KEY || '';
const OWNER = 'gsailing19';
const REPO = 'fata';

const SENSITIVE_KEYS = ['text_snippet', 'user_snippet', 'matched_snippet', 'snippet', 'text', 'e', 'm', 'i', 'h'];

function hmacHeaders(path) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', HMAC_KEY).update(`${ts}:${path}`).digest('base64');
  return {
    'X-Fata-Signature': sig,
    'X-Fata-Timestamp': ts,
    'Content-Type': 'application/json'
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function listIssues() {
  const issues = [];
  for (let page = 1; page <= 8; page++) {
    const resp = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues?state=all&per_page=100&page=${page}`);
    if (!resp.ok) throw new Error(`list failed: ${resp.status}`);
    const batch = await resp.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  return issues;
}

function needsSanitize(issue) {
  let body;
  try { body = JSON.parse(issue.body || '{}'); } catch { return false; }
  const kv = Number(body._kv || -1);
  if (kv >= 4) return false;
  if (body.redacted === true && kv === 0) return false;
  return SENSITIVE_KEYS.some(k => typeof body[k] === 'string' && body[k].length > 0);
}

async function sanitize(issue) {
  const path = `/api/github/issues/${issue.number}`;
  const payload = {
    title: `legacy-sanitized-${issue.number}`,
    state: 'closed',
    body: JSON.stringify({
      _kv: 4,
      redacted: true,
      note: 'legacy test data sanitized 2026-08-03'
    })
  };
  const resp = await fetch(`${WORKER}${path}`, {
    method: 'PATCH',
    headers: hmacHeaders(path),
    body: JSON.stringify(payload)
  });
  return resp.status === 200;
}

async function main() {
  if (!HMAC_KEY) throw new Error('FATA_HMAC_KEY not set');
  const issues = await listIssues();
  const targets = issues.filter(needsSanitize);
  console.log(`total=${issues.length} legacy_sensitive=${targets.length}`);

  let ok = 0;
  let failed = 0;
  for (const issue of targets) {
    const success = await sanitize(issue);
    if (success) {
      ok++;
      console.log(`  ✓ #${issue.number}`);
    } else {
      failed++;
      console.log(`  ✗ #${issue.number}`);
    }
    await sleep(2200);
  }

  console.log(`sanitized=${ok} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
