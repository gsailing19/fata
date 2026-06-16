/**
 * fata 匹配算法 — 场景模拟评估工具
 *
 * 用分级场景（A/B/C/D）评估算法评分与人类判断的吻合度。
 * 输出 Spearman 相关系数、等级分布、离群点、薄弱维度诊断和调优建议。
 *
 * 用法:
 *   node tools/evaluate-matching.js                  # 基线评估
 *   node tools/evaluate-matching.js --verbose        # 显示每个场景的详细拆解
 */

const fs = require('fs');
const path = require('path');

// ===== 算法配置（与 worker.js 同步） =====

const ALGORITHM_CONFIG = {
  _version: "3.0.0",
  scoring_weights: {
    emb_weight:       { value: 0.30 },
    intent_weight:    { value: 0.40 },
    style_weight:     { value: 0.15 },
    signal_coef:      { value: 0.15 },
    intent_channels: {
      need_complement:    { value: 0.35 },
      keyword_overlap:    { value: 0.10 },
      topic_overlap:      { value: 0.15 },
      emotion_resonance:  { value: 0.15 },
      depth_match:        { value: 0.10 },
      expect_align:       { value: 0.05 },
      gender_aware:       { value: 0.05 },
      relation_aim_compat:{ value: 0.10 }
    }
  },
  thresholds: { cosine_threshold: { value: 0.55 } },
  diversity: { mmr_lambda: { value: 0.65 } },
  cooling: {
    cool_alpha_low_pool:  { value: 0.08 },
    cool_alpha:           { value: 0.25 },
    cool_alpha_high_pool: { value: 0.35 }
  }
};

// ===== Embedding =====

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
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function calibrateCosine(raw, textA, textB) {
  let cal = 0.45 + raw * 2.5; // 斜率 2.5 平衡校准
  // 短文本阻尼：两段文字都短（<15字符）时 char-bigram 容易高估
  if (textA && textB && textA.length < 15 && textB.length < 15) cal *= 0.85;
  return Math.min(1.0, Math.max(0.0, cal));
}

// ===== 评分函数（与 worker.js 同步） =====

function calculateIntentCompatibility(user, other) {
  const ch = ALGORITHM_CONFIG.scoring_weights.intent_channels;
  let total = 0;

  const needPairs = { '被倾听': '想倾听他人', '想倾听他人': '被倾听', '想要建议': '想给建议', '想给建议': '想要建议', '找共鸣': '找共鸣', '深度探讨': '深度探讨', '闲聊': '闲聊' };
  let needScore = 0.3;
  const uNeed = user.need || '';
  const oNeed = other.need || '';
  if (uNeed && oNeed) {
    for (const [k, v] of Object.entries(needPairs)) {
      if (uNeed.includes(k) && oNeed.includes(v)) { needScore = 1.0; break; }
      if (uNeed.includes(v) && oNeed.includes(k)) { needScore = 1.0; break; }
    }
    if (needScore < 0.5 && uNeed === oNeed && uNeed !== '被倾听') needScore = 0.8;
  }
  if (uNeed === '被倾听' && oNeed === '被倾听') needScore = 0.1;
  if (needScore < 0.5 && ((uNeed === '被倾听' && oNeed === '找共鸣') || (uNeed === '找共鸣' && oNeed === '被倾听'))) needScore = 0.6;
  // 半兼容：闲聊↔深度探讨（都是社交需求，只是深度不同）
  if (needScore < 0.5 && ((uNeed === '闲聊' && oNeed === '深度探讨') || (uNeed === '深度探讨' && oNeed === '闲聊'))) needScore = 0.4;
  total += needScore * ch.need_complement.value;

  const uk = user.keywords || [], ok = other.keywords || [];
  let kwScore = 0.5;
  if (uk.length && ok.length) { let m = 0; for (const k of uk) { if (ok.includes(k)) m++; } kwScore = m / Math.max(uk.length, ok.length); }
  total += kwScore * ch.keyword_overlap.value;

  const ut = user.topics || [], ot = other.topics || [];
  let topicScore = 0.5;
  if (ut.length && ot.length) { const o = ut.filter(t => ot.includes(t)).length; topicScore = o > 0 ? Math.min(1, 0.5 + o * 0.25) : 0.3; }
  total += topicScore * ch.topic_overlap.value;

  let emoScore = 0.5;
  if (user.emo && other.emo) {
    if (user.emo === other.emo) { emoScore = 0.9; }
    else {
      const negKw = ['自责','无力','悲伤','崩溃','孤独','焦虑','压抑','难过','痛苦','绝望','麻木','疲惫','迷茫'];
      const posKw = ['愉快','开心','兴奋','平静','温暖','期待','好奇','轻松'];
      const uNeg = negKw.some(e => user.emo.includes(e)), oNeg = negKw.some(e => other.emo.includes(e));
      const uPos = posKw.some(e => user.emo.includes(e)), oPos = posKw.some(e => other.emo.includes(e));
      emoScore = (uNeg && oNeg) || (uPos && oPos) ? 0.65 : 0.35;
    }
  }
  total += emoScore * ch.emotion_resonance.value;

  let depthScore = 0.5;
  if (user.depth && other.depth) {
    if (user.depth === other.depth) depthScore = 1.0;
    else if (Math.abs(['表面','中等','深度'].indexOf(user.depth) - ['表面','中等','深度'].indexOf(other.depth)) <= 1) depthScore = 0.7;
    else depthScore = 0.3;
  }
  total += depthScore * ch.depth_match.value;

  let expectScore = 0.5;
  if (user.expect && other.expect) expectScore = user.expect === other.expect ? 1.0 : 0.3;
  total += expectScore * ch.expect_align.value;

  let genderScore = 0.5;
  if (user.gender_ref && other.gender_ref) {
    if (user.gender_ref === other.gender_ref) genderScore = 1.0;
    else if (user.gender_ref !== '未提及' && other.gender_ref !== '未提及') genderScore = 0.6;
    else genderScore = 0.7;
  }
  total += genderScore * ch.gender_aware.value;

  let aimScore = 0.5;
  if (user.relation_aim && other.relation_aim) {
    if (user.relation_aim === other.relation_aim) aimScore = 1.0;
    else if ((user.relation_aim === '情感支持' && other.relation_aim === '深度对话') || (user.relation_aim === '深度对话' && other.relation_aim === '情感支持')) aimScore = 0.8;
    else aimScore = 0.4;
  }
  total += aimScore * ch.relation_aim_compat.value;

  return Math.min(1.0, Math.max(0.0, total));
}

