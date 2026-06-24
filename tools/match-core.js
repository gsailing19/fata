/**
 * fata 匹配算法核心 — Match Core
 *
 * 从 config/worker.js 中精确提取的评分函数和算法配置。
 * 这是整个匹配系统的唯一真相来源（Single Source of Truth）。
 *
 * 所有使用场景（Worker 生产环境、algo-test.js、evaluate-matching.js、
 * simulate-pool.js、tune-params.js）都从这里导入，确保逻辑一致。
 *
 * 注意：加密/解密函数留在 worker.js（依赖 Web Crypto API）。
 */

// ===== 算法配置 v2 =====

const ALGORITHM_CONFIG = {
  _version: "3.1.0",
  scoring_weights: {
    emb_weight:       { value: 0.30, _desc: "语义嵌入余弦相似度权重" },
    intent_weight:    { value: 0.40, _desc: "多维度意图兼容权重" },
    style_weight:     { value: 0.15, _desc: "互动风格适配权重" },
    signal_coef:      { value: 0.15, _desc: "信号密度乘积权重" },
    // intent_weight 内部子权重（总和 = 1.0）
    intent_channels: {
      need_complement:    { value: 0.35, _desc: "需求互补（被倾听↔想倾听）" },
      keyword_overlap:    { value: 0.10, _desc: "关键词重叠（辅助信号）" },
      topic_overlap:      { value: 0.15, _desc: "话题域重叠" },
      emotion_resonance:  { value: 0.15, _desc: "情绪状态共鸣" },
      depth_match:        { value: 0.10, _desc: "敞开深度匹配" },
      expect_align:       { value: 0.05, _desc: "期望一致" },
      gender_aware:       { value: 0.05, _desc: "性别表达匹配" },
      relation_aim_compat:{ value: 0.10, _desc: "关系意图兼容" }
    }
  },
  thresholds: {
    cosine_threshold: { value: 0.46, _desc: "基础匹配门槛（冷却叠加后生效：小池≈0.48 / 中池≈0.50 / 大池≈0.53）。2026-06-17 从 0.55 修正——此前阈值过高导致匹配阻断" }
  },
  diversity: {
    mmr_lambda: { value: 0.65, _desc: "MMR lambda（65%相关性 35%多样性）" }
  },
  cooling: {
    cool_alpha_low_pool:  { value: 0.02, _desc: "小池子冷却系数（<100）" },
    cool_alpha:           { value: 0.04, _desc: "默认冷却系数（100-1000）" },
    cool_alpha_high_pool: { value: 0.07, _desc: "大池子冷却系数（>1000）" }
  },
  // 双语标签表（算法取值用，不暴露到浏览器）
  labels: {
    zh: {
      need: {
        be_heard: '被倾听', listen: '想倾听他人', resonance: '找共鸣',
        get_advice: '想要建议', give_advice: '想给建议',
        deep_discussion: '深度探讨', casual_chat: '闲聊'
      },
      need_pairs: {
        '被倾听': '想倾听他人', '想倾听他人': '被倾听',
        '想要建议': '想给建议', '想给建议': '想要建议',
        '找共鸣': '找共鸣', '深度探讨': '深度探讨', '闲聊': '闲聊'
      },
      emotion_neg: ['自责','无力','悲伤','崩溃','孤独','焦虑','压抑','难过','痛苦','绝望','麻木','疲惫','迷茫'],
      emotion_pos: ['愉快','开心','兴奋','平静','温暖','期待','好奇','轻松'],
      depth: ['表面','中等','深度'],
      style: { active: '主动型', responsive: '回应型', serious: '严肃型', playful: '调侃型', unsure: '不确定' },
      relation_aim: {
        emotional_support: '情感支持', deep_conversation: '深度对话',
        shared_interests: '兴趣交流', friendship: '友情', unsure: '不确定'
      },
      gender: { not_mentioned: '未提及', mentions_female: '提到女性', mentions_male: '提到男性' }
    },
    en: {
      need: {
        be_heard: 'be heard', listen: 'listen to others', resonance: 'find resonance',
        get_advice: 'get advice', give_advice: 'give advice',
        deep_discussion: 'deep discussion', casual_chat: 'casual chat'
      },
      need_pairs: {
        'be heard': 'listen to others', 'listen to others': 'be heard',
        'get advice': 'give advice', 'give advice': 'get advice',
        'find resonance': 'find resonance', 'deep discussion': 'deep discussion', 'casual chat': 'casual chat'
      },
      emotion_neg: ['guilty','helpless','sad','broken','lonely','anxious','depressed','hurting','suffering','hopeless','numb','exhausted','lost'],
      emotion_pos: ['happy','excited','calm','peaceful','warm','hopeful','curious','lighthearted'],
      depth: ['surface','medium','deep'],
      style: { active: 'active', responsive: 'responsive', serious: 'serious', playful: 'playful', unsure: 'unsure' },
      relation_aim: {
        emotional_support: 'emotional support', deep_conversation: 'deep conversation',
        shared_interests: 'shared interests', friendship: 'friendship', unsure: 'unsure'
      },
      gender: { not_mentioned: 'not mentioned', mentions_female: 'mentions female', mentions_male: 'mentions male' }
    }
  }
};

