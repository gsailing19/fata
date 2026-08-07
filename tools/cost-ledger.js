#!/usr/bin/env node
/**
 * fata 成本台账追加工具
 *
 * 用法：
 *   node tools/cost-ledger.js --month 2026-08 \
 *     --entry "Resend|0|免费层" \
 *     --entry "SiliconFlow|12.34|BGE-M3 + DeepSeek" \
 *     [--date 2026-08-07] [--dry-run]
 *
 * 说明：
 *   - 只读写 codex/COSTS.md，不联网、不读取密钥。
 *   - entry 格式为 服务|金额(CNY)|备注，备注可省略。
 *   - --dry-run 只打印将要追加的内容，不写文件。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COSTS_PATH = process.env.FATA_COSTS_PATH || path.join(ROOT, 'codex', 'COSTS.md');
const TABLE_HEADER = '| 日期 | 服务 | 金额 (CNY) | 备注 |';
const TABLE_SEP = '|------|------|------------|------|';

function printHelp() {
  console.log(`用法:
  node tools/cost-ledger.js --month 2026-08 --entry "服务|金额|备注" [--entry ...]

选项:
  --month YYYY-MM    必填，追加到对应的月度小节
  --entry 记录        可重复，格式为 服务|金额(CNY)|备注
  --date YYYY-MM-DD  记录日期，默认今天
  --dry-run           只打印结果，不修改文件
  --help              显示本帮助`);
}

function today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function parseArgs(argv) {
  const opts = { month: '', date: today(), entries: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--month') {
      opts.month = argv[++i] || '';
    } else if (arg === '--date') {
      opts.date = argv[++i] || '';
    } else if (arg === '--entry') {
      opts.entries.push(argv[++i] || '');
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else {
      console.error(`未知参数: ${arg}\n运行 node tools/cost-ledger.js --help 查看用法。`);
      process.exit(1);
    }
  }
  return opts;
}

function validate(opts) {
  if (!/^\d{4}-\d{2}$/.test(opts.month)) {
    console.error(`month 格式应为 YYYY-MM，收到: ${opts.month}`);
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    console.error(`date 格式应为 YYYY-MM-DD，收到: ${opts.date}`);
    process.exit(1);
  }
  if (opts.entries.length === 0) {
    console.error('至少需要一条 --entry，格式为 "服务|金额|备注"。');
    process.exit(1);
  }
}

function esc(value) {
  return String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function parseEntry(raw) {
  const parts = String(raw).split('|').map(s => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    console.error(`entry 格式应为 "服务|金额|备注"，收到: ${raw}`);
    process.exit(1);
  }
  return {
    service: esc(parts[0]),
    amount: esc(parts[1]),
    note: esc(parts.slice(2).join(' / ') || '-')
  };
}

function nextHeadingIndex(lines, fromIndex) {
  for (let i = fromIndex + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) return i;
  }
  return lines.length;
}

function listMonthBlocks(lines, monthlyIndex) {
  const blocks = [];
  for (let i = monthlyIndex + 1; i < lines.length; i++) {
    const m = lines[i].match(/^###\s+(\d{4}-\d{2})\s*$/);
    if (m) {
      blocks.push({ month: m[1], index: i });
    } else if (/^##\s/.test(lines[i])) {
      break;
    }
  }
  return blocks;
}

function ensureMonthlySection(lines) {
  const existing = lines.findIndex(l => /^##\s+月度记录\s*$/.test(l));
  if (existing !== -1) return existing;
  lines.push('', '## 月度记录', '', '> 月度记录由 `node tools/cost-ledger.js` 追加；手动修改请保持表格列一致。', '');
  return lines.findIndex(l => /^##\s+月度记录\s*$/.test(l));
}

function rowInsertIndex(lines, monthIndex) {
  let lastContent = monthIndex;
  for (let i = monthIndex + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    if (lines[i].trim() !== '') lastContent = i;
  }
  return lastContent + 1;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  validate(opts);

  let content = '';
  if (fs.existsSync(COSTS_PATH)) {
    content = fs.readFileSync(COSTS_PATH, 'utf8');
  }
  const lines = content ? content.replace(/\r\n/g, '\n').split('\n') : [];

  const monthlyIndex = ensureMonthlySection(lines);
  const blocks = listMonthBlocks(lines, monthlyIndex);
  let monthIndex = blocks.find(b => b.month === opts.month)?.index ?? -1;

  if (monthIndex === -1) {
    const insertAt = blocks.length === 0
      ? nextHeadingIndex(lines, monthlyIndex)
      : nextHeadingIndex(lines, blocks[blocks.length - 1].index);
    const insert = ['', `### ${opts.month}`, '', TABLE_HEADER, TABLE_SEP, ''];
    if (!opts.dryRun) {
      lines.splice(insertAt, 0, ...insert);
    }
    monthIndex = insertAt + 2;
  }

  const rows = opts.entries.map(parseEntry).map(e => {
    return `| ${opts.date} | ${e.service} | ${e.amount} | ${e.note} |`;
  });

  if (opts.dryRun) {
    console.log(`[dry-run] 目标: ${COSTS_PATH} (### ${opts.month})`);
    console.log(TABLE_HEADER);
    console.log(TABLE_SEP);
    for (const row of rows) console.log(row);
    return;
  }

  const rowInsertAt = rowInsertIndex(lines, monthIndex);
  lines.splice(rowInsertAt, 0, ...rows);
  fs.writeFileSync(COSTS_PATH, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');

  console.log(`已追加 ${rows.length} 条记录到 codex/COSTS.md (### ${opts.month})`);
}

main();
