/**
 * fata 端到端自动化测试（真实用户链路）
 *
 * 用户 A：/api/bootstrap → PoW → /api/challenge → /api/submit 入池
 * 用户 B：走同样链路，触发 Worker 自动匹配
 * 断言：匹配返回、双方 Issue 关闭、Match Issue 创建、双邮件通知完成
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ===== 配置 =====

function resolveWorkerURL() {
  try {
    const toml = fs.readFileSync(path.join(__dirname, '..', 'config', 'wrangler.toml'), 'utf8');
    const match = toml.match(/pattern\s*=\s*"([^"]+)"/);
    if (match) {
      const hostname = match[1].split('/')[0];
      return `https://${hostname}`;
    }
  } catch (_) { /* fall through */ }
  return process.env.FATA_WORKER_URL || 'https://fata.uk';
}

const WORKER = resolveWorkerURL();
const HMAC_KEY = process.env.FATA_HMAC_KEY || '';
const RUN_ID = Date.now().toString(36);

// Resend 测试地址；E2E 用不同 email hash 模拟两个不同用户
const EMAIL_A = 'delivered@resend.dev';
const EMAIL_B = 'delivered@resend.dev';
const EMAIL_HASH_A = sha256(`e2e-a-${RUN_ID}@fata.test`);
const EMAIL_HASH_B = sha256(`e2e-b-${RUN_ID}@fata.test`);

const TEXT_A = '最近失眠越来越严重了，不是不想睡，是躺下来脑子就开始转，越想越多，白天整个人都是飘的';
const TEXT_B = '每天晚上都很清醒，白天却很困，快分不清白天和晚上了，脑子停不下来，已经连续一周凌晨三点才睡着';
const TEXT_W = '最近总是一个人吃饭，周末也不知道去哪里，想找个人随便聊聊最近的生活';
const AWAKE_REASON = 'insomnia';
const TIMEZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
})();
const TIMEZONE_OFFSET = -new Date().getTimezoneOffset();

// ===== 工具函数 =====

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hmacSign(message, key) {
  return crypto.createHmac('sha256', key).update(message).digest('base64');
}

function buildHMACHeaders(endpoint) {
  const ts = String(Math.floor(Date.now() / 1000));
  const pathname = new URL(endpoint, WORKER).pathname;
  const sig = hmacSign(`${ts}:${pathname}`, HMAC_KEY);
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
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function isOK(res) {
  return res.status >= 200 && res.status < 300;
}

const cookieJar = {};

function captureCookies(res) {
  const setCookies = res.headers['set-cookie'];
  if (!setCookies) return;
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  for (const sc of list) {
    const pair = sc.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookieJar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
}

function cookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function solvePow(challengeNonce, difficulty) {
  const start = Date.now();
  let nonce = 0;
  while (true) {
    const hash = crypto.createHash('sha256').update(challengeNonce + nonce.toString(36)).digest();
    let zeroBits = 0;
    for (const byte of hash) {
      if (byte === 0) {
        zeroBits += 8;
      } else {
        let b = byte;
        while ((b & 0x80) === 0) {
          zeroBits++;
          b <<= 1;
        }
        break;
      }
    }
    if (zeroBits >= difficulty) {
      return {
        nonce: nonce.toString(36),
        hash: hash.toString('hex'),
        durationMs: Date.now() - start
      };
    }
    nonce++;
  }
}

async function startSession() {
  const boot = await fetchJSON(`${WORKER}/api/bootstrap`, { method: 'POST' });
  if (!isOK(boot)) throw new Error(`bootstrap failed: ${boot.status}`);
  captureCookies(boot);

  const { challengeNonce, difficulty } = boot.data;
  const solution = solvePow(challengeNonce, difficulty);

  const chal = await fetchJSON(`${WORKER}/api/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ nonce: solution.nonce, challengeNonce })
  });
  if (!isOK(chal)) {
    throw new Error(`challenge failed: ${chal.status} ${JSON.stringify(chal.data)}`);
  }
  return { token: chal.data.submitToken, expiresAt: chal.data.expiresAt };
}

async function submitText(token, text, email, emailHash, extra = {}) {
  const tfidfEmbedding = charBigramVector(text);
  const resp = await fetchJSON(`${WORKER}/api/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fata-Submit-Token': token,
      Cookie: cookieHeader()
    },
    body: JSON.stringify({
      text,
      email,
      emailHash,
      lang: 'zh',
      allowSnippet: true,
      tfidfEmbedding,
      awakeReason: AWAKE_REASON,
      timezone: TIMEZONE,
      timezoneOffset: TIMEZONE_OFFSET,
      _test: true,
      ...extra
    })
  });
  if (!isOK(resp)) {
    throw new Error(`submit failed: ${resp.status} ${JSON.stringify(resp.data)}`);
  }
  return resp.data;
}