// ===== 算法核心函数 =====

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

// 归一化 LLM 返回的 need 标签（LLM 输出不稳定，常有大小写/同义词变体）
function normalizeNeed(raw, lang) {
  if (!raw) return '';
  const L = (ALGORITHM_CONFIG.labels[lang] || ALGORITHM_CONFIG.labels.zh);
  const canonical = Object.values(L.need);
  const s = raw.toLowerCase().trim();

  // 精确匹配（忽略大小写）
  for (const cn of canonical) {
    if (s === cn) return cn;
  }

  // 常见 LLM 变体 → canonical（必须在 / 分割之前，因为组合标签如
  // "give advice / be heard" 需要先匹配完整形式）
  const map = {
    'to be heard': 'be heard', 'being heard': 'be heard',
    'need to be heard': 'be heard', 'want to be heard': 'be heard',
    'be listened to': 'be heard', 'heard': 'be heard',
    'need someone to hear': 'be heard', 'needs to be heard': 'be heard',
    'to listen': 'listen to others', 'listening': 'listen to others',
    'want to listen': 'listen to others', 'be a listener': 'listen to others',
    'lend an ear': 'listen to others', 'hear others out': 'listen to others',
    'to listen to others': 'listen to others', 'listening to others': 'listen to others',
    'seek resonance': 'find resonance', 'seeking resonance': 'find resonance',
    'looking for resonance': 'find resonance',
    'need advice': 'get advice', 'want advice': 'get advice',
    'seeking advice': 'get advice', 'looking for advice': 'get advice',
    'seeking guidance': 'get advice',
    'offer advice': 'give advice', 'share advice': 'give advice',
    'give guidance': 'give advice', 'mentor': 'give advice',
    'share experience': 'give advice',
    'meaningful conversation': 'deep discussion',
    'deep conversation': 'deep discussion', 'thoughtful discussion': 'deep discussion',
    'small talk': 'casual chat', 'chat': 'casual chat',
    'just talk': 'casual chat', 'pass time': 'casual chat',
    // LLM 常输出的组合标签（取第二个成分）
    'give advice / be heard': 'listen to others',
    'be heard / give advice': 'listen to others',
    'give advice / listen to others': 'listen to others',
    'listen to others / give advice': 'listen to others',
    // 缺失的常见变体（2026-06-19 诊断补充）
    'listener': 'listen to others',
    'i listen': 'listen to others',
    'here to listen': 'listen to others',
    'hear you out': 'listen to others',
    'need to talk': 'be heard',
    'need someone to talk to': 'be heard',
    'looking for connection': 'find resonance',
    'seeking connection': 'find resonance',
    'feel lonely': 'be heard',
    'need support': 'be heard',
    'need emotional support': 'be heard',
    'offer support': 'listen to others',
    'be there for someone': 'listen to others',
    'seeking understanding': 'be heard',
    'want to understand': 'listen to others',
    'like to help': 'give advice',
    'looking for guidance': 'get advice',
    'share thoughts': 'deep discussion',
    'vent': 'be heard',
  };
  if (map[s]) return map[s];

  // 处理 LLM 返回的组合标签（如 "give advice / listen to others" → 分别匹配）
  // 放在 map 之后，让精确组合映射优先命中
  if (s.includes('/')) {
    const parts = s.split('/').map(p => p.trim());
    // 尝试用 map 匹配每个子标签
    const resolved = [];
    for (const part of parts) {
      const r = normalizeNeed(part, lang);
      if (r) resolved.push(r);
    }
    // 如果有多个有效标签，优先选"倾听"而非"给建议"，因为 LLM
    // 常把"倾听"误标为"give advice"，把它当成次要标签附加
    if (resolved.length >= 1) {
      const preferred = resolved.find(r => r === L.need.listen || r === L.need.be_heard);
      return preferred || resolved[0];
    }
  }

  // 子串匹配：canonical form 包含在 raw 中
  for (const cn of canonical) {
    if (s.includes(cn)) return cn;
  }
  // 反向：raw 包含在 canonical form 中（如 "listen" → "listen to others"）
  for (const cn of canonical) {
    if (cn.includes(s) && s.length >= 4) return cn;
  }

  // 兜底：关键词启发式（以上规则全部失败时，从 unknown need 推断）
  // LLM 偶有创造性输出，关键词匹配比返回原始字符串更鲁棒
  if (s.includes('listen') || s.includes('hear') && !s.includes('heard')) return L.need.listen;
  if (s.includes('heard') || s.includes('vent') || s.includes('lonely')) return L.need.be_heard;
  if (s.includes('advice') || s.includes('guidance') || s.includes('help')) return L.need.get_advice;
  if (s.includes('resonance') || s.includes('connect')) return L.need.resonance;
  if (s.includes('discuss') || s.includes('talk') || s.includes('convers')) return L.need.deep_discussion;

  return s;
}

