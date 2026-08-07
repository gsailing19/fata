#!/usr/bin/env node
/**
 * 供 tools/load-secrets.sh 调用的环境变量补读工具。
 * 只输出尚未设置的键对应的 export 语句，不打印任何密钥值。
 */

const fs = require('fs');

const file = process.argv[2];
if (!file) process.exit(0);

let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (_) {
  process.exit(0);
}

const shellQuote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const env = data.env || {};
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}
