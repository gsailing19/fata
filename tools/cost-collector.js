#!/usr/bin/env node
/**
 * fata 成本采集器
 *
 * 读取 CLOUDFLARE_API_TOKEN / RESEND_API_KEY / SILICONFLOW_API_KEY，
 * 对已配置的 provider 尝试从公开 API 拉取本月用量或费用。
 * 缺凭据输出 missing_credential；API 无权限输出 no_access。
 * 不会打印任何密钥值。
 *
 * 用法：
 *   source tools/load-secrets.sh
 *   node tools/cost-collector.js [--month 2026-08] [--write]
 *
 * 默认只输出 JSON；--write 会把结果追加到 codex/COSTS.md，
 * 月度记录通过 tools/cost-ledger.js 写入，并按“服务+日期”去重。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const COSTS_PATH = process.env.FATA_COSTS_PATH || path.join(ROOT, 'codex', 'COSTS.md');

function localMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function localDate(date = new Date()) {
  const m = localMonth(date);
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d}`;
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function parseArgs(argv) {
  const opts = { month: localMonth(), write: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--month') {
      opts.month = argv[++i] || '';
    } else if (arg === '--write') {
      opts.write = true;
    } else {
      console.error(`未知参数: ${arg}\n运行 node tools/cost-collector.js --help 查看用法。`);
      process.exit(1);
    }
  }
  if (!/^\d{4}-\d{2}$/.test(opts.month)) {
    console.error(`month 格式应为 YYYY-MM，收到: ${opts.month}`);
    process.exit(1);
  }
  return opts;
}

function printHelp() {
  console.log(`用法:
  node tools/cost-collector.js [--month 2026-08] [--write]

选项:
  --month YYYY-MM  采集月份，默认当前月
  --write          采集后写入 codex/COSTS.md（月度记录走 tools/cost-ledger.js）
  --help           显示本帮助

需要先在当前 shell 加载密钥:
  source tools/load-secrets.sh`);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

function cloudflareHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function cloudflareGraphql(token, query, variables) {
  const { status, ok, body } = await fetchJson('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: cloudflareHeaders(token),
    body: JSON.stringify({ query, variables }),
  });
  if (!ok || body?.errors) {
    throw new Error(JSON.stringify({ status, errors: body?.errors || body }));
  }
  return body.data;
}

function wranglerZoneId() {
  const file = path.join(ROOT, 'config', 'wrangler.toml');
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/zone_id\s*=\s*"([a-f0-9]+)"/i);
  return match ? match[1] : '';
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row?.sum?.[key]) || 0), 0);
}

async function collectCloudflare(token, month) {
  const apiBase = 'https://api.cloudflare.com/client/v4';
  const out = { status: 'ok', account: null, zone: null, usage: null, billing: { status: 'not_attempted' } };

  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  let accountName = '';
  if (!accountId) {
    const accounts = await fetchJson(`${apiBase}/accounts`, { headers: cloudflareHeaders(token) });
    if (!accounts.ok || !accounts.body?.success || !accounts.body?.result?.length) {
      out.status = 'no_access';
      out.error = 'Cloudflare /accounts API 不可用';
      return out;
    }
    accountId = accounts.body.result[0].id;
    accountName = accounts.body.result[0].name || '';
  }
  out.account = { id: accountId, name: accountName };

  let zoneId = process.env.CLOUDFLARE_ZONE_ID || wranglerZoneId();
  let zoneName = '';
  if (!zoneId) {
    const zones = await fetchJson(`${apiBase}/zones?per_page=50`, { headers: cloudflareHeaders(token) });
    if (zones.ok && zones.body?.success && zones.body?.result?.length) {
      zoneId = zones.body.result[0].id;
      zoneName = zones.body.result[0].name || '';
    }
  }
  if (zoneId) {
    const zone = await fetchJson(`${apiBase}/zones/${zoneId}`, { headers: cloudflareHeaders(token) });
    if (zone.ok && zone.body?.success) {
      zoneName = zone.body.result?.name || zoneName;
    }
  }
  out.zone = { id: zoneId, name: zoneName };

  const start = `${month}-01`;
  const end = nextMonth(month).slice(0, 7) + '-01';
  const usage = {};

  try {
    const data = await cloudflareGraphql(token, `query($tag:String!,$zone:String!,$start:Date!,$end:Date!){
      viewer {
        zones(filter:{zoneTag:$zone}) {
          httpRequests1dGroups(limit:10000,filter:{date_geq:$start,date_leq:$end}) {
            sum { requests }
            dimensions { date }
          }
        }
      }
    }`, { tag: accountId, zone: zoneId, start, end });
    usage.httpRequests = sumRows(data?.viewer?.zones?.[0]?.httpRequests1dGroups || [], 'requests');
  } catch (error) {
    usage.httpRequestsError = String(error.message).slice(0, 300);
  }

  try {
    const data = await cloudflareGraphql(token, `query($tag:String!,$start:Date!,$end:Date!){
      viewer {
        accounts(filter:{accountTag:$tag}) {
          kvOperationsAdaptiveGroups(limit:10000,filter:{date_geq:$start,date_leq:$end}) {
            sum { requests }
            dimensions { date actionType }
          }
        }
      }
    }`, { tag: accountId, start, end });
    const rows = data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];
    usage.kvOperations = sumRows(rows, 'requests');
    usage.kvByType = {};
    for (const row of rows) {
      const type = row?.dimensions?.actionType || 'unknown';
      usage.kvByType[type] = (usage.kvByType[type] || 0) + (Number(row?.sum?.requests) || 0);
    }
  } catch (error) {
    usage.kvOperationsError = String(error.message).slice(0, 300);
  }

  try {
    const data = await cloudflareGraphql(token, `query($tag:String!,$start:Date!,$end:Date!){
      viewer {
        accounts(filter:{accountTag:$tag}) {
          kvStorageAdaptiveGroups(limit:10000,filter:{date_geq:$start,date_leq:$end},orderBy:[date_DESC]) {
            max { keyCount byteCount }
            dimensions { date }
          }
        }
      }
    }`, { tag: accountId, start, end });
    const rows = data?.viewer?.accounts?.[0]?.kvStorageAdaptiveGroups || [];
    usage.kvStorage = rows[0]?.max || { keyCount: 0, byteCount: 0 };
  } catch (error) {
    usage.kvStorageError = String(error.message).slice(0, 300);
  }

  try {
    const data = await cloudflareGraphql(token, `query($tag:String!,$start:String!,$end:String!){
      viewer {
        accounts(filter:{accountTag:$tag}) {
          workersInvocationsAdaptive(limit:10000,filter:{datetime_geq:$start,datetime_lt:$end}) {
            sum { requests errors subrequests }
            dimensions { scriptName datetime }
          }
        }
      }
    }`, { tag: accountId, start: `${start}T00:00:00Z`, end: `${end}T00:00:00Z` });
    const rows = data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
    usage.workerRequests = sumRows(rows, 'requests');
    usage.workerErrors = sumRows(rows, 'errors');
    usage.workerSubrequests = sumRows(rows, 'subrequests');
    usage.workerRows = rows.length;
  } catch (error) {
    usage.workerError = String(error.message).slice(0, 300);
  }

  out.usage = usage;

  const billingEndpoints = [
    ['subscriptions', `${apiBase}/accounts/${accountId}/subscriptions`],
    ['paygo', `${apiBase}/accounts/${accountId}/billing/usage/paygo_info`],
  ];
  const billing = {};
  for (const [name, url] of billingEndpoints) {
    try {
      const res = await fetchJson(url, { headers: cloudflareHeaders(token) });
      if (res.ok && res.body?.success) {
        billing[name] = { status: 'ok', result: res.body.result };
      } else {
        billing[name] = { status: 'no_access', error: res.body?.errors?.[0]?.message || `HTTP ${res.status}` };
      }
    } catch (error) {
      billing[name] = { status: 'no_access', error: String(error.message).slice(0, 300) };
    }
  }
  out.billing = billing;
  return out;
}

async function collectResend(key, month) {
  const base = (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '');
  const emails = [];
  let cursor = '';
  let pages = 0;
  try {
    while (pages < 10) {
      const url = new URL('/emails', base);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('after', cursor);
      const res = await fetchJson(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok || !res.body?.data) {
        return {
          status: 'no_access',
          error: res.body?.message || `HTTP ${res.status}`,
        };
      }
      emails.push(...(res.body.data || []));
      if (!res.body.has_more || !res.body.data?.length) break;
      cursor = res.body.data[res.body.data.length - 1].id;
      pages += 1;
      if (emails.length >= 1000) break;
    }
  } catch (error) {
    return { status: 'no_access', error: String(error.message).slice(0, 300) };
  }
  const monthEmails = emails.filter((email) => String(email.created_at || '').startsWith(month));
  const events = {};
  for (const email of monthEmails) {
    const event = email.last_event || 'unknown';
    events[event] = (events[event] || 0) + 1;
  }
  return { status: 'ok', sentInMonth: monthEmails.length, events, sampled: emails.length };
}

async function collectSiliconFlow(key) {
  const base = (process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1').replace(/\/+$/, '');
  const res = await fetchJson(`${base}/user/info`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok || !res.body?.status) {
    return { status: 'no_access', error: res.body?.message || `HTTP ${res.status}` };
  }
  const data = res.body.data || {};
  return {
    status: 'ok',
    balance: data.balance,
    chargeBalance: data.chargeBalance,
    totalBalance: data.totalBalance,
    statusText: data.status,
  };
}

function readCosts() {
  return fs.existsSync(COSTS_PATH) ? fs.readFileSync(COSTS_PATH, 'utf8') : '';
}

function serviceRow(service) {
  const rows = {
    'Resend': /^\| Resend \|/,
    'SiliconFlow / DeepSeek': /^\| SiliconFlow \/ DeepSeek \|/,
    'Cloudflare Workers/Pages/KV': /^\| Cloudflare Workers\/Pages\/KV \|/,
    'GitHub Actions / GitHub': /^\| GitHub Actions \/ GitHub \|/,
    'fata.uk 域名': /^\| fata\.uk 域名 \|/,
  };
  return rows[service];
}

function updateServiceTable(content, providers) {
  const lines = content.split('\n');
  const replacements = [];

  const cf = providers.cloudflare;
  if (cf?.status === 'ok' && cf.usage) {
    const u = cf.usage;
    const cfText = `自动采集：HTTP ${u.httpRequests ?? '?'}, KV ${u.kvOperations ?? '?'}, Worker ${u.workerRequests ?? '?'}`;
    replacements.push(['Cloudflare Workers/Pages/KV', cfText]);
  } else if (cf?.status === 'missing_credential') {
    replacements.push(['Cloudflare Workers/Pages/KV', '待人工填写（缺 CLOUDFLARE_API_TOKEN）']);
  }

  const re = providers.resend;
  replacements.push(['Resend', re?.status === 'ok'
    ? `自动采集：${re.sentInMonth} 封（${JSON.stringify(re.events)}）`
    : '待人工填写（缺 RESEND_API_KEY）']);

  const sf = providers.siliconflow;
  replacements.push(['SiliconFlow / DeepSeek', sf?.status === 'ok'
    ? `自动采集：余额 ${sf.balance}`
    : '待人工填写（缺 SILICONFLOW_API_KEY）']);

  replacements.push(['GitHub Actions / GitHub', '待人工填写']);
  replacements.push(['fata.uk 域名', '待人工填写']);

  for (const [service, value] of replacements) {
    const pattern = serviceRow(service);
    const index = lines.findIndex((line) => pattern.test(line));
    if (index === -1) continue;
    const parts = lines[index].split('|');
    if (parts.length >= 6) {
      parts[5] = ` ${value} `;
      lines[index] = parts.join('|');
    }
  }
  return lines.join('\n');
}

function buildEntries(providers, month, date) {
  const entries = [];
  const cf = providers.cloudflare;
  if (cf?.status === 'ok' && cf.usage) {
    const u = cf.usage;
    const usageParts = [];
    if (u.httpRequests !== undefined) usageParts.push(`HTTP ${u.httpRequests}`);
    if (u.kvOperations !== undefined) usageParts.push(`KV ${u.kvOperations}`);
    if (u.workerRequests !== undefined) usageParts.push(`Worker ${u.workerRequests} 请求 / ${u.workerErrors} 错误`);
    if (u.kvStorage?.keyCount !== undefined) usageParts.push(`${u.kvStorage.keyCount} keys / ${u.kvStorage.byteCount} bytes`);
    entries.push({
      service: 'Cloudflare',
      amount: '待人工填写',
      note: `自动采集 ${month}：${usageParts.join(', ')}；免费计划，账单 API 无权限`,
    });
  }

  const re = providers.resend;
  if (re?.status === 'ok') {
    entries.push({
      service: 'Resend',
      amount: '待人工填写',
      note: `自动采集 ${month}：${re.sentInMonth} 封，事件 ${JSON.stringify(re.events)}`,
    });
  } else {
    entries.push({
      service: 'Resend',
      amount: '待人工填写',
      note: 'RESEND_API_KEY 缺失，需从 Resend Dashboard 人工填写',
    });
  }

  const sf = providers.siliconflow;
  if (sf?.status === 'ok') {
    entries.push({
      service: 'SiliconFlow',
      amount: '待人工填写',
      note: `自动采集 ${month}：余额 ${sf.balance}，总余额 ${sf.totalBalance}，单位以控制台为准`,
    });
  } else {
    entries.push({
      service: 'SiliconFlow',
      amount: '待人工填写',
      note: 'SILICONFLOW_API_KEY 缺失，需从 SiliconFlow 控制台人工填写',
    });
  }
  return entries;
}

function appendViaLedger(entries, month, date) {
  const existing = readCosts();
  const args = ['tools/cost-ledger.js', '--month', month, '--date', date];
  const toWrite = entries.filter((entry) => {
    const marker = `| ${date} | ${entry.service.replace(/[|]/g, '\\|')} |`;
    return !existing.includes(marker);
  });
  if (toWrite.length === 0) return 0;
  for (const entry of toWrite) {
    args.push('--entry', `${entry.service}|${entry.amount}|${entry.note}`);
  }
  execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  return toWrite.length;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const providers = {
    cloudflare: process.env.CLOUDFLARE_API_TOKEN
      ? await collectCloudflare(process.env.CLOUDFLARE_API_TOKEN, opts.month)
      : { status: 'missing_credential' },
    resend: process.env.RESEND_API_KEY
      ? await collectResend(process.env.RESEND_API_KEY, opts.month)
      : { status: 'missing_credential' },
    siliconflow: process.env.SILICONFLOW_API_KEY
      ? await collectSiliconFlow(process.env.SILICONFLOW_API_KEY)
      : { status: 'missing_credential' },
  };

  const date = localDate();
  const entries = buildEntries(providers, opts.month, date);
  const result = {
    generatedAt: new Date().toISOString(),
    month: opts.month,
    providers,
    entries,
  };

  if (opts.write) {
    let content = readCosts();
    content = updateServiceTable(content, providers);
    fs.writeFileSync(COSTS_PATH, content);
    const written = appendViaLedger(entries, opts.month, date);
    console.error(`cost-collector: 已更新服务清单，追加 ${written} 条月度记录（重复 ${entries.length - written} 条跳过）`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`cost-collector: ${error.stack || error.message}`);
  process.exit(1);
});
