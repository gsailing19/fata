/**
 * fata 参数优化器
 *
 * 在参数空间内随机搜索，综合中英文测试数据进行评估。
 * 输出 top-20 候选参数到 config/param-candidates.json。
 *
 * 用法:
 *   node tools/tune-params.js --samples 200          # 200 次随机采样（默认 500）
 *   node tools/tune-params.js --mode transformers     # BGE 保真度（慢但精确）
 *   node tools/tune-params.js --top 10               # 输出 top-10
 */

const fs = require('fs');
const path = require('path');
const {
  ALGORITHM_CONFIG, calculateScore, cosineSimilarity,
  calculateIntentCompatibility, calculateStyleCompatibility,
  getEffectiveThreshold, getCoolingFactor
} = require('./match-core.js');
const { generateEmbedding } = require('./embed.js');

// ===== 配置 =====

const SAMPLE_COUNT = parseInt(process.argv.includes('--samples')
  ? process.argv[process.argv.indexOf('--samples') + 1] : '500');
const TOP_N = parseInt(process.argv.includes('--top')
  ? process.argv[process.argv.indexOf('--top') + 1] : '20');
const MODE = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1] : 'bigram';

// ===== 参数空间 =====

const PARAM_SPACE = {
  emb_weight:    [0.20, 0.25, 0.30, 0.35, 0.40],
  intent_weight: [0.25, 0.30, 0.35, 0.40, 0.45],
  style_weight:  [0.10, 0.15, 0.20],
  signal_coef:   [0.10, 0.15, 0.20],
  cosine_threshold: [0.40, 0.42, 0.44, 0.46, 0.48, 0.50],
  cool_alpha:       [0.02, 0.03, 0.04, 0.05, 0.06],
  cool_alpha_low:   [0.01, 0.02, 0.03],
  cool_alpha_high:  [0.05, 0.07, 0.09],
  mmr_lambda:       [0.55, 0.60, 0.65, 0.70, 0.75]
};

// ===== 随机采样 =====

function randInt(max) { return Math.floor(Math.random() * max); }
function randChoice(arr) { return arr[randInt(arr.length)]; }

function sampleParams() {
  const emb = randChoice(PARAM_SPACE.emb_weight);
  const intent = randChoice(PARAM_SPACE.intent_weight);
  const style = randChoice(PARAM_SPACE.style_weight);
  const signal = randChoice(PARAM_SPACE.signal_coef);

  // 权重归一化约束：sum = 1.0
  const sum = emb + intent + style + signal;
  const w = {
    emb_weight: emb / sum,
    intent_weight: intent / sum,
    style_weight: style / sum,
    signal_coef: signal / sum
  };

  return {
    scoring_weights: w,
    cosine_threshold: randChoice(PARAM_SPACE.cosine_threshold),
    cool_alpha: randChoice(PARAM_SPACE.cool_alpha),
    cool_alpha_low: randChoice(PARAM_SPACE.cool_alpha_low),
    cool_alpha_high: randChoice(PARAM_SPACE.cool_alpha_high),
    mmr_lambda: randChoice(PARAM_SPACE.mmr_lambda)
  };
}

// ===== 应用参数 =====

function applyParams(params) {
  const cfg = ALGORITHM_CONFIG;
  const w = cfg.scoring_weights;
  w.emb_weight.value = params.scoring_weights.emb_weight;
  w.intent_weight.value = params.scoring_weights.intent_weight;
  w.style_weight.value = params.scoring_weights.style_weight;
  w.signal_coef.value = params.scoring_weights.signal_coef;
  cfg.thresholds.cosine_threshold.value = params.cosine_threshold;
  cfg.cooling.cool_alpha.value = params.cool_alpha;
  cfg.cooling.cool_alpha_low_pool.value = params.cool_alpha_low;
  cfg.cooling.cool_alpha_high_pool.value = params.cool_alpha_high;
  cfg.diversity.mmr_lambda.value = params.mmr_lambda;
}

function saveBaseline() {
  const cfg = ALGORITHM_CONFIG;
  return {
    emb_weight: cfg.scoring_weights.emb_weight.value,
    intent_weight: cfg.scoring_weights.intent_weight.value,
    style_weight: cfg.scoring_weights.style_weight.value,
    signal_coef: cfg.scoring_weights.signal_coef.value,
    cosine_threshold: cfg.thresholds.cosine_threshold.value,
    cool_alpha: cfg.cooling.cool_alpha.value,
    cool_alpha_low: cfg.cooling.cool_alpha_low_pool.value,
    cool_alpha_high: cfg.cooling.cool_alpha_high_pool.value,
    mmr_lambda: cfg.diversity.mmr_lambda.value
  };
}

