/**
 * fata 本地验证脚本（P2-1）
 *
 * 运行本地可重复验证：语法检查、invariant、algo zh/en、场景评估。
 * 不会写线上数据。
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const commands = [
  ['node', ['--check', 'config/worker.js']],
  ['node', ['--check', 'modules/match-engine.js']],
  ['node', ['--check', 'tools/e2e-test.js']],
  ['node', ['tools/invariant-tests.js']],
  ['node', ['tools/worker-match-core-test.js']],
  ['node', ['tools/algo-test.js', '--lang', 'zh']],
  ['node', ['tools/algo-test.js', '--lang', 'en']],
  ['node', ['tools/evaluate-matching.js']]
];

let failed = 0;
for (const [cmd, args] of commands) {
  if (args.some(a => a.includes('.js')) && !fs.existsSync(path.join(ROOT, args.find(a => a.endsWith('.js'))))) {
    console.log(`SKIP ${args.join(' ')} (file not present)`);
    continue;
  }
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) failed++;
}

console.log(failed === 0 ? '\nLocal verification passed.' : `\nLocal verification failed: ${failed} command(s).`);
process.exit(failed === 0 ? 0 : 1);
