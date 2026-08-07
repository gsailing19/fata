/**
 * fata Worker 匹配核心（纯逻辑，可本地单测）
 *
 * 从 config/worker.js findMatchInPool() 抽取的过滤、评分、MMR 和 debug 组装逻辑。
 * 本文件不涉及 GitHub fetch、KV 读写、AES 解密和邮件发送。
 */

const {
  ALGORITHM_CONFIG,
  calculateScore,
  cosineSimilarity,
  getEffectiveThreshold,
  mmrRerank,
  textToVector,
  awakeOverlapMinutes
} = require('./match-core.js');

// 解析 GitHub Issue 公开元数据。解密后的敏感字段由 findMatchInPool 适配层传入。
function parseCandidateContext(issueBody) {
  const body = issueBody || {};
  return {
    lang: body.l || 'zh',
    keyVersion: body._kv || 1,
    embeddingType: body.et || 'tfidf',
    timezoneOffset: Number.isFinite(Number(body.tzo)) ? Number(body.tzo) : null,
    awakeReason: body.r || '',
    textSnippet: typeof body.text_snippet === 'string' ? body.text_snippet : ''
  };
}

// 评估一个已经完成 KV 读取/解密的候选。
// user: { lang, embedding, embeddingType, tfidfEmbedding, emailHash, textSnippet, intent, context, timezoneOffset }
// candidate: { issue, issueNumber, body, context, embedding, embeddingType, textSnippet, emailHash, kvData, hasEmbeddingEnc }
function evaluateCandidate({ user, candidate, pendingCount }) {
  const matchLang = user.lang || 'zh';
  const userEmbType = user.embeddingType || 'tfidf';
  const userTzOffset = user && Number.isFinite(user.timezoneOffset) ? user.timezoneOffset : null;
  const issueContext = candidate.context || parseCandidateContext(candidate.body || {});
  const issueLang = issueContext.lang;
  const issueNumber = candidate.issueNumber != null ? candidate.issueNumber : (candidate.issue && candidate.issue.number);
  const minTimezoneOverlap = ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value;

  if (issueLang !== matchLang) {
    return {
      accepted: false,
      skipReason: 'lang_mismatch',
      langMismatch: { issue: issueNumber, lang: issueLang }
    };
  }

  if (userTzOffset !== null && issueContext.timezoneOffset !== null) {
    const overlap = awakeOverlapMinutes(userTzOffset, issueContext.timezoneOffset);
    if (overlap < minTimezoneOverlap) {
      return {
        accepted: false,
        skipReason: 'timezone_skip',
        timezoneSkip: { issue: issueNumber, overlapMinutes: +overlap.toFixed(1) }
      };
    }
  }

  if (issueContext.keyVersion < 4) {
    return {
      accepted: false,
      skipReason: 'old_format',
      debugEntry: { issue: issueNumber, skip: 'old_format' }
    };
  }

  let otherEmbForScoring = candidate.embedding || null;
  let otherEmbType = otherEmbForScoring ? (candidate.embeddingType || 'tfidf') : 'tfidf';
  // _kv>=4 的 snippet 只来自 FATA_DATA KV，不回退到公开 Issue body。
  let otherTextSnippet = candidate.textSnippet || '';

  if (!otherEmbForScoring && !otherTextSnippet) {
    return {
      accepted: false,
      skipReason: 'no_embedding_or_snippet',
      debugEntry: {
        issue: issueNumber,
        skip: 'no_embedding_or_snippet',
        hasKV: !!candidate.kvData,
        hasEmb: !!candidate.hasEmbeddingEnc
      }
    };
  }

  if (!otherEmbForScoring && otherTextSnippet) {
    otherEmbForScoring = textToVector(otherTextSnippet, issueLang);
    otherEmbType = 'tfidf';
  }

  let userEmbForScoring = user.embedding;
  let anyTypeMismatch = false;
  if (userEmbType !== otherEmbType) {
    anyTypeMismatch = true;
    if (user.tfidfEmbedding) userEmbForScoring = user.tfidfEmbedding;
    if (otherTextSnippet) {
      otherEmbForScoring = textToVector(otherTextSnippet, issueLang);
    } else {
      return {
        accepted: false,
        skipReason: 'type_mismatch_no_snippet',
        anyTypeMismatch,
        debugEntry: { issue: issueNumber, skip: 'type_mismatch_no_snippet', embType: otherEmbType }
      };
    }
  }

  const otherHash = candidate.emailHash || '';
  if (user.emailHash && otherHash && user.emailHash === otherHash) {
    return {
      accepted: false,
      skipReason: 'same_email',
      anyTypeMismatch,
      debugEntry: { issue: issueNumber, skip: 'same_email' }
    };
  }

  const baseScore = calculateScore(
    userEmbForScoring,
    otherEmbForScoring,
    user.intent || null,
    null,
    matchLang,
    user.textSnippet || '',
    otherTextSnippet,
    user.context || null,
    { awakeReason: issueContext.awakeReason, timezoneOffset: issueContext.timezoneOffset }
  );
  const threshold = getEffectiveThreshold(pendingCount, matchLang);

  if (baseScore >= threshold) {
    return {
      accepted: true,
      anyTypeMismatch,
      candidate: {
        issue: candidate.issue,
        embedding: otherEmbForScoring,
        score: baseScore,
        intent: null,
        emailHash: otherHash
      }
    };
  }

  return {
    accepted: false,
    skipReason: 'below_threshold',
    anyTypeMismatch,
    debugEntry: {
      issue: issueNumber,
      score: +baseScore.toFixed(4),
      threshold: +threshold.toFixed(4),
      embType: otherEmbType
    }
  };
}

// 候选排序 + MMR。anyTypeMismatch 时按生产逻辑改用 TF-IDF 兜底向量做 MMR。
function selectMatch(candidates, userEmb, options = {}) {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);
  let reranked = sorted;
  if (sorted.length > 1) {
    const mrrUserEmb = options.anyTypeMismatch ? (options.tfidfEmb || userEmb) : userEmb;
    reranked = mmrRerank(sorted, mrrUserEmb);
  }
  return { reranked, candidatesCount: reranked.length };
}

function buildMatchDebug({ entries, otherSeen, otherIds, langMismatches, timezoneSkips, timezoneSkipped, issueCount, matchLang }) {
  return {
    entries: (entries || []).slice(0, 5),
    otherSeen,
    otherIds: (otherIds || []).slice(0, 10),
    langMismatches: (langMismatches || []).slice(0, 5),
    timezoneSkips: (timezoneSkips || []).slice(0, 5),
    timezoneSkipped,
    issueCount,
    matchLang
  };
}

module.exports = {
  parseCandidateContext,
  evaluateCandidate,
  selectMatch,
  buildMatchDebug
};