// LLM intent_parse 失败时从文本推断基础意图画像
// 英文：关键词匹配。中文：同样用关键词。
// 返回最小可用的 intent 对象（need + 推断的 emotion/depth），用于 calculateScore 降级
function inferIntentFromText(text, lang) {
  if (!text) return null;
  const L = (ALGORITHM_CONFIG.labels[lang] || ALGORITHM_CONFIG.labels.zh);
  const lower = text.toLowerCase();

  // need 推断（关键词优先级：倾听 > 被倾听 > 建议 > 讨论）
  let need = '';
  if (lower.includes('here to listen') || lower.includes('lend an ear') ||
      lower.includes('here for you') || lower.includes('be there for') ||
      lower.includes('fully present') || lower.includes('open heart') ||
      lower.includes('listening with') || lower.includes('friends turn to')) {
    need = L.need.listen;
  } else if (lower.includes('hear me') || lower.includes('be heard') ||
             lower.includes('listen to me') || lower.includes('need someone') ||
             lower.includes('no judgment') || lower.includes('loneliness') ||
             lower.includes('by myself') || lower.includes('sit with my thoughts') ||
             lower.includes('need to talk') || lower.includes('vent')) {
    need = L.need.be_heard;
  } else if (lower.includes('give advice') || lower.includes('share experience') ||
             lower.includes('mentor') || lower.includes('offer advice')) {
    need = L.need.give_advice;
  } else if (lower.includes('need advice') || lower.includes('looking for advice') ||
             lower.includes('guidance') || lower.includes('help me')) {
    need = L.need.get_advice;
  } else if (lower.includes('resonance') || lower.includes('connection') ||
             lower.includes('find my people') || lower.includes('on the same wavelength')) {
    need = L.need.resonance;
  }

  // 情绪推断
  let emo = '';
  const negEmo = L.emotion_neg;
  const posEmo = L.emotion_pos;
  for (const e of negEmo) {
    if (lower.includes(e)) { emo = e; break; }
  }
  if (!emo) {
    for (const e of posEmo) {
      if (lower.includes(e)) { emo = e; break; }
    }
  }

  // 深度推断
  let depth = '';
  if (lower.includes('heavy') || lower.includes('deep') || lower.includes('alone') ||
      lower.includes('thoughts') || lower.includes('heart') || lower.includes('vulnerable')) {
    depth = L.depth[2]; // 'deep'
  } else if (text.length > 100) {
    depth = L.depth[1]; // 'medium'
  }

  // 风格推断
  let style = '';
  if (lower.includes('not looking for advice') || lower.includes('just need someone') ||
      lower.includes('fully present') || lower.includes('open heart')) {
    style = L.style.responsive;
  }

  return { need, emo, depth, style };
}

