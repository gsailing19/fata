/**
 * fata Worker 匹配核心纯函数测试
 *
 * 覆盖 tools/worker-match-core.js：元数据解析、语言隔离、时区硬过滤、
 * 同邮箱排除、上下文评分、阈值冷却、MMR 和 debug 结构。
 * 不联网、不加密、不读写线上数据。
 */

const {
  ALGORITHM_CONFIG,
  charBigramVector,
  mmrRerank,
  getEffectiveThreshold
} = require('./match-core.js');
const {
  parseCandidateContext,
  evaluateCandidate,
  selectMatch,
  buildMatchDebug
} = require('./worker-match-core.js');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label} — ${detail || ''}`);
  }
}

function makeUser(overrides = {}) {
  return {
    lang: 'zh',
    embedding: charBigramVector('最近失眠越来越严重，脑子停不下来'),
    embeddingType: 'tfidf',
    tfidfEmbedding: null,
    emailHash: 'user-hash',
    textSnippet: '最近失眠越来越严重，脑子停不下来',
    intent: null,
    context: { awakeReason: 'insomnia', timezoneOffset: 480 },
    timezoneOffset: 480,
    ...overrides
  };
}

function makeCandidate(overrides = {}) {
  const body = {
    _kv: 4,
    l: 'zh',
    et: 'tfidf',
    tzo: 480,
    r: 'insomnia',
    ...(overrides.body || {})
  };
  const candidate = {
    issue: { number: 101, labels: [{ name: 'pending' }] },
    issueNumber: 101,
    body,
    context: parseCandidateContext(body),
    embedding: charBigramVector('最近失眠越来越严重，脑子停不下来'),
    embeddingType: 'tfidf',
    textSnippet: '最近失眠越来越严重，脑子停不下来',
    emailHash: 'other-hash',
    kvData: { embedding_enc: 'x' },
    hasEmbeddingEnc: true,
    ...overrides
  };
  if (overrides.body && !overrides.context) {
    candidate.context = parseCandidateContext(candidate.body);
  }
  return candidate;
}

// ===== 元数据解析 =====

(function metadataParsing() {
  const ctx = parseCandidateContext({
    _kv: 4,
    l: 'en',
    et: 'bge-m3',
    tzo: '-300',
    r: 'night_shift',
    text_snippet: 'hello'
  });
  assert('parse: valid metadata fields', ctx.lang === 'en' && ctx.keyVersion === 4 && ctx.embeddingType === 'bge-m3', JSON.stringify(ctx));
  assert('parse: tzo string converted to number', ctx.timezoneOffset === -300, `tzo=${ctx.timezoneOffset}`);
  assert('parse: reason passthrough', ctx.awakeReason === 'night_shift');
  assert('parse: text snippet passthrough', ctx.textSnippet === 'hello');

  assert('parse: empty body defaults zh/tfidf/kv1', (() => {
    const c = parseCandidateContext({});
    return c.lang === 'zh' && c.embeddingType === 'tfidf' && c.keyVersion === 1 && c.timezoneOffset === null;
  })(), JSON.stringify(parseCandidateContext({})));
  assert('parse: _kv 0 is treated as legacy 1 (prod behavior)', parseCandidateContext({ _kv: 0 }).keyVersion === 1);
  assert('parse: invalid tzo is null', parseCandidateContext({ _kv: 4, tzo: 'bad' }).timezoneOffset === null);
})();

// ===== 时区硬过滤 =====

(function timezoneHardFilter() {
  const originalMin = ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value;
  try {
    // -60 与 +60 的夜间窗口正好重叠 180 分钟。
    const user = makeUser({ timezoneOffset: -60, context: { awakeReason: 'insomnia', timezoneOffset: -60 } });
    const candidate = makeCandidate({ body: { _kv: 4, l: 'zh', et: 'tfidf', tzo: 60, r: 'insomnia' } });

    ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value = 180;
    assert('tz: exactly 180 min accepted', evaluateCandidate({ user, candidate, pendingCount: 50 }).accepted === true);

    ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value = 181;
    const rejected = evaluateCandidate({ user, candidate, pendingCount: 50 });
    assert('tz: 180 min rejected when min is 181', rejected.accepted === false && rejected.skipReason === 'timezone_skip', JSON.stringify(rejected));
    assert('tz: skip reports overlap', rejected.timezoneSkip && rejected.timezoneSkip.overlapMinutes === 180, JSON.stringify(rejected.timezoneSkip));
  } finally {
    ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value = originalMin;
  }

  assert('tz: user missing offset accepted', evaluateCandidate({
    user: makeUser({ timezoneOffset: null, context: { awakeReason: 'insomnia', timezoneOffset: null } }),
    candidate: makeCandidate(),
    pendingCount: 50
  }).accepted === true);

  assert('tz: candidate missing offset accepted', evaluateCandidate({
    user: makeUser(),
    candidate: makeCandidate({ body: { _kv: 4, l: 'zh', et: 'tfidf', r: 'insomnia' } }),
    pendingCount: 50
  }).accepted === true);
})();

// ===== 语言隔离 =====

(function languageIsolation() {
  const result = evaluateCandidate({
    user: makeUser(),
    candidate: makeCandidate({ body: { _kv: 4, l: 'en', et: 'tfidf', tzo: 480, r: 'insomnia' } }),
    pendingCount: 50
  });
  assert('lang: different language skipped', result.accepted === false && result.skipReason === 'lang_mismatch');
  assert('lang: mismatch captured for debug', result.langMismatch && result.langMismatch.lang === 'en');
})();

// ===== 同邮箱排除 =====

(function sameEmailExclusion() {
  const result = evaluateCandidate({
    user: makeUser({ emailHash: 'same-hash' }),
    candidate: makeCandidate({ emailHash: 'same-hash' }),
    pendingCount: 50
  });
  assert('email: same hash skipped', result.accepted === false && result.skipReason === 'same_email');
  assert('email: debug skip reason', result.debugEntry && result.debugEntry.skip === 'same_email');

  assert('email: missing other hash accepted', evaluateCandidate({
    user: makeUser(),
    candidate: makeCandidate({ emailHash: '' }),
    pendingCount: 50
  }).accepted === true);
})();

// ===== 旧格式 / 缺 embedding =====

(function legacyAndMissingData() {
  const old = evaluateCandidate({
    user: makeUser(),
    candidate: makeCandidate({ body: { _kv: 2, l: 'zh', et: 'tfidf', tzo: 480, r: 'insomnia' } }),
    pendingCount: 50
  });
  assert('kv: _kv 2 skipped as old_format', old.accepted === false && old.skipReason === 'old_format');

  const missing = evaluateCandidate({
    user: makeUser(),
    candidate: makeCandidate({ embedding: null, embeddingType: 'tfidf', textSnippet: '' }),
    pendingCount: 50
  });
  assert('kv: no embedding or snippet skipped', missing.accepted === false && missing.skipReason === 'no_embedding_or_snippet');
  assert('kv: missing debug carries hasKV', missing.debugEntry && missing.debugEntry.hasKV === true);

  const typeMismatchNoSnippet = evaluateCandidate({
    user: makeUser({ embeddingType: 'bge-m3' }),
    candidate: makeCandidate({ embeddingType: 'tfidf', textSnippet: '' }),
    pendingCount: 50
  });
  assert('type: mismatch without snippet skipped', typeMismatchNoSnippet.accepted === false && typeMismatchNoSnippet.skipReason === 'type_mismatch_no_snippet');

  const typeMismatchWithSnippet = evaluateCandidate({
    user: makeUser({ embeddingType: 'bge-m3', textSnippet: '最近失眠越来越严重，脑子停不下来' }),
    candidate: makeCandidate({ embeddingType: 'tfidf', textSnippet: '最近失眠越来越严重，脑子停不下来' }),
    pendingCount: 50
  });
  assert('type: mismatch with snippet converted and accepted', typeMismatchWithSnippet.accepted === true);
})();

// ===== 上下文评分 =====

(function contextScoring() {
  const baseUser = makeUser();
  const same = evaluateCandidate({
    user: baseUser,
    candidate: makeCandidate({ body: { _kv: 4, l: 'zh', et: 'tfidf', tzo: 480, r: 'insomnia' } }),
    pendingCount: 50
  }).candidate.score;
  const compatible = evaluateCandidate({
    user: baseUser,
    candidate: makeCandidate({ body: { _kv: 4, l: 'zh', et: 'tfidf', tzo: 480, r: 'overthinking' } }),
    pendingCount: 50
  }).candidate.score;
  const neutral = evaluateCandidate({
    user: baseUser,
    candidate: makeCandidate({ body: { _kv: 4, l: 'zh', et: 'tfidf', tzo: 480 } }),
    pendingCount: 50
  }).candidate.score;

  assert('ctx: same reason scores above compatible', same > compatible, `same=${same} compatible=${compatible}`);
  assert('ctx: compatible scores above neutral', compatible > neutral, `compatible=${compatible} neutral=${neutral}`);

  const originalMin = ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value;
  try {
    ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value = 0;
    const scoreFor = (userTz, candidateTz) => evaluateCandidate({
      user: makeUser({ timezoneOffset: userTz, context: { awakeReason: 'insomnia', timezoneOffset: userTz } }),
      candidate: makeCandidate({ body: { _kv: 4, l: 'zh', et: 'tfidf', tzo: candidateTz, r: 'insomnia' } }),
      pendingCount: 50
    }).candidate.score;
    const full = scoreFor(480, 480);      // 360 min
    const good = scoreFor(-720, -480);    // 120 min
    const partial = scoreFor(-720, -420); // 60 min
    const weak = scoreFor(-720, -360);    // 0 min
    const unknownUser = makeUser({ timezoneOffset: null, context: { awakeReason: 'insomnia', timezoneOffset: null } });
    const unknown = evaluateCandidate({
      user: unknownUser,
      candidate: makeCandidate({ body: { _kv: 4, l: 'zh', et: 'tfidf', r: 'insomnia' } }),
      pendingCount: 50
    }).candidate.score;

    assert('ctx: full timezone score above unknown', full > unknown, `full=${full} unknown=${unknown}`);
    assert('ctx: good above partial', good > partial, `good=${good} partial=${partial}`);
    assert('ctx: unknown above partial', unknown > partial, `unknown=${unknown} partial=${partial}`);
    assert('ctx: partial above weak', partial > weak, `partial=${partial} weak=${weak}`);
  } finally {
    ALGORITHM_CONFIG.context.min_timezone_overlap_minutes.value = originalMin;
  }
})();

// ===== 阈值与冷却 =====

(function thresholdCooling() {
  const zhSmall = getEffectiveThreshold(50, 'zh');
  const enSmall = getEffectiveThreshold(50, 'en');
  const zhLarge = getEffectiveThreshold(5000, 'zh');
  assert('threshold: zh small pool around 0.48', Math.abs(zhSmall - 0.48) < 0.0001, `t=${zhSmall}`);
  assert('threshold: en offset -0.06', Math.abs(enSmall - (zhSmall - 0.06)) < 0.0001, `en=${enSmall} zh=${zhSmall}`);
  assert('threshold: large pool higher than small', zhLarge > zhSmall, `large=${zhLarge} small=${zhSmall}`);
})();

// ===== MMR 与 selectMatch =====

(function mmrSelection() {
  const embA = charBigramVector('第一个候选文字内容'),
    embB = charBigramVector('第二个候选文字内容'),
    embC = charBigramVector('第三个候选文字内容');
  const userEmb = charBigramVector('用户自己的文字内容');
  const candidates = [
    { issue: { number: 201 }, embedding: embA, score: 0.72, intent: null, emailHash: 'a' },
    { issue: { number: 202 }, embedding: embB, score: 0.91, intent: null, emailHash: 'b' },
    { issue: { number: 203 }, embedding: embC, score: 0.65, intent: null, emailHash: 'c' }
  ];

  const { reranked, candidatesCount } = selectMatch(candidates, userEmb, { anyTypeMismatch: false });
  const sorted = candidates.slice().sort((x, y) => y.score - x.score);
  const expected = mmrRerank(sorted, userEmb);

  assert('mmr: candidate count preserved', candidatesCount === 3 && reranked.length === 3);
  assert('mmr: reranked matches match-core mmrRerank', JSON.stringify(reranked.map(c => c.issue.number)) === JSON.stringify(expected.map(c => c.issue.number)), JSON.stringify({ actual: reranked.map(c => c.issue.number), expected: expected.map(c => c.issue.number) }));
  assert('mmr: single candidate stays first', selectMatch([candidates[0]], userEmb).reranked[0].issue.number === 201);
})();

// ===== debug 结构 =====

(function debugStructure() {
  const debug = buildMatchDebug({
    entries: [
      { issue: 1, skip: 'old_format' },
      { issue: 2, skip: 'kv_missing' },
      { issue: 3, skip: 'same_email' },
      { issue: 4, skip: 'exception', error: 'x' },
      { issue: 5, skip: 'decrypt_failed' },
      { issue: 6, skip: 'below_threshold' }
    ],
    otherSeen: 6,
    otherIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    langMismatches: [{ issue: 1, lang: 'en' }],
    timezoneSkips: [{ issue: 2, overlapMinutes: 60 }],
    timezoneSkipped: 1,
    issueCount: 10,
    matchLang: 'zh'
  });
  assert('debug: entries capped at 5', debug.entries.length === 5);
  assert('debug: otherIds capped at 10', debug.otherIds.length === 10);
  assert('debug: counters and lists present', debug.otherSeen === 6 && debug.timezoneSkipped === 1 && debug.issueCount === 10 && debug.matchLang === 'zh');
})();

// ===== 结果 =====

console.log(`\n  Worker match-core tests: ${passed} passed, ${failed} failed (total ${passed + failed})`);
if (failed > 0) {
  console.error(`  ${failed} WORKER MATCH-CORE TEST(S) FAILED!\n`);
  process.exit(1);
}
console.log('  All worker match-core tests passed.\n');