function restoreBaseline(baseline) {
  const cfg = ALGORITHM_CONFIG;
  cfg.scoring_weights.emb_weight.value = baseline.emb_weight;
  cfg.scoring_weights.intent_weight.value = baseline.intent_weight;
  cfg.scoring_weights.style_weight.value = baseline.style_weight;
  cfg.scoring_weights.signal_coef.value = baseline.signal_coef;
  cfg.thresholds.cosine_threshold.value = baseline.cosine_threshold;
  cfg.cooling.cool_alpha.value = baseline.cool_alpha;
  cfg.cooling.cool_alpha_low_pool.value = baseline.cool_alpha_low;
  cfg.cooling.cool_alpha_high_pool.value = baseline.cool_alpha_high;
  cfg.diversity.mmr_lambda.value = baseline.mmr_lambda;
}

// ===== 评估一个参数组合 =====

async function evaluateParams(params, pairs, scenarios) {
  // 非空参数才应用（空参数 = 基线测试，保留当前配置）
  if (params.scoring_weights) {
    applyParams(params);
  }

  // 配对测试 → F1（中英文分别、加权平均）
  let zhTp = 0, zhFp = 0, zhTn = 0, zhFn = 0;
  let enTp = 0, enFp = 0, enTn = 0, enFn = 0;

  for (const pair of pairs) {
    const pairLang = pair.lang || 'zh';
    const embA = await generateEmbedding(pair.a.text || '', pairLang, MODE);
    const embB = await generateEmbedding(pair.b.text || '', pairLang, MODE);
    const score = calculateScore(embA, embB, pair.a, pair.b, pairLang);
    const threshold = getEffectiveThreshold(0);
    const predicted = score >= threshold;
    const actual = pair.expect === 'should_match';

    if (pairLang === 'en') {
      if (predicted && actual) enTp++;
      else if (predicted && !actual) enFp++;
      else if (!predicted && actual) enFn++;
      else enTn++;
    } else {
      if (predicted && actual) zhTp++;
      else if (predicted && !actual) zhFp++;
      else if (!predicted && actual) zhFn++;
      else zhTn++;
    }
  }

  const zhPrec = zhTp + zhFp > 0 ? zhTp / (zhTp + zhFp) : 0;
  const zhRec = zhTp + zhFn > 0 ? zhTp / (zhTp + zhFn) : 0;
  const zhF1 = zhPrec + zhRec > 0 ? 2 * zhPrec * zhRec / (zhPrec + zhRec) : 0;

  const enPrec = enTp + enFp > 0 ? enTp / (enTp + enFp) : 0;
  const enRec = enTp + enFn > 0 ? enTp / (enTp + enFn) : 0;
  const enF1 = enPrec + enRec > 0 ? 2 * enPrec * enRec / (enPrec + enRec) : 0;

  // 加权 F1（避免某个语言 F1=0 被另一语言的高分掩盖）
  const zhWeight = 0.5, enWeight = 0.5;
  const weightedF1 = zhF1 * zhWeight + enF1 * enWeight;

  // 场景评估 → Spearman（仅中文场景）
  const results = [];
  for (const sc of scenarios) {
    const intentA = sc.a._intent_missing ? null : sc.a;
    const intentB = sc.b._intent_missing ? null : sc.b;
    const lang = sc.lang || 'zh';
    const embA = await generateEmbedding(sc.a.text || '', lang, MODE);
    const embB = await generateEmbedding(sc.b.text || '', lang, MODE);
    const score = calculateScore(embA, embB, intentA, intentB, lang);
    results.push({ grade: { A: 4, B: 3, C: 2, D: 1 }[sc.grade] || 3, score });
  }

  const rho = spearmanRho(results.map(r => r.score), results.map(r => r.grade));

  // 综合得分
  const composite = 0.6 * weightedF1 + 0.4 * rho;

  return { zhF1, enF1, weightedF1, rho, composite };
}

// ===== Spearman 相关 =====