function calculateScore(userEmb, otherEmb, userIntent, otherIntent, lang, userText, otherText) {
  const cfg = ALGORITHM_CONFIG.scoring_weights;
  const L = (ALGORITHM_CONFIG.labels[lang] || ALGORITHM_CONFIG.labels.zh);
  const cosineSim = cosineSimilarity(userEmb, otherEmb);

  // 意图降级：LLM 失败时从文本推断基础意图
  const uIntent = userIntent || (userText ? inferIntentFromText(userText, lang) : null);
  const oIntent = otherIntent || (otherText ? inferIntentFromText(otherText, lang) : null);

  // 意图兼容度（多维度）
  let intentCompat = 0.5;
  if (uIntent && oIntent) {
    intentCompat = calculateIntentCompatibility(uIntent, oIntent, lang);
  }

  // 风格适配
  let styleCompat = 0.5;
  if (uIntent && oIntent) {
    styleCompat = calculateStyleCompatibility(uIntent.style, oIntent.style, lang);
  }

  // 信号密度
  const signalA = (uIntent && typeof uIntent.signalDensity === 'number') ? uIntent.signalDensity : 0.5;
  const signalB = (oIntent && typeof oIntent.signalDensity === 'number') ? oIntent.signalDensity : 0.5;
  let signalProduct = signalA * signalB;
  // 信号悬殊惩罚：一方高质量一方敷衍，匹配体验差
  if (Math.abs(signalA - signalB) > 0.4) signalProduct *= 0.6;

  let score = (
    cosineSim * cfg.emb_weight.value +
    intentCompat * cfg.intent_weight.value +
    styleCompat * cfg.style_weight.value +
    signalProduct * cfg.signal_coef.value
  );

  // 双低信号全局惩罚：两人内容都空洞时，embedding 和匹配都不可靠
  if (signalA <= 0.3 && signalB <= 0.3) score *= 0.6;

  // 双向等待全局惩罚：关键需求冲突时，其他维度适当降权（使用归一化后的 need）
  const uNeed = normalizeNeed((uIntent && uIntent.need) || '', lang);
  const oNeed = normalizeNeed((oIntent && oIntent.need) || '', lang);
  if (uNeed === L.need.be_heard && oNeed === L.need.be_heard) score *= 0.70;

  return score;
}

