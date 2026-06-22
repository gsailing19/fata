/**
 * fata signal heuristics — browser-side LLM replacement
 *
 * Replaces: signal density LLM (was ~¥0.003/call)
 *           intent parsing LLM (was ~¥0.005/call)
 * Cost: zero. Latency: <1ms. Privacy: text never leaves browser.
 */

const SignalHeuristic = {
  /**
   * Compute signal density score from text — how much matchable information.
   * Heuristic replaces LLM-based signal_density prompt.
   *
   * @param {string} text - raw user text
   * @param {string} lang - 'zh' | 'en'
   * @returns {{ score: number, reason: string, risk_level: string }}
   */
  computeSignalDensity(text, lang) {
    if (!text || text.trim().length < 2) {
      return { score: 0, reason: lang === 'en' ? 'too short' : '文字过短', risk_level: 'none' };
    }

    const t = text.trim();
    const isEn = lang === 'en';

    // Factor 1: length (diminishing returns after ~200 chars)
    const lenScore = Math.min(t.length / 200, 1.0) * 0.25;

    // Factor 2: unique character/word ratio (lexical diversity)
    const tokens = isEn
      ? t.toLowerCase().split(/\s+/)
      : t.replace(/\s/g, '').split('');
    const uniqueRatio = tokens.length > 0
      ? new Set(tokens).size / tokens.length
      : 0;
    const diversityScore = Math.min(uniqueRatio / 0.7, 1.0) * 0.30;

    // Factor 3: sentence count (structured thought)
    const sentences = t.split(/[。！？.!?\n]+/).filter(s => s.trim().length > 0);
    const sentenceScore = Math.min(sentences.length / 3, 1.0) * 0.20;

    // Factor 4: concrete details (numbers, proper names, specific terms)
    const detailPattern = isEn
      ? /[0-9]+|[A-Z][a-z]{2,}|"[^"]+"/g
      : /[0-9]+|[A-Z][a-z]{2,}|[《》「」""]|\d{4}年|\d{1,2}月/g;
    const details = t.match(detailPattern) || [];
    const detailScore = Math.min(details.length / 5, 1.0) * 0.25;

    const score = Math.round((lenScore + diversityScore + sentenceScore + detailScore) * 100) / 100;

    // Reason text
    let reason = '';
    if (score < 0.3) reason = isEn ? 'very little matchable info' : '可匹配信息很少';
    else if (score < 0.6) reason = isEn ? 'some signal, could add detail' : '有一定信号，可以更具体';
    else if (score < 0.8) reason = isEn ? 'good signal' : '信号良好';
    else reason = isEn ? 'rich signal' : '信号丰富';

    return { score, reason, risk_level: 'none' };
  },

  /**
   * Parse intent from text — rule-based extraction.
   * Heuristic replaces LLM-based intent_parse prompt.
   *
   * @param {string} text - raw user text
   * @param {string} lang - 'zh' | 'en'
   * @returns {{ emo: string, need: string, topics: string[], style: string, expect: string, keywords: string[], content_flag: string }}
   */
  parseIntent(text, lang) {
    const t = text.trim();
    const isEn = lang === 'en';
    const lower = t.toLowerCase();

    // Need detection via keyword patterns
    const needPatterns = isEn ? {
      be_heard: [/need.*heard/i, /vent/i, /listen to me/i, /hear me/i, /get off my chest/i],
      listen_to_others: [/want to hear/i, /tell me/i, /curious about/i, /your story/i],
      find_resonance: [/resonance/i, /same/i, /relate/i, /similar/i, /like me/i],
      get_advice: [/advice/i, /help/i, /what should/i, /stuck/i, /lost/i, /suggestion/i],
      give_advice: [/recommend/i, /suggest/i, /share.*experience/i, /been through/i],
      casual_chat: [/bored/i, /chat/i, /casual/i, /hang out/i, /talk/i, /anyone/i],
      deep_discussion: [/meaning/i, /philosophy/i, /deep/i, /existential/i, /life/i, /purpose/i]
    } : {
      be_heard: [/想被听/, /听我说/, /倾诉/, /心里话/, /说说话/, /陪我/],
      listen_to_others: [/想听/, /想了解/, /好奇/, /讲讲/, /告诉我/],
      find_resonance: [/共鸣/, /一样.*吗/, /类似/, /同感/, /经历.*相似/],
      get_advice: [/建议/, /怎么办/, /求教/, /帮帮我/, /指点/, /迷茫/],
      give_advice: [/分享/, /推荐/, /经验/, /建议.*给/, /教你/],
      casual_chat: [/闲聊/, /随便/, /打发/, /无聊/, /聊聊/, /有人/],
      deep_discussion: [/深度/, /哲学/, /人生/, /意义/, /存在/, /灵魂/]
    };

    const needs = [];
    for (const [need, patterns] of Object.entries(needPatterns)) {
      if (patterns.some(p => p.test(lower))) needs.push(need);
    }
    if (needs.length === 0) needs.push('find_resonance');

    // Emotion inference via keyword + punctuation patterns
    let emo = '';
    if (isEn) {
      const hasQuestions = (t.match(/\?/g) || []).length > 1;
      const hasExclamations = (t.match(/!/g) || []).length > 1;
      const hasSadWords = /sad|lonely|miss|hurt|pain|empty|tired|exhausted|numb/i.test(lower);
      const hasAngerWords = /angry|frustrated|sick of|hate|unfair/i.test(lower);
      const hasHopeWords = /hope|excited|looking forward|new start|fresh/i.test(lower);
      if (hasSadWords && hasQuestions) emo = 'lonely but searching';
      else if (hasAngerWords) emo = 'frustrated but articulate';
      else if (hasHopeWords) emo = 'hopeful and open';
      else if (hasExclamations) emo = 'energetic and expressive';
      else emo = 'calm and reflective';
    } else {
      const hasQuestions = (t.match(/[？?]/g) || []).length > 1;
      const hasSadWords = /难过|孤独|想念|痛苦|空虚|累|疲惫|麻木|失眠/i.test(lower);
      const hasAngerWords = /生气|愤怒|受够了|不公平|讨厌/i.test(lower);
      const hasHopeWords = /希望|期待|新的开始|重新/i.test(lower);
      if (hasSadWords && hasQuestions) emo = '孤独但仍在寻找';
      else if (hasAngerWords) emo = '愤怒但表达克制';
      else if (hasHopeWords) emo = '怀有期待';
      else if (hasQuestions) emo = '充满疑问';
      else emo = '平静内敛';
    }

    // Topic extraction via keyword matching
    const topicMap = isEn ? {
      relationships: [/relationship/i, /love/i, /friend/i, /breakup/i, /partner/i, /date/i],
      self_growth: [/growth/i, /learning/i, /change/i, /improve/i, /myself/i, /journey/i],
      daily_life: [/work/i, /job/i, /school/i, /morning/i, /night/i, /weekend/i, /routine/i],
      career: [/career/i, /promotion/i, /interview/i, /boss/i, /startup/i, /project/i],
      hobbies: [/game/i, /music/i, /book/i, /movie/i, /art/i, /sport/i, /cook/i],
      philosophy: [/meaning/i, /purpose/i, /existence/i, /philosophy/i, /why/i],
      health: [/sleep/i, /anxiety/i, /stress/i, /mental/i, /therapy/i, /exercise/i]
    } : {
      relationships: [/关系/, /恋爱/, /朋友/, /分手/, /伴侣/, /约会/, /感情/],
      self_growth: [/成长/, /学习/, /改变/, /提升/, /自己/, /反思/],
      daily_life: [/工作/, /上班/, /下班/, /周末/, /日常/, /吃饭/, /地铁/],
      career: [/职业/, /升职/, /面试/, /老板/, /创业/, /项目/],
      hobbies: [/游戏/, /音乐/, /书/, /电影/, /运动/, /做饭/, /画画/],
      philosophy: [/意义/, /目的/, /存在/, /为什么/, /人生/],
      health: [/失眠/, /焦虑/, /压力/, /心理/, /身体/, /锻炼/]
    };

    const topics = [];
    for (const [topic, patterns] of Object.entries(topicMap)) {
      if (patterns.some(p => p.test(lower))) topics.push(topic);
    }
    if (topics.length === 0) topics.push(isEn ? 'daily_life' : 'daily_life');
    if (topics.length > 3) topics.length = 3;

    // Style inference
    const style = isEn
      ? (t.match(/\?/g) || []).length > 2 ? 'responsive' : 'active'
      : (t.match(/[？?]/g) || []).length > 2 ? 'responsive' : 'active';

    // Keywords: top 5 by word frequency, minus stop words
    const stopWords = isEn
      ? new Set(['the','a','an','is','are','was','were','i','me','my','we','our','you','your','he','she','it','they','them','this','that','and','or','but','in','on','at','to','for','of','with','have','has','be','been','just','so','if','no','not','all','can','will','would','could','should','do','does','did','what','when','where','who','how','why','about','like','really','very','get','got','think','feel','know','want','need','say','said','go','come','see','make','time','thing','people','person'])
      : new Set(['的','了','在','是','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着','没有','看','好','自己','这','他','她','它','们','那','什么','怎么','为什么','因为','所以','但是','如果','可以','能','会','应该','已经','还','又','再','只','把','被','从','对','与','或']);
    const words = isEn
      ? lower.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w))
      : t.replace(/[，。！？、；：""''（）\s\n]/g, ' ').split(' ').filter(w => w.length > 0 && !stopWords.has(w));
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const keywords = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);
    if (keywords.length === 0) keywords.push(isEn ? 'life' : '生活');

    return {
      emo,
      need: needs.join('/'),
      topics,
      style,
      expect: 'unsure',
      keywords,
      content_flag: 'none'
    };
  },

  /**
   * Compose interview answers into first-person profile.
   * Heuristic replaces LLM-based interview_compose prompt.
   */
  composeInterviewProfile(answers, lang) {
    const t = lang === 'en'
      ? ['Speaking of', 'On that note,', 'Also,', 'And,']
      : ['说到', '关于', '另外', '同时'];
    const parts = answers
      .filter(a => a && a.trim().length > 0)
      .map((a, i) => i === 0 ? a.trim() : `${t[Math.min(i - 1, t.length - 1)]}，${a.trim()}`);
    return parts.join('。') + '。';
  }
};

// Expose globally for index.html use
if (typeof window !== 'undefined') window.SignalHeuristic = SignalHeuristic;
export { SignalHeuristic };