function calculateStyleCompatibility(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.5;
  if ((a === '主动型' && b === '回应型') || (a === '回应型' && b === '主动型')) return 0.9;
  if ((a === '严肃型' && b === '回应型') || (a === '回应型' && b === '严肃型')) return 0.6;
  // 半兼容组合
  if ((a === '调侃型' && b === '严肃型') || (a === '严肃型' && b === '调侃型')) return 0.5;
  if ((a === '调侃型' && b === '回应型') || (a === '回应型' && b === '调侃型')) return 0.5;
  if ((a === '主动型' && b === '严肃型') || (a === '严肃型' && b === '主动型')) return 0.5;
  if (a === '不确定' || b === '不确定') return 0.6;
  return 0.3;
}

function calculateScore(userEmb, otherEmb, userIntent, otherIntent, textA, textB) {
  const cfg = ALGORITHM_CONFIG.scoring_weights;
  const rawCosine = cosineSimilarity(userEmb, otherEmb);
  const cosineSim = calibrateCosine(rawCosine, textA, textB);

  let intentCompat = 0.5;
  if (userIntent && otherIntent) intentCompat = calculateIntentCompatibility(userIntent, otherIntent);

  let styleCompat = 0.5;
  if (userIntent && otherIntent) styleCompat = calculateStyleCompatibility(userIntent.style, otherIntent.style);

  const signalA = (userIntent && typeof userIntent.signalDensity === 'number') ? userIntent.signalDensity : 0.5;
  const signalB = (otherIntent && typeof otherIntent.signalDensity === 'number') ? otherIntent.signalDensity : 0.5;
  let signalProduct = signalA * signalB;
  // 信号悬殊惩罚：一方高质量一方敷衍，匹配体验差
  if (Math.abs(signalA - signalB) > 0.4) signalProduct *= 0.6;

  let score = cosineSim * cfg.emb_weight.value + intentCompat * cfg.intent_weight.value + styleCompat * cfg.style_weight.value + signalProduct * cfg.signal_coef.value;

  // 双低信号全局惩罚
  if (signalA <= 0.3 && signalB <= 0.3) score *= 0.6;

  // 双向等待全局惩罚：needScore=0.1 时其他维度应适当降权
  if (userIntent && otherIntent && userIntent.need === '被倾听' && otherIntent.need === '被倾听') {
    score *= 0.85;
  }

  return score;
}

