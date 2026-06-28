/**
 * fata 端到端自动化测试
 *
 * 模拟两个用户在匹配池中相遇的完整链路：
 * 用户 A 投递 → 入池 → 用户 B 投递 → 匹配到 A → Issue 关闭 → Match Issue 创建 → 邮件发送
 */

const crypto = require('crypto');
const https = require('https');

// ===== 配置 =====

// Worker 地址从 wrangler.toml 路由配置自动解析
function resolveWorkerURL() {
  try {
    const toml = require('fs').readFileSync(require('path').join(__dirname, '..', 'config', 'wrangler.toml'), 'utf8');
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

// Resend 测试邮件（deliverable@resend.dev 是 Resend 的测试地址，不会真的发出去但会在 Dashboard 显示）
const EMAIL_A = 'delivered@resend.dev';
const EMAIL_B = 'delivered@resend.dev';

// 两段情绪相似的文字（失眠/熬夜主题）
const TEXT_A = '最近失眠越来越严重了，不是不想睡，是躺下来脑子就开始转，越想越多，白天整个人都是飘的';
const TEXT_B = '每天晚上都很清醒，白天却很困，快分不清白天和晚上了，脑子停不下来，已经连续一周凌晨三点才睡着';

// ===== 工具函数 =====

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hmacSign(message, key) {
  return crypto.createHmac('sha256', key).update(message).digest('base64');
}

function encryptAES(plaintext) {
  const key = Buffer.from(HMAC_KEY, 'utf8').slice(0, 32); // 256-bit, 与浏览器端对齐
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, tag]);
  return combined.toString('base64');
}