async function getJSON(endpoint, token) {
  const headers = {};
  if (token) headers['X-Fata-Submit-Token'] = token;
  if (Object.keys(cookieJar).length) headers.Cookie = cookieHeader();
  const resp = await fetchJSON(`${WORKER}${endpoint}`, { method: 'GET', headers });
  if (!isOK(resp)) throw new Error(`GET ${endpoint} failed: ${resp.status} ${JSON.stringify(resp.data)}`);
  return resp.data;
}

async function getIssue(number, token) {
  return getJSON(`/api/github/issues/${number}`, token);
}

function hasLabel(issue, name) {
  return (issue.labels || []).some(l => typeof l === 'string' ? l === name : (l.name === name));
}

async function cleanupIssue(number) {
  if (!HMAC_KEY) {
    console.log(`  ⚠ FATA_HMAC_KEY 未设置，跳过 Match Issue #${number} 清理`);
    return false;
  }
  const endpoint = `/api/github/issues/${number}`;
  const resp = await fetchJSON(`${WORKER}${endpoint}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...buildHMACHeaders(endpoint) },
    body: JSON.stringify({ state: 'closed' })
  });
  if (resp.status === 200) {
    console.log(`  ✓ Match Issue #${number} 已关闭`);
    return true;
  }
  console.log(`  ⚠ Match Issue #${number} 关闭失败: ${resp.status}`);
  return false;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function charBigramVector(text) {
  const chars = (text || '').replace(/\s+/g, '').split('');
  const bigrams = {};
  for (let i = 0; i < chars.length - 1; i++) {
    const bg = chars[i] + chars[i + 1];
    bigrams[bg] = (bigrams[bg] || 0) + 1;
  }
  const total = Object.values(bigrams).reduce((a, b) => a + b, 0) || 1;
  const vec = new Array(512).fill(0);
  for (const [bg, cnt] of Object.entries(bigrams)) {
    let h = 0;
    for (let i = 0; i < bg.length; i++) h = (h * 31 + bg.charCodeAt(i)) | 0;
    vec[Math.abs(h) % 512] += cnt / total;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0));
  if (norm > 0) vec.forEach((_, i) => vec[i] /= norm);
  return vec;
}

