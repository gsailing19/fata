/**
 * fata 每周回测脚本（P2-3）
 *
 * 运行 invariant、algo zh/en、场景评估，并把报告写入 codex/backtests/。
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const commands = [
  ['node', ['tools/invariant-tests.js']],
  ['node', ['tools/algo-test.js', '--lang', 'zh']],
  ['node', ['tools/algo-test.js', '--lang', 'en']],
  ['node', ['tools/evaluate-matching.js']]
];

const chunks = [];
let failed = 0;

for (const [cmd, args] of commands) {
  const file = args.find(a => a.endsWith('.js'));
  if (file && !fs.existsSync(path.join(ROOT, file))) {
    console.log(`SKIP ${args.join(' ')} (file not present)`);
    continue;
  }
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  chunks.push(`$ ${cmd} ${args.join(' ')}\n${res.stdout || ''}${res.stderr || ''}`);
  if (res.status !== 0) failed++;
}

const date = new Date().toISOString().slice(0, 10);
const dir = path.join(ROOT, 'codex', 'backtests');
fs.mkdirSync(dir, { recursive: true });
const outFile = path.join(dir, `${date}.txt`);
fs.writeFileSync(outFile, chunks.join('\n'));

console.log(`\nWeekly backtest report: ${path.relative(ROOT, outFile)}`);
console.log(failed === 0 ? 'All backtest commands passed.' : `${failed} command(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