function calculateIntentCompatibility(user, other, lang) {
  const ch = ALGORITHM_CONFIG.scoring_weights.intent_channels;
  const L = (ALGORITHM_CONFIG.labels[lang] || ALGORITHM_CONFIG.labels.zh);
  let total = 0;

  // 1) 需求互补（使用归一化后的 need）
  const needPairs = L.need_pairs;
  let needScore = 0.3;
  const uNeed = normalizeNeed(user.need || '', lang);
  const oNeed = normalizeNeed(other.need || '', lang);
  if (uNeed && oNeed) {
    for (const [k, v] of Object.entries(needPairs)) {
      if (uNeed === k && oNeed === v) { needScore = 1.0; break; }
      if (uNeed === v && oNeed === k) { needScore = 1.0; break; }
    }
    if (needScore < 0.5 && uNeed === oNeed && uNeed !== L.need.be_heard) needScore = 0.8;
  }
  if (uNeed === L.need.be_heard && oNeed === L.need.be_heard) needScore = 0.1;
  if (needScore < 0.5 &&
      ((uNeed === L.need.be_heard && oNeed === L.need.resonance) || (uNeed === L.need.resonance && oNeed === L.need.be_heard))) {
    needScore = 0.6;
  }
  if (needScore < 0.5 &&
      ((uNeed === L.need.casual_chat && oNeed === L.need.deep_discussion) || (uNeed === L.need.deep_discussion && oNeed === L.need.casual_chat))) {
    needScore = 0.4;
  }
  // be_heard vs casual_chat: conflicting needs — one wants depth, the other wants lightness
  if (needScore < 0.5 &&
      ((uNeed === L.need.be_heard && oNeed === L.need.casual_chat) || (uNeed === L.need.casual_chat && oNeed === L.need.be_heard))) {
    needScore = 0.2;
  }
  total += needScore * ch.need_complement.value;

  // 2) 关键词重叠
  const uk = user.keywords || [];
  const ok = other.keywords || [];
  let kwScore = 0.5;
  if (uk.length > 0 && ok.length > 0) {
    let matches = 0;
    for (const kw of uk) { if (ok.some(k => k.toLowerCase() === kw.toLowerCase())) matches++; }
    kwScore = matches / Math.max(uk.length, ok.length);
  }
  total += kwScore * ch.keyword_overlap.value;

  // 3) 话题重叠
  const ut = user.topics || [];
  const ot = other.topics || [];
  let topicScore = 0.5;
  if (ut.length > 0 && ot.length > 0) {
    const utLower = ut.map(t => t.toLowerCase());
    const otLower = ot.map(t => t.toLowerCase());
    const overlap = utLower.filter(t => otLower.includes(t)).length;
    topicScore = overlap > 0 ? Math.min(1.0, 0.5 + overlap * 0.25) : 0.3;
  }
  total += topicScore * ch.topic_overlap.value;

  // 4) 情绪共鸣（连续化）
  let emoScore = 0.5;
  if (user.emo && other.emo) {
    if (user.emo === other.emo) {
      emoScore = 0.9;
    } else {
      const negKw = L.emotion_neg;
      const posKw = L.emotion_pos;
      const uNeg = negKw.some(e => user.emo.toLowerCase().includes(e));
      const oNeg = negKw.some(e => other.emo.toLowerCase().includes(e));
      const uPos = posKw.some(e => user.emo.toLowerCase().includes(e));
      const oPos = posKw.some(e => other.emo.toLowerCase().includes(e));
      if ((uNeg && oNeg) || (uPos && oPos)) emoScore = 0.65;
      else emoScore = 0.35;
    }
  }
  total += emoScore * ch.emotion_resonance.value;

  // 5) 深度匹配
  let depthScore = 0.5;
  if (user.depth && other.depth) {
    const depths = L.depth;
    if (user.depth === other.depth) depthScore = 1.0;
    else if (Math.abs(depths.indexOf(user.depth) - depths.indexOf(other.depth)) <= 1) depthScore = 0.7;
    else depthScore = 0.3;
  }
  total += depthScore * ch.depth_match.value;

  // 6) 期望一致
  let expectScore = 0.5;
  if (user.expect && other.expect) {
    expectScore = user.expect === other.expect ? 1.0 : 0.3;
  }
  total += expectScore * ch.expect_align.value;

  // 7) 性别表达匹配
  let genderScore = 0.5;
  if (user.gender_ref && other.gender_ref) {
    if (user.gender_ref === other.gender_ref) genderScore = 1.0;
    else if (user.gender_ref !== L.gender.not_mentioned && other.gender_ref !== L.gender.not_mentioned) genderScore = 0.6;
    else genderScore = 0.7;
  }
  total += genderScore * ch.gender_aware.value;

  // 8) 关系意图兼容
  let aimScore = 0.5;
  if (user.relation_aim && other.relation_aim) {
    if (user.relation_aim === other.relation_aim) aimScore = 1.0;
    else if ((user.relation_aim === L.relation_aim.emotional_support && other.relation_aim === L.relation_aim.deep_conversation) ||
             (user.relation_aim === L.relation_aim.deep_conversation && other.relation_aim === L.relation_aim.emotional_support)) aimScore = 0.8;
    else aimScore = 0.4;
  }
  total += aimScore * ch.relation_aim_compat.value;

  return Math.min(1.0, Math.max(0.0, total));
}

// 归一化 LLM 返回的 style 标签
function normalizeStyle(raw, lang) {
  if (!raw) return '';
  const L = (ALGORITHM_CONFIG.labels[lang] || ALGORITHM_CONFIG.labels.zh);
  const canonical = Object.values(L.style);
  const s = raw.toLowerCase().trim();

  for (const cn of canonical) {
    if (s === cn) return cn;
  }

  const map = {
    'active/outgoing': 'active', 'outgoing': 'active',
    'reflective': 'responsive', 'receptive': 'responsive',
    'listener': 'responsive',
    'solemn': 'serious', 'earnest': 'serious', 'reflective and serious': 'serious',
    'humorous': 'playful', 'lighthearted': 'playful', 'fun': 'playful',
    'not sure': 'unsure', 'uncertain': 'unsure', 'neutral': 'unsure',
  };
  if (map[s]) return map[s];

  for (const cn of canonical) {
    if (s.includes(cn)) return cn;
  }

  return s;
}

function calculateStyleCompatibility(userStyle, otherStyle, lang) {
  const u = normalizeStyle(userStyle, lang);
  const o = normalizeStyle(otherStyle, lang);
  if (u === o) return 1.0;
  if (!u || !o) return 0.5;
  const L = (ALGORITHM_CONFIG.labels[lang] || ALGORITHM_CONFIG.labels.zh).style;
  if ((u === L.active && o === L.responsive) ||
      (u === L.responsive && o === L.active)) return 0.9;
  if ((u === L.serious && o === L.responsive) ||
      (u === L.responsive && o === L.serious)) return 0.6;
  if ((u === L.playful && o === L.serious) ||
      (u === L.serious && o === L.playful)) return 0.5;
  if ((u === L.playful && o === L.responsive) ||
      (u === L.responsive && o === L.playful)) return 0.5;
  if ((u === L.active && o === L.serious) ||
      (u === L.serious && o === L.active)) return 0.5;
  if (u === L.unsure || o === L.unsure) return 0.6;
  return 0.3;
}