// ===== 主测试流程 =====

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  fata E2E - 真实 /api/submit 匹配链路');
  console.log('═══════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  function check(name, condition, detail) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      results.push({ name, status: 'PASS', detail });
      passed++;
    } else {
      console.log(`  ✗ ${name}`);
      results.push({ name, status: 'FAIL', detail });
      failed++;
    }
  }

  console.log('── 用户 A：PoW + 提交 ──');
  const sessionA = await startSession();
  console.log('  ✓ PoW 挑战通过，已获取 submit token');

  const resultA = await submitText(sessionA.token, TEXT_A, EMAIL_A, EMAIL_HASH_A);
  check('A 已入池且未匹配', resultA.pooled === true && resultA.matched === false, `Issue #${resultA.issueNumber}`);

  let pendingNumbers = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(2000);
    const pendingBefore = await getJSON('/api/github/issues?labels=pending&per_page=50', sessionA.token);
    pendingNumbers = (Array.isArray(pendingBefore) ? pendingBefore : []).map(i => i.number);
    if (pendingNumbers.includes(resultA.issueNumber)) break;
  }
  check('A 的 Issue 在 pending 池中', pendingNumbers.includes(resultA.issueNumber), `#${resultA.issueNumber}`);
  const issueA = await getIssue(resultA.issueNumber, sessionA.token);
  let issueABody = {};
  try { issueABody = JSON.parse(issueA.body || '{}'); } catch (_) {}
  check(
    'A 的 Issue 元数据包含醒着原因与时区',
    issueABody.r === AWAKE_REASON &&
      issueABody.tzo === TIMEZONE_OFFSET &&
      typeof issueABody.tz === 'string' &&
      issueABody.tz.length > 0,
    JSON.stringify({ r: issueABody.r, tzo: issueABody.tzo, tz: issueABody.tz })
  );

  console.log('\n── 用户 B：PoW + 提交 + 自动匹配 ──');
  const sessionB = await startSession();
  console.log('  ✓ PoW 挑战通过，已获取 submit token');

  const resultB = await submitText(sessionB.token, TEXT_B, EMAIL_B, EMAIL_HASH_B);
  console.log(`  embedSource=${resultB.embedSource} debug=${JSON.stringify(resultB.matchDebug || null)}`);
  check('B 触发匹配成功', resultB.matched === true, `score=${resultB.matchInfo ? resultB.matchInfo.score : 'none'}`);
  check('匹配对象是用户 A', resultB.matchInfo && resultB.matchInfo.otherEmail === EMAIL_A, resultB.matchInfo ? resultB.matchInfo.otherEmail : 'none');
  check('双方通知已完成', resultB.notification && resultB.notification.status === 'completed' && resultB.notification.sent === true, JSON.stringify(resultB.notification));

  await sleep(4000);

  console.log('\n── 匹配收尾断言 ──');
  const issueAState = await getIssue(resultA.issueNumber, sessionB.token);
  const issueBState = await getIssue(resultB.issueNumber, sessionB.token);
  check('A 的 Issue 已关闭', issueAState.state === 'closed', `state=${issueAState.state}`);
  check('B 的 Issue 已关闭', issueBState.state === 'closed', `state=${issueBState.state}`);
  check('A 的 Issue 标记 matched', hasLabel(issueAState, 'matched'), '');
  check('B 的 Issue 标记 matched', hasLabel(issueBState, 'matched'), '');

  let matchRecord = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(2000);
    const matchedIssues = await getJSON('/api/github/issues?labels=matched&per_page=50', sessionB.token);
    matchRecord = (Array.isArray(matchedIssues) ? matchedIssues : []).find(i => {
      try {
        const body = JSON.parse(i.body || '{}');
        const a = resultA.issueNumber;
        const b = resultB.issueNumber;
        return (body.user_issue === a && body.matched_issue === b) ||
               (body.user_issue === b && body.matched_issue === a);
      } catch (e) {
        return false;
      }
    });
    if (matchRecord) break;
  }
  check('Match Issue 已创建', !!matchRecord, matchRecord ? `#${matchRecord.number}` : 'none');

  console.log('\n── 撤回路径：用户 W 提交后撤回 ──');
  const sessionW = await startSession();
  const resultW = await submitText(sessionW.token, TEXT_W, EMAIL_A, sha256(`e2e-w-${RUN_ID}@fata.test`));
  check('W 已入池', resultW.pooled === true, `Issue #${resultW.issueNumber}`);

  const withdrawResp = await fetchJSON(`${WORKER}/api/withdraw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fata-Submit-Token': sessionW.token,
      Cookie: cookieHeader()
    },
    body: JSON.stringify({ issueNumber: resultW.issueNumber })
  });
  check('W 撤回请求成功', isOK(withdrawResp) && withdrawResp.data.success === true, JSON.stringify(withdrawResp.data));

  await sleep(3000);
  const issueWState = await getIssue(resultW.issueNumber, sessionW.token);
  check('W 的 Issue 已关闭', issueWState.state === 'closed', `state=${issueWState.state}`);
  check('W 的 Issue 标记 withdrawn', hasLabel(issueWState, 'withdrawn'), '');

  if (matchRecord) await cleanupIssue(matchRecord.number);

  console.log('\n═══════════════════════════════════════════');
  console.log('  测试报告');
  console.log('═══════════════════════════════════════════');
  console.log(`  通过: ${passed}  |  失败: ${failed}  |  总计: ${passed + failed}`);
  console.log('');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${icon} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  }
  console.log(`\n  Worker: ${WORKER}`);
  console.log('  GitHub Issues: https://github.com/gsailing19/fata/issues');
  console.log('  Resend Dashboard: https://resend.com/emails');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
