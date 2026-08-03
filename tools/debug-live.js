/**
 * 精确模拟 Worker handleMatch 的匹配逻辑
 */
const {
  calculateScore,
  getEffectiveThreshold,
  textToVector,
  normalizeNeed,
  inferIntentFromText
} = require('./match-core.js');

const msgA = `I moved to a new city a few months ago for work and still haven't found my people here. The loneliness gets heavy at night when I'm just sitting with my thoughts. I'm not looking for advice — I just need someone to genuinely hear me out without judgment.`;

const msgB = `I've always been the person my friends turn to when life gets heavy. There's something deeply meaningful about being fully present for someone — no advice, no fixing things, just listening with an open heart. If you need that kind of space, I'm here.`;

const lang = 'en';

// TF-IDF 嵌入（英文 word-bigram）
const embA = textToVector(msgA, lang);
const embB = textToVector(msgB, lang);

console.log('=== Worker handleMatch 模拟 ===\n');

// 场景 1: 两人 LLM intent_parse 都成功，返回正确的 need
console.log('--- 场景 1: LLM 都成功 ---');
const intentA_ok = { need: 'be heard', emo: 'lonely', depth: 'deep', style: 'responsive', signalDensity: 0.85 };
const intentB_ok = { need: 'listen to others', emo: 'warm', depth: 'deep', style: 'responsive', signalDensity: 0.80 };
const score1 = calculateScore(embA, embB, intentA_ok, intentB_ok, lang);
const thr1 = getEffectiveThreshold(100, lang);
console.log(`  score=${score1.toFixed(4)}, threshold=${thr1.toFixed(4)}, pass=${score1 >= thr1}`);

// 场景 2: User A LLM 失败，User B LLM 成功
console.log('\n--- 场景 2: User A LLM 失败（intent=null），依赖 text_snippet 推断 ---');
const snippetA = msgA.length > 200 ? msgA.slice(0, 200) : msgA;
const snippetB = msgB.length > 200 ? msgB.slice(0, 200) : msgB;
const inferredA = inferIntentFromText(snippetA, lang);
console.log(`  inferredA: need="${inferredA?.need}", emo="${inferredA?.emo}", depth="${inferredA?.depth}"`);
const score2 = calculateScore(embA, embB, null, intentB_ok, lang, snippetA, null);
const thr2 = getEffectiveThreshold(100, lang);
console.log(`  score=${score2.toFixed(4)}, threshold=${thr2.toFixed(4)}, pass=${score2 >= thr2}`);

// 场景 3: 两人 LLM 都失败
console.log('\n--- 场景 3: 两人 LLM 都失败，完全依赖 text_snippet 推断 ---');
const inferredB = inferIntentFromText(snippetB, lang);
console.log(`  inferredA: need="${inferredA?.need}"`);
console.log(`  inferredB: need="${inferredB?.need}"`);
const score3 = calculateScore(embA, embB, null, null, lang, snippetA, snippetB);
const thr3 = getEffectiveThreshold(100, lang);
console.log(`  score=${score3.toFixed(4)}, threshold=${thr3.toFixed(4)}, pass=${score3 >= thr3}`);

// 场景 4: Worker 未更新（旧代码，无降级推断）—— 用户 B 的 LLM 成功，但用户 A 的 issue 没存 intent
console.log('\n--- 场景 4: 旧 Worker 代码（calculateScore 无降级） ---');
const { calculateScore: oldCalculateScore } = (() => {
  // 模拟旧版 calculateScore（无 userText/otherText 参数）
  function oldCalc(userEmb, otherEmb, userIntent, otherIntent, lang) {
    const cfg = require('./match-core.js').ALGORITHM_CONFIG.scoring_weights;
    const cosineSim = require('./match-core.js').cosineSimilarity(userEmb, otherEmb);
    let intentCompat = 0.5;
    if (userIntent && otherIntent) {
      intentCompat = require('./match-core.js').calculateIntentCompatibility(userIntent, otherIntent, lang);
    }
    let styleCompat = 0.5;
    if (userIntent && otherIntent) {
      styleCompat = require('./match-core.js').calculateStyleCompatibility(userIntent.style, otherIntent.style, lang);
    }
    const signalA = (userIntent && typeof userIntent.signalDensity === 'number') ? userIntent.signalDensity : 0.5;
    const signalB = (otherIntent && typeof otherIntent.signalDensity === 'number') ? otherIntent.signalDensity : 0.5;
    let signalProduct = signalA * signalB;
    if (Math.abs(signalA - signalB) > 0.4) signalProduct *= 0.6;
    return cosineSim * 0.30 + intentCompat * 0.40 + styleCompat * 0.15 + signalProduct * 0.15;
  }
  return { calculateScore: oldCalc };
})();
// User A 的 issue 没有 intent (i 字段缺失), User B 的 LLM 成功
const score4a = oldCalculateScore(embA, embB, null, intentB_ok, lang);
console.log(`  A无intent + B有intent: score=${score4a.toFixed(4)}, pass=${score4a >= thr3}`);
// User B 的 LLM 也失败
const score4b = oldCalculateScore(embA, embB, null, null, lang);
console.log(`  A无intent + B无intent:  score=${score4b.toFixed(4)}, pass=${score4b >= thr3}`);

// 场景 5: LLM 返回了奇怪的 need 值，未被 normalizeNeed 完全处理
console.log('\n--- 场景 5: LLM 返回边界 need 值 ---');
const weirdNeeds = [
  'be heard / listen to others',
  'need someone to hear me',
  'wants to be heard',
  'just want someone to listen',
  'listener / be heard',
];
for (const raw of weirdNeeds) {
  const norm = normalizeNeed(raw, lang);
  console.log(`  "${raw}" → "${norm}"`);
}

// 场景 6: 检查 User A 对 User B（反向）—— User B 是搜索者，User A 在池中
console.log('\n--- 场景 6: 池中情况（100 pending）各种组合 ---');
const configs = [
  { name: '理想: 双方 LLM 都成功', uIntent: intentA_ok, oIntent: intentB_ok, uText: null, oText: null },
  { name: 'A的LLM失败(issue无intent) + B成功', uIntent: null, oIntent: intentB_ok, uText: snippetA, oText: null },
  { name: 'A成功 + B的LLM失败(当前用户)', uIntent: intentA_ok, oIntent: null, uText: null, oText: snippetB },
  { name: '双方LLM都失败', uIntent: null, oIntent: null, uText: snippetA, oText: snippetB },
];

for (const cfg of configs) {
  // 模拟 Worker 调用: calculateScore(embForScoring, otherEmbForScoring, userIntent, otherIntent, lang, userTextSnippet, otherTextSnippet)
  const s = calculateScore(embA, embB, cfg.oIntent, cfg.uIntent, lang, cfg.oText, cfg.uText);
  const thr = getEffectiveThreshold(100, lang);
  console.log(`  ${cfg.name.padEnd(40)} score=${s.toFixed(4)} thr=${thr.toFixed(4)} ${s >= thr ? '✓' : '✗'}`);
}