function mmrRerank(candidates, userEmb) {
  const lambda = ALGORITHM_CONFIG.diversity.mmr_lambda.value;
  if (candidates.length <= 1) return candidates;
  const selected = [candidates[0]];
  const remaining = candidates.slice(1);

  while (remaining.length > 0) {
    let bestIdx = 0, bestMMR = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const simToUser = cosineSimilarity(userEmb, remaining[i].embedding);
      let maxSimToSelected = 0;
      for (const s of selected) {
        const sim = cosineSimilarity(s.embedding, remaining[i].embedding);
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const mmr = lambda * simToUser - (1 - lambda) * maxSimToSelected;
      if (mmr > bestMMR) { bestMMR = mmr; bestIdx = i; }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}

function getCoolingFactor(pendingCount) {
  const cfg = ALGORITHM_CONFIG.cooling;
  return pendingCount < 100 ? cfg.cool_alpha_low_pool.value :
    pendingCount > 1000 ? cfg.cool_alpha_high_pool.value :
    cfg.cool_alpha.value;
}

function getEffectiveThreshold(pendingCount, lang) {
  const baseThreshold = ALGORITHM_CONFIG.thresholds.cosine_threshold.value;
  const cooling = getCoolingFactor(pendingCount);
  // 英文 word-bigram TF-IDF 天然相似度低（~0.06），嵌入贡献近乎为零
  // 匹配完全依赖意图兼容度。降低阈值让互补意图能够过线。
  const langOffset = (lang === 'en') ? -0.06 : 0;
  return baseThreshold + cooling + langOffset;
}

// TF-IDF 向量（降级用），统一使用字符 bigram
// 英文同样使用 char-bigram（不去空格），密度远高于 word-bigram
function textToVector(text, lang) {
  return charBigramVector(text);
}

function wordBigramVector(text) {
  const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2) words.push('.');
  const bigrams = {};
  for (let i = 0; i < words.length - 1; i++) {
    const bg = words[i] + '_' + words[i + 1];
    bigrams[bg] = (bigrams[bg] || 0) + 1;
  }
  const total = Object.values(bigrams).reduce((a, b) => a + b, 0) || 1;
  const vec = new Array(384).fill(0);
  for (const [bg, cnt] of Object.entries(bigrams)) {
    let h = 0;
    for (let i = 0; i < bg.length; i++) h = ((h << 5) - h + bg.charCodeAt(i)) | 0;
    // Multi-hash: map each bigram to 7 positions for denser distribution
    for (let i = 0; i < 7; i++) {
      vec[Math.abs((h + i * 53) % 384)] += cnt / total;
    }
  }
  let norm = 0;
  for (let i = 0; i < 384; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < 384; i++) vec[i] /= norm;
  return vec;
}

// 字符 bigram TF-IDF 向量（中文降级用）
function charBigramVector(text) {
  const chars = text.replace(/\s/g, '').split('');
  const bigrams = {};
  for (let i = 0; i < chars.length - 1; i++) {
    const bg = chars[i] + chars[i + 1];
    bigrams[bg] = (bigrams[bg] || 0) + 1;
  }
  const vec = new Array(512).fill(0);
  for (const [bg, freq] of Object.entries(bigrams)) {
    let h = 0;
    for (let i = 0; i < bg.length; i++) h = ((h << 5) - h + bg.charCodeAt(i)) | 0;
    for (let i = 0; i < 31; i++) {
      vec[Math.abs((h + i * 17) % 512)] += freq;
    }
  }
  let norm = 0;
  for (let i = 0; i < 512; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < 512; i++) vec[i] /= norm;
  return vec;
}

module.exports = {
  ALGORITHM_CONFIG,
  cosineSimilarity,
  normalizeNeed,
  inferIntentFromText,
  calculateScore,
  calculateIntentCompatibility,
  normalizeStyle,
  calculateStyleCompatibility,
  mmrRerank,
  getCoolingFactor,
  getEffectiveThreshold,
  textToVector,
  wordBigramVector,
  charBigramVector
};