// ===== 评估逻辑 =====

const GRADE_ORDER = { A: 4, B: 3, C: 2, D: 1 };
const GRADE_LABEL = { A: '绝配', B: '良配', C: '弱配', D: '不配' };

function spearmanRho(scores, grades) {
  const n = scores.length;

  // Rank scores
  const scoreRanks = rank(scores);
  const gradeRanks = rank(grades);

  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (scoreRanks[i] - gradeRanks[i]) ** 2;

  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function rank(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  for (let i = 0; i < indexed.length; i++) {
    // Handle ties: assign average rank
    let j = i;
    while (j < indexed.length - 1 && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function analyzeWeakDimensions(results) {
  // 每个场景计算其各维度的"贡献偏离度"
  const dims = ['need', 'emotion', 'topic', 'depth', 'style', 'signal', 'aim'];
  const dimIssues = {};

  for (const r of results) {
    const gradeNum = GRADE_ORDER[r.scenario.grade];
    const scoreNorm = r.score; // already in [0,1]

    for (const dim of dims) {
      if (!dimIssues[dim]) dimIssues[dim] = { overCount: 0, underCount: 0, examples: [] };
      const contrib = r.channelContributions[dim] || 0;
      const expectedContrib = gradeNum / 4 * 0.25; // rough expectation

      if (contrib > expectedContrib + 0.08 && r.rankMismatch > 1) {
        dimIssues[dim].overCount++;
        if (dimIssues[dim].examples.length < 2) dimIssues[dim].examples.push(r.scenario.id + '(↑)');
      }
      if (contrib < expectedContrib - 0.08 && r.rankMismatch < -1) {
        dimIssues[dim].underCount++;
        if (dimIssues[dim].examples.length < 2) dimIssues[dim].examples.push(r.scenario.id + '(↓)');
      }
    }
  }
  return dimIssues;
}

// ===== 主流程 =====

function main() {
  const scenarioFile = path.join(__dirname, '..', 'config', 'scenario-tests.json');
  const scenarios = JSON.parse(fs.readFileSync(scenarioFile, 'utf8')).scenarios;

  const verbose = process.argv.includes('--verbose');

  console.log('══════════════════════════════════════════════');
  console.log('  fata 匹配算法 · 场景模拟评估');
  console.log('  配置: algorithm-config v' + ALGORITHM_CONFIG._version);
  console.log('  场景数: ' + scenarios.length + '  |  等级分布: ' +
    ['A','B','C','D'].map(g => g + '=' + scenarios.filter(s => s.grade === g).length).join(', '));
  console.log('══════════════════════════════════════════════');
  console.log('');

  const results = [];
  let misclassifications = 0;

  for (const sc of scenarios) {
    const a = sc.a, b = sc.b;

    // 处理一方 intent 缺失
    const intentA = a._intent_missing ? null : a;
    const intentB = b._intent_missing ? null : b;

    const embA = charBigramVector(a.text || '');
    const embB = charBigramVector(b.text || '');
    const rawCosine = cosineSimilarity(embA, embB);
    const calCosine = calibrateCosine(rawCosine, a.text, b.text);

    const intentCompat = calculateIntentCompatibility(intentA || {}, intentB || {});
    const styleCompat = calculateStyleCompatibility(intentA?.style, intentB?.style);
    const sigA = (intentA && typeof intentA.signalDensity === 'number') ? intentA.signalDensity : 0.5;
    const sigB = (intentB && typeof intentB.signalDensity === 'number') ? intentB.signalDensity : 0.5;

    const score = calculateScore(embA, embB, intentA, intentB, a.text, b.text);

    const gradeNum = GRADE_ORDER[sc.grade];
    results.push({
      scenario: sc,
      score,
      rawCosine,
      calCosine,
      intentCompat,
      styleCompat,
      sigA,
      sigB,
      gradeNum,
      channelContributions: {
        need: intentCompat * 0.35 * (intentA && intentB ? 0.30 : 0),
        emotion: intentCompat * 0.35 * (intentA && intentB ? 0.15 : 0),
        topic: intentCompat * 0.35 * (intentA && intentB ? 0.15 : 0),
        depth: intentCompat * 0.35 * (intentA && intentB ? 0.10 : 0),
        style: styleCompat * 0.15,
        signal: sigA * sigB * 0.15,
        aim: intentCompat * 0.35 * (intentA && intentB ? 0.10 : 0)
      }
    });
  }

  // 按分数排序
  results.sort((a, b) => b.score - a.score);

  // Spearman 相关
  const scores = results.map(r => r.score);
  const grades = results.map(r => r.gradeNum);
  const rho = spearmanRho(scores, grades);

  // 计算 rank mismatch
  const scoreRanks = rank(scores);
  const gradeRanks = rank(grades);
  for (let i = 0; i < results.length; i++) {
    results[i].rankMismatch = scoreRanks[i] - gradeRanks[i];
  }

  // 输出每个场景
  if (verbose) {
    console.log('── 场景评分详情 ──');
    console.log('');
    for (const r of [...results].sort((a, b) => b.score - a.score)) {
      const sc = r.scenario;
      const bar = '█'.repeat(Math.round(r.score * 40));
      console.log('  ' + sc.grade + ' | ' + sc.id.padEnd(32) + ' ' + r.score.toFixed(3) + '  ' + bar);
      console.log('      ' + sc.reason.slice(0, 100));
      console.log('      余弦=' + r.rawCosine.toFixed(3) + '→校准' + r.calCosine.toFixed(3) + '  意图=' + r.intentCompat.toFixed(3) + '  风格=' + r.styleCompat.toFixed(2) + '  信号=' + r.sigA.toFixed(2) + '×' + r.sigB.toFixed(2));
    }
  } else {
    // 简洁输出
    for (const r of [...results].sort((a, b) => b.score - a.score)) {
      const sc = r.scenario;
      const mismatch = Math.abs(r.rankMismatch) > 2 ? ' ⚠' : '';
      console.log('  ' + sc.grade + ' | ' + sc.id.padEnd(32) + ' ' + r.score.toFixed(3) + mismatch);
    }
  }

  console.log('');

  // 等级分布
  console.log('── 等级分数分布 ──');
  for (const g of ['A', 'B', 'C', 'D']) {
    const group = results.filter(r => r.scenario.grade === g);
    if (group.length === 0) continue;
    const gScores = group.map(r => r.score).sort((a, b) => a - b);
    const min = gScores[0], max = gScores[gScores.length - 1];
    const mean = gScores.reduce((a, b) => a + b, 0) / gScores.length;
    const std = Math.sqrt(gScores.reduce((s, v) => s + (v - mean) ** 2, 0) / gScores.length);
    console.log('  ' + g + '级(' + GRADE_LABEL[g] + '): n=' + group.length + '  min=' + min.toFixed(3) + '  max=' + max.toFixed(3) + '  mean=' + mean.toFixed(3) + '  std=' + std.toFixed(3));
  }

  // 等级间隔
  console.log('');
  console.log('── 等级分界线间隔 ──');
  const prevMax = {};
  for (const g of ['A', 'B', 'C', 'D']) {
    const group = results.filter(r => r.scenario.grade === g);
    if (group.length === 0) continue;
    const gMin = Math.min(...group.map(r => r.score));
    if (prevMax.value !== undefined) {
      const gap = gMin - prevMax.value;
      const icon = gap > 0.03 ? '✓' : gap > 0 ? '△' : '✗ 重叠!';
      console.log('  ' + prevMax.grade + '→' + g + ': 间隔=' + gap.toFixed(3) + '  ' + icon + '  (' + prevMax.grade + '最高=' + prevMax.value.toFixed(3) + ', ' + g + '最低=' + gMin.toFixed(3) + ')');
    }
    prevMax.value = Math.max(...group.map(r => r.score));
    prevMax.grade = g;
  }

  // 误分类
  console.log('');
  console.log('── 误分类检测 ──');
  const gradeOrder = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < gradeOrder.length - 1; i++) {
    const higher = results.filter(r => r.scenario.grade === gradeOrder[i]);
    const lower = results.filter(r => r.scenario.grade === gradeOrder[i + 1]);
    if (higher.length === 0 || lower.length === 0) continue;
    const highMin = Math.min(...higher.map(r => r.score));
    const lowMax = Math.max(...lower.map(r => r.score));
    if (lowMax > highMin) {
      const violators = results.filter(r =>
        (r.scenario.grade === gradeOrder[i + 1] && r.score > highMin) ||
        (r.scenario.grade === gradeOrder[i] && r.score < lowMax)
      );
      console.log('  ✗ ' + gradeOrder[i] + '↔' + gradeOrder[i + 1] + ' 交叉: ' + violators.map(r => r.scenario.id + '(' + r.scenario.grade + '=' + r.score.toFixed(3) + ')').join(', '));
      misclassifications += violators.length;
    } else {
      console.log('  ✓ ' + gradeOrder[i] + '↔' + gradeOrder[i + 1] + ' 无交叉');
    }
  }

  // 离群点
  console.log('');
  console.log('── 离群点（排序偏差最大的 3 个场景）──');
  const byMismatch = [...results].sort((a, b) => Math.abs(b.rankMismatch) - Math.abs(a.rankMismatch));
  for (const r of byMismatch.slice(0, 3)) {
    const dir = r.rankMismatch > 0 ? '偏高' : '偏低';
    console.log('  ' + r.scenario.grade + ' ' + r.scenario.id.padEnd(32) + ' score=' + r.score.toFixed(3) + '  排序' + dir + ' ' + Math.abs(r.rankMismatch).toFixed(0) + '位');
    console.log('    ' + r.scenario.reason.slice(0, 90));
  }

  // 薄弱维度
  console.log('');
  console.log('── 薄弱维度诊断 ──');
  const dimIssues = analyzeWeakDimensions(results);
  let hasIssues = false;
  for (const [dim, info] of Object.entries(dimIssues)) {
    if (info.overCount + info.underCount > 0) {
      hasIssues = true;
      const parts = [];
      if (info.overCount > 0) parts.push('偏高×' + info.overCount);
      if (info.underCount > 0) parts.push('偏低×' + info.underCount);
      console.log('  ' + dim.padEnd(10) + ' ' + parts.join(', ') + '  ' + info.examples.join(', '));
    }
  }
  if (!hasIssues) console.log('  无明显薄弱维度');

  // 调优建议
  console.log('');
  console.log('── 调优建议 ──');
  const suggestions = [];
  if (rho < 0.85) suggestions.push('Spearman 相关系数 ' + rho.toFixed(2) + ' < 0.85，排序一致性需提升');
  if (rho >= 0.85 && rho < 0.95) suggestions.push('Spearman ' + rho.toFixed(2) + ' 良好但可向 0.95+ 优化');
  if (misclassifications > 0) suggestions.push('存在 ' + misclassifications + ' 个跨等级误分类，检查对应场景的维度权重');
  // Dimension-specific suggestions
  const needIssues = dimIssues['need'];
  if (needIssues && needIssues.overCount > needIssues.underCount) suggestions.push('need_complement 权重可能偏高，考虑从 0.30 降至 0.25');
  if (needIssues && needIssues.underCount > needIssues.overCount) suggestions.push('need_complement 权重可能偏低，考虑从 0.30 升至 0.35');
  const emoIssues = dimIssues['emotion'];
  if (emoIssues && emoIssues.underCount > 0) suggestions.push('emotion_resonance 对同组情绪的区分度不够，考虑提高同组得分(0.65→0.72)');
  const styleIssues = dimIssues['style'];
  if (styleIssues && styleIssues.overCount > 0) suggestions.push('style 通道对风格差异惩罚过重，考虑增加半兼容风格组合');

  if (suggestions.length === 0) suggestions.push('当前参数配置良好，无需调整');

  for (const s of suggestions) console.log('  → ' + s);

  // 总结
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  评估总结');
  console.log('══════════════════════════════════════════════');
  console.log('  Spearman ρ:  ' + rho.toFixed(3) + '  (' + (rho >= 0.90 ? '优秀' : rho >= 0.85 ? '良好' : rho >= 0.70 ? '一般' : '需改进') + ')');
  console.log('  误分类:      ' + misclassifications + '/' + scenarios.length);
  console.log('  等级间隔:    ' + (misclassifications === 0 ? '清晰' : '有交叉'));
  console.log('  整体评级:    ' + (rho >= 0.90 && misclassifications === 0 ? 'A - 优秀' : rho >= 0.85 ? 'B - 良好' : 'C - 需优化'));
  console.log('══════════════════════════════════════════════');

  process.exit(rho >= 0.85 && misclassifications === 0 ? 0 : 1);
}

main();