function rank(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  for (let i = 0; i < indexed.length; i++) {
    let j = i;
    while (j < indexed.length - 1 && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function spearmanRho(scores, grades) {
  const n = scores.length;
  const sr = rank(scores);
  const gr = rank(grades);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (sr[i] - gr[i]) ** 2;
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

// ===== 主流程 =====

async function main() {
  const testFile = path.join(__dirname, '..', 'config', 'test-pairs.json');
  const scenarioFile = path.join(__dirname, '..', 'config', 'scenario-tests.json');

  if (!fs.existsSync(testFile)) { console.error('test-pairs.json not found'); process.exit(1); }
  if (!fs.existsSync(scenarioFile)) { console.error('scenario-tests.json not found'); process.exit(1); }

  const pairs = JSON.parse(fs.readFileSync(testFile, 'utf8')).pairs;
  const scenarios = JSON.parse(fs.readFileSync(scenarioFile, 'utf8')).scenarios;

  const baseline = saveBaseline();
  console.log('═══════════════════════════════════════════');
  console.log('  fata 参数优化器');
  console.log('  采样数: ' + SAMPLE_COUNT + '  |  嵌入模式: ' + MODE);
  console.log('  配对: ' + pairs.length + '  |  场景: ' + scenarios.length);
  console.log('  基线: emb=' + baseline.emb_weight.toFixed(2) + ' intent=' + baseline.intent_weight.toFixed(2) + ' style=' + baseline.style_weight.toFixed(2) + ' signal=' + baseline.signal_coef.toFixed(2) + ' threshold=' + baseline.cosine_threshold.toFixed(2));
  console.log('═══════════════════════════════════════════');
  console.log('');

  // 评估基线
  const baseResult = await evaluateParams({}, pairs, scenarios);
  restoreBaseline(baseline);
  console.log('  基线:  zhF1=' + (baseResult.zhF1 * 100).toFixed(1) + '%  enF1=' + (baseResult.enF1 * 100).toFixed(1) + '%  ρ=' + baseResult.rho.toFixed(3) + '  score=' + baseResult.composite.toFixed(4));
  console.log('');

  // 随机搜索
  const candidates = [];
  let done = 0;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const params = sampleParams();
    const result = await evaluateParams(params, pairs, scenarios);
    restoreBaseline(baseline);

    candidates.push({ params, ...result });

    done++;
    if (done % 50 === 0 || done === SAMPLE_COUNT) {
      const best = candidates.reduce((a, b) => a.composite > b.composite ? a : b);
      process.stdout.write('\r  ' + done + '/' + SAMPLE_COUNT + '  best: score=' + best.composite.toFixed(4) + '  zhF1=' + (best.zhF1 * 100).toFixed(0) + '%  enF1=' + (best.enF1 * 100).toFixed(0) + '%  ρ=' + best.rho.toFixed(3) + '    ');
    }
  }

  console.log('');
  console.log('');

  // 排序取 top-N
  candidates.sort((a, b) => b.composite - a.composite);
  const top = candidates.slice(0, TOP_N);

  console.log('── Top ' + TOP_N + ' 参数候选 ──');
  console.log('');
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    const p = c.params;
    const mark = c.composite > baseResult.composite ? ' ↑' : c.composite < baseResult.composite - 0.01 ? ' ↓' : ' =';
    console.log('  #' + (i + 1).toString().padStart(2) + mark +
      '  score=' + c.composite.toFixed(4) +
      '  zhF1=' + (c.zhF1 * 100).toFixed(1) + '%  enF1=' + (c.enF1 * 100).toFixed(1) + '%  ρ=' + c.rho.toFixed(3));
    console.log('       emb=' + p.scoring_weights.emb_weight.toFixed(2) +
      '  intent=' + p.scoring_weights.intent_weight.toFixed(2) +
      '  style=' + p.scoring_weights.style_weight.toFixed(2) +
      '  signal=' + p.scoring_weights.signal_coef.toFixed(2) +
      '  thr=' + p.cosine_threshold.toFixed(2) +
      '  α=' + p.cool_alpha.toFixed(2) +
      '  α_low=' + p.cool_alpha_low.toFixed(2) +
      '  α_high=' + p.cool_alpha_high.toFixed(2) +
      '  λ=' + p.mmr_lambda.toFixed(2));
  }

  // 保存结果
  const output = {
    _generated: new Date().toISOString(),
    _mode: MODE,
    _samples: SAMPLE_COUNT,
    baseline: { ...baseResult, params: baseline },
    candidates: top.map(c => ({
      rank: top.indexOf(c) + 1,
      composite: c.composite,
      zhF1: c.zhF1,
      enF1: c.enF1,
      weightedF1: c.weightedF1,
      rho: c.rho,
      improvement: c.composite - baseResult.composite,
      params: c.params
    }))
  };

  const outFile = path.join(__dirname, '..', 'config', 'param-candidates.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log('');
  console.log('  Saved to config/param-candidates.json');
  console.log('═══════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
