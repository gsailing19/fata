#!/usr/bin/env node
// cleanup-plaintext-issues.js
// 用法: --dry-run (默认) 或 --execute

const { execSync } = require('child_process');
const fs = require('fs');

const REPO = 'gsailing19/fata';
const REDACTED_BODY = '{"_kv":0,"redacted":true,"note":"historical plaintext cleaned 2026-06-26"}';

function sh(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 15000 }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function hasPlaintext(body) {
  if (!body || body.trim() === '') return false;
  try {
    const obj = JSON.parse(body);
    if (obj._kv === 4) return false;
    if (obj.redacted === true) return false;
    if (obj.user_snippet || obj.matched_snippet) return true;
    if (typeof obj.text_snippet === 'string' && obj.text_snippet.length > 5) return true;
    if ([1, 2, 3].includes(obj._kv)) return true;
    if (obj.e && obj.m && obj.h) return true;
    return false;
  } catch {
    return body.trim().length > 0;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchAllIssues() {
  // Use gh issue list for numbers, then batch view for bodies
  console.log('Fetching issue list...');
  const allIssues = [];

  for (let page = 1; page <= 30; page++) {
    const url = `/repos/${REPO}/issues?state=all&per_page=100&page=${page}`;
    const r = sh(
      `gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${url}"`
    );
    if (!r.ok) break;
    try {
      const batch = JSON.parse(r.out);
      if (batch.length === 0) break;
      for (const issue of batch) {
        allIssues.push({
          number: issue.number,
          title: issue.title || '',
          labels: (issue.labels || []).map(l => l.name),
          state: issue.state,
          body: issue.body || ''
        });
      }
      process.stdout.write(`\r  page ${page}: ${allIssues.length} total...`);
      if (batch.length < 100) break;
    } catch { break; }
  }
  console.log(`\n  Done: ${allIssues.length} issues fetched.\n`);
  return allIssues;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');

  console.log(dryRun ? '=== DRY RUN ===\n' : '=== EXECUTE ===\n');

  const issues = await fetchAllIssues();

  const toClean = [];
  const secure = [];

  for (const issue of issues) {
    if (hasPlaintext(issue.body)) {
      toClean.push(issue);
    } else {
      secure.push(issue.number);
    }
  }

  console.log(`Plaintext: ${toClean.length}  |  Secure (_kv:4): ${secure.length}\n`);

  if (toClean.length === 0) { console.log('Nothing to clean.'); return; }

  // Show sample
  console.log('=== Issues with plaintext (first 40) ===');
  for (const i of toClean.slice(0, 40)) {
    console.log(`  #${i.number} [${i.labels.join(',')}] (${i.state}) "${i.title.slice(0, 70)}"`);
  }
  if (toClean.length > 40) console.log(`  ... and ${toClean.length - 40} more`);

  if (dryRun) {
    console.log(`\nDry run done. Use --execute to clean ${toClean.length} issues.`);
    return;
  }

  // EXECUTE
  console.log(`\n=== Cleaning ${toClean.length} issues ===\n`);
  let edited = 0, closed = 0, failed = 0;

  for (let i = 0; i < toClean.length; i++) {
    const issue = toClean[i];
    const n = issue.number;

    // Edit body via PATCH
    const patchBody = JSON.stringify({ body: REDACTED_BODY });
    const editR = sh(
      `gh api --method PATCH -H "Accept: application/vnd.github+json" ` +
      `-H "X-GitHub-Api-Version: 2022-11-28" ` +
      `--input - /repos/${REPO}/issues/${n}`,
    );
    // Can't use --input with string easily, use temp file
    const tmpFile = `/tmp/fata-redact-${n}.json`;
    fs.writeFileSync(tmpFile, patchBody);
    const editR2 = sh(
      `gh api --method PATCH -H "Accept: application/vnd.github+json" ` +
      `-H "X-GitHub-Api-Version: 2022-11-28" ` +
      `--input "${tmpFile}" /repos/${REPO}/issues/${n}`
    );
    fs.unlinkSync(tmpFile);

    if (editR2.ok) {
      edited++;
      process.stdout.write(`[${i+1}/${toClean.length}] ✓ #${n} body`);
    } else {
      failed++;
      process.stdout.write(`[${i+1}/${toClean.length}] ✗ #${n}: ${editR2.out.slice(0, 80)}`);
      console.log();
      continue;
    }

    // Close if open
    if (issue.state === 'open') {
      const closeBody = JSON.stringify({ state: 'closed' });
      const tmpFile2 = `/tmp/fata-close-${n}.json`;
      fs.writeFileSync(tmpFile2, closeBody);
      const closeR = sh(
        `gh api --method PATCH -H "Accept: application/vnd.github+json" ` +
        `-H "X-GitHub-Api-Version: 2022-11-28" ` +
        `--input "${tmpFile2}" /repos/${REPO}/issues/${n}`
      );
      fs.unlinkSync(tmpFile2);
      if (closeR.ok) { closed++; console.log(' + closed'); }
      else { console.log(' (close failed)'); }
    } else {
      console.log(' (already closed)');
    }

    if ((i + 1) % 30 === 0) { console.log('  pausing 1.5s...'); await sleep(1500); }
  }

  console.log(`\n=== Done ===`);
  console.log(`Bodies redacted: ${edited}/${toClean.length}`);
  console.log(`Closed: ${closed}`);
  console.log(`Failed: ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