function buildHMACHeaders(endpoint) {
  const ts = String(Math.floor(Date.now() / 1000));
  const path = new URL(endpoint, WORKER).pathname;
  const msg = `${ts}:${path}`;
  const sig = hmacSign(msg, HMAC_KEY);
  return { 'X-Fata-Signature': sig, 'X-Fata-Timestamp': ts };
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(urlObj, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== 模拟浏览器端 embedding 生成（TF-IDF 字符 bigram，与 match-engine.js 一致）=====

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

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ===== 创建 pending issue =====

async function createIssue(text, email, label) {
  const embedding = charBigramVector(text);
  const embEncrypted = encryptAES(JSON.stringify(embedding));
  const emailEncrypted = encryptAES(email);
  const emailHash = sha256(email);
  const snippet = text.length > 80 ? text.slice(0, 80) : text;

  const body = JSON.stringify({
    l: 'zh',
    e: embEncrypted,
    m: emailEncrypted,
    h: emailHash,
    text_snippet: snippet
  });

  const endpoint = '/api/github/issues';
  const headers = {
    'Content-Type': 'application/json',
    ...buildHMACHeaders(endpoint)
  };

  const resp = await fetchJSON(`${WORKER}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `[Test] ${snippet.slice(0, 30)}`,
      body,
      labels: [label || 'pending']
    })
  });

  if (resp.status !== 201 && resp.status !== 200) {
    console.error(`  ✗ 创建 Issue 失败: ${resp.status}`, typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data));
    return null;
  }

  console.log(`  ✓ Issue #${resp.data.number} 创建成功: "${snippet.slice(0, 30)}..."`);
  return { number: resp.data.number, embedding };
}

// ===== 关闭 issue =====

async function closeIssue(issueNumber) {
  const endpoint = `/api/github/issues/${issueNumber}`;
  const headers = {
    'Content-Type': 'application/json',
    ...buildHMACHeaders(endpoint)
  };
  const resp = await fetchJSON(`${WORKER}${endpoint}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ state: 'closed' })
  });
  if (resp.status === 200) {
    console.log(`  ✓ Issue #${issueNumber} 已关闭`);
    return true;
  }
  console.log(`  ⚠ Issue #${issueNumber} 关闭失败: ${resp.status}`);
  return false;
}

// ===== 主测试流程 =====

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  fata 端到端测试 - 双用户匹配链路');
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

  // ==========================================
  // Phase 1: 用户 A 投递
  // ==========================================
  console.log('── Phase 1: 用户 A 投递 ──');
  console.log(`  文字: "${TEXT_A.slice(0, 40)}..."`);
  console.log(`  邮箱: ${EMAIL_A}`);

  const issueA = await createIssue(TEXT_A, EMAIL_A, 'pending');
  check('用户 A 的 Issue 已创建', issueA !== null, issueA ? `#${issueA.number}` : 'failed');

  if (!issueA) {
    console.log('\n❌ Phase 1 失败，终止测试');
    process.exit(1);
  }

  await sleep(4000); // 等 GitHub API 索引完成

  // ==========================================
  // Phase 2: 用户 B 投递 + 匹配
  // ==========================================
  console.log('\n── Phase 2: 用户 B 投递 + 匹配 ──');
  console.log(`  文字: "${TEXT_B.slice(0, 40)}..."`);
  console.log(`  邮箱: ${EMAIL_B}`);

  // 用户 B 也创建 issue（入池）
  const issueB = await createIssue(TEXT_B, EMAIL_B, 'pending');
  check('用户 B 的 Issue 已创建', issueB !== null, issueB ? `#${issueB.number}` : 'failed');

  if (!issueB) {
    console.log('\n❌ Phase 2 失败，终止测试');
    process.exit(1);
  }

  // 用户 B 的 embedding 与用户 A 的 embedding 做相似度计算
  const sim = cosineSimilarity(issueB.embedding, issueA.embedding);
  console.log(`  余弦相似度: ${(sim * 100).toFixed(1)}%`);
  check('两段文字的余弦相似度 >= 15%（TF-IDF 阈值）', sim >= 0.15, `${(sim * 100).toFixed(1)}%`);

  // 拉取 pending issues，验证能匹配到 A（而不是自己）
  // GitHub API 有索引延迟，用重试确保获取到最新列表
  await sleep(3000);
  let pendingResp, pendingIssues, userAIssue, userBIssue;
  for (let retry = 0; retry < 5; retry++) {
    if (retry > 0) await sleep(2000);
    pendingResp = await fetchJSON(`${WORKER}/api/github/issues?labels=pending&per_page=50`, {
      headers: buildHMACHeaders('/api/github/issues')
    });
    pendingIssues = Array.isArray(pendingResp.data) ? pendingResp.data : [];
    userAIssue = pendingIssues.find(i => i.number === issueA.number);
    userBIssue = pendingIssues.find(i => i.number === issueB.number);
    if (userBIssue) break; // B 的 Issue 已在 pending 列表中
  }
  check('用户 A 的 Issue 在 pending 池中', !!userAIssue);
  check('用户 B 的 Issue 在 pending 池中', !!userBIssue);

  // 找到最佳匹配（排除 #B 自己）
  let bestScore = -1, bestIssue = null;
  const bEmb = issueB.embedding;
  for (const issue of pendingIssues) {
    if (issue.number === issueB.number) continue; // 排除自己
    const labels = Array.isArray(issue.labels)
      ? (typeof issue.labels[0] === 'string' ? issue.labels : issue.labels.map(l => l.name))
      : [];
    if (labels.includes('seed')) continue; // 排除种子（测试只关注真实用户匹配）

    let otherEmb;
    try {
      // 尝试从 body 中提取 text_snippet 做 char bigram
      const body = typeof issue.body === 'string' ? JSON.parse(issue.body) : issue.body;
      if (body.text_snippet) {
        otherEmb = charBigramVector(body.text_snippet);
      }
    } catch (e) { continue; }

    if (!otherEmb) continue;
    const score = cosineSimilarity(bEmb, otherEmb);
    if (score > bestScore) { bestScore = score; bestIssue = issue; }
  }

  console.log(`  最佳匹配: ${bestIssue ? `#${bestIssue.number} (${(bestScore*100).toFixed(1)}%)` : '无'}`);
  const matchedCorrectly = bestIssue && bestIssue.number === issueA.number;
  check('用户 B 最佳匹配是用户 A（而非种子或其他用户）', matchedCorrectly,
    bestIssue ? `匹配到 #${bestIssue.number} (${(bestScore*100).toFixed(1)}%)` : '无匹配');

  // ==========================================
  // Phase 3: 匹配后处理（关闭 Issues + 创建 Match Issue）
  // ==========================================
  console.log('\n── Phase 3: 匹配后处理 ──');

  await closeIssue(issueA.number);
  await closeIssue(issueB.number);

  // 创建 Match Issue
  const matchEndpoint = '/api/github/issues';
  const matchHeaders = {
    'Content-Type': 'application/json',
    ...buildHMACHeaders(matchEndpoint)
  };
  const matchResp = await fetchJSON(`${WORKER}${matchEndpoint}`, {
    method: 'POST',
    headers: matchHeaders,
    body: JSON.stringify({
      title: `[Test Match] ${TEXT_A.slice(0, 20)} ↔ ${TEXT_B.slice(0, 20)}`,
      body: JSON.stringify({
        user_issue: issueA.number,
        matched_issue: issueB.number,
        user_snippet: TEXT_A.slice(0, 80),
        matched_snippet: TEXT_B.slice(0, 80),
        similarity: sim,
        timestamp: Date.now()
      }),
      labels: ['matched']
    })
  });
  check('Match Issue 创建成功', matchResp.status === 201 || matchResp.status === 200,
    `#${matchResp.data?.number || '?'}`);

  // ==========================================
  // Phase 4: 邮件验证
  // ==========================================
  console.log('\n── Phase 4: 邮件发送验证 ──');

  const resendResp = await fetchJSON(`${WORKER}/api/resend/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildHMACHeaders('/api/resend/send')
    },
    body: JSON.stringify({
      to: [EMAIL_A, EMAIL_B],
      subject: '有人在文字频率上与你共振 — fata',
      html: `<html><body>
        <p>测试邮件 — fata E2E 自动化测试</p>
        <p>用户 A (${EMAIL_A}): "${TEXT_A.slice(0, 40)}..."</p>
        <p>用户 B (${EMAIL_B}): "${TEXT_B.slice(0, 40)}..."</p>
        <p>余弦相似度: ${(sim * 100).toFixed(1)}%</p>
        <p>Match Issue: #${matchResp.data?.number || '?'}</p>
      </body></html>`,
      matchIssueNumber: matchResp.data?.number || matchResp.number,
      userIssueNumber: issueA.number
    })
  });

  if (resendResp.status === 200 || resendResp.status === 202) {
    console.log('  ✓ Resend 邮件发送请求成功');
    console.log(`  ✓ Resend ID: ${resendResp.data?.id || 'N/A'}`);
    check('Resend 邮件已发送', true, `ID: ${resendResp.data?.id || 'N/A'}`);
  } else {
    console.log(`  ⚠ Resend 返回 ${resendResp.status}: ${JSON.stringify(resendResp.data).slice(0, 200)}`);
    check('Resend 邮件已发送', false, `Status: ${resendResp.status}`);
  }

  // ==========================================
  // 测试报告
  // ==========================================
  console.log('\n═══════════════════════════════════════════');
  console.log('  测试报告');
  console.log('═══════════════════════════════════════════');
  console.log(`  通过: ${passed}  |  失败: ${failed}  |  总计: ${passed + failed}`);
  console.log('');

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${icon} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  }

  console.log(`\n  GitHub Issues: https://github.com/gsailing19/fata/issues`);
  console.log(`  Resend Dashboard: https://resend.com/emails`);
  console.log('');

  // 清理：关闭测试 issues（可选，默认保留便于手动检查）
  console.log('── 清理建议 ──');
  console.log(`  测试 Issue A: #${issueA.number} (已关闭)`);
  console.log(`  测试 Issue B: #${issueB.number} (已关闭)`);
  console.log(`  Match Issue: #${matchResp.data?.number || '?'}`);
  console.log('  可在 GitHub 上手动删除这些测试 Issue\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
