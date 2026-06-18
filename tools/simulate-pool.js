/**
 * fata 池模拟测试
 *
 * 模拟完整匹配流水线：生成嵌入 → 评分 → 阈值过滤 → 排序 → MMR 重排 → 与预期对比。
 * 使用 match-core.js 中的生产级评分函数和 MMR 重排。
 *
 * 用法:
 *   node tools/simulate-pool.js                              # 全部池，bigram 模式
 *   node tools/simulate-pool.js --pool-id small_zh_complement # 单个池
 *   node tools/simulate-pool.js --mode transformers           # BGE 保真度
 *   node tools/simulate-pool.js --verbose                    # 详细输出
 */

const fs = require('fs');
const path = require('path');
const {
  ALGORITHM_CONFIG, calculateScore, cosineSimilarity,
  getEffectiveThreshold, mmrRerank
} = require('./match-core.js');
const { generateEmbeddings } = require('./embed.js');

// ===== NDCG 计算 =====

function dcg(relevances, k) {
  let score = 0;
  for (let i = 0; i < Math.min(k, relevances.length); i++) {
    score += (Math.pow(2, relevances[i]) - 1) / Math.log2(i + 2);
  }
  return score;
}

function ndcg(predictedRelevances, idealRelevances, k) {
  const idealDcg = dcg(idealRelevances, k);
  return idealDcg === 0 ? 0 : dcg(predictedRelevances, k) / idealDcg;
}

// ===== 主流程 =====

async function main() {
  const poolFile = path.join(__dirname, '..', 'config', 'pool-tests.json');
  const pools = JSON.parse(fs.readFileSync(poolFile, 'utf8')).pools;

  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'bigram';
  const poolIdIdx = args.indexOf('--pool-id');
  const poolIdFilter = poolIdIdx >= 0 ? args[poolIdIdx + 1] : null;

  const filtered = poolIdFilter ? pools.filter(p => p.id === poolIdFilter) : pools;

  console.log('═══════════════════════════════════════════');
  console.log('  fata 池模拟测试');
  console.log('  嵌入模式: ' + mode + '  |  池数量: ' + filtered.length);
  console.log('  阈值: base=' + ALGORITHM_CONFIG.thresholds.cosine_threshold.value.toFixed(2) + ' + cooling');
  console.log('═══════════════════════════════════════════');
  console.log('');

  let totalPools = 0;
  let poolsPassed = 0;

  for (const pool of filtered) {
    totalPools++;
    const lang = pool.lang || 'zh';
    const threshold = getEffectiveThreshold(pool.pool_size_hint);

    // 生成查询嵌入
    const queryEmb = (await generateEmbeddings([pool.query.text], lang, mode))[0];

    // 生成所有候选嵌入
    const candidateTexts = pool.candidates.map(c => c.text);
    const candidateEmbs = await generateEmbeddings(candidateTexts, lang, mode);

    // 评分
    const scored = pool.candidates.map((c, i) => ({
      ...c,
      embedding: candidateEmbs[i],
      score: calculateScore(queryEmb, candidateEmbs[i], pool.query.intent, c.intent, lang),
      cosineSim: cosineSimilarity(queryEmb, candidateEmbs[i])
    }));

    // 阈值过滤
    const aboveThreshold = scored.filter(s => s.score >= threshold);

    // 排序
    aboveThreshold.sort((a, b) => b.score - a.score);

    // MMR 重排（如果超过 1 个候选）
    let reranked = aboveThreshold;
    if (aboveThreshold.length > 1) {
      reranked = mmrRerank(aboveThreshold, queryEmb);
    }

    // 计算指标
    const relevances = reranked.map(r => r.relevance);
    const idealRelevances = pool.candidates
      .map(c => c.relevance)
      .sort((a, b) => b - a);

    const ndcg3 = ndcg(relevances, idealRelevances, 3);
    const ndcg5 = ndcg(relevances, idealRelevances, 5);
    const precision1 = reranked.length > 0 ? (reranked[0].relevance >= 3 ? 1 : 0) : 0;
    const matchRate = (aboveThreshold.length / pool.candidates.length);
    const diversity = reranked.length > 1
      ? (1 - cosineSimilarity(reranked[0].embedding, reranked[1].embedding)).toFixed(3)
      : 'n/a';

    // 验证预期
    let checksPassed = 0, checksFailed = 0;
    if (pool.expected.top_1_relevance_min !== undefined) {
      if (reranked.length > 0 && reranked[0].relevance >= pool.expected.top_1_relevance_min) {
        checksPassed++;
      } else {
        checksFailed++;
      }
    }
    if (pool.expected.should_not_include) {
      const top3Ids = reranked.slice(0, 3).map(r => r.id);
      const violations = pool.expected.should_not_include.filter(id => top3Ids.includes(id));
      if (violations.length === 0) checksPassed++;
      else checksFailed++;
    }
    if (pool.expected.min_ndcg_at_3 !== undefined) {
      if (ndcg3 >= pool.expected.min_ndcg_at_3) checksPassed++;
      else checksFailed++;
    }

    const poolPassed = checksFailed === 0;
    if (poolPassed) poolsPassed++;

    console.log('── ' + (poolPassed ? '✓' : '✗') + ' ' + pool.id + ' (' + lang + ') ──');
    console.log('  Candidates: ' + pool.candidates.length + '  |  Above threshold: ' + aboveThreshold.length + '  |  Match rate: ' + (matchRate * 100).toFixed(0) + '%');
    console.log('  NDCG@3: ' + ndcg3.toFixed(3) + '  |  NDCG@5: ' + ndcg5.toFixed(3) + '  |  P@1: ' + precision1 + '  |  Diversity: ' + diversity);

    if (verbose) {
      console.log('  Rankings:');
      for (const r of reranked) {
        const bar = '█'.repeat(Math.round(r.score * 30));
        console.log('    ' + r.relevance + ' | ' + r.id.padEnd(24) + ' ' + r.score.toFixed(3) + ' cos=' + r.cosineSim.toFixed(3) + ' ' + bar);
      }
    }

    if (!poolPassed) {
      console.log('  Failures:');
      if (reranked.length > 0 && reranked[0].relevance < (pool.expected.top_1_relevance_min || 0)) {
        console.log('    Top-1 relevance ' + reranked[0].relevance + ' < ' + pool.expected.top_1_relevance_min);
      }
      if (pool.expected.should_not_include) {
        const top3Ids = reranked.slice(0, 3).map(r => r.id);
        const violations = pool.expected.should_not_include.filter(id => top3Ids.includes(id));
        for (const v of violations) {
          console.log('    ' + v + ' should not be in top-3');
        }
      }
      if (ndcg3 < (pool.expected.min_ndcg_at_3 || 0)) {
        console.log('    NDCG@3 ' + ndcg3.toFixed(3) + ' < ' + pool.expected.min_ndcg_at_3);
      }
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════');
  console.log('  Result: ' + poolsPassed + '/' + totalPools + ' pools passed');
  console.log('═══════════════════════════════════════════');

  process.exit(poolsPassed === totalPools ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
