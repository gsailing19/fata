/**
 * fata 匹配引擎中的 LLM 超时降级 — Loop 2.2
 *
 * 职责：
 * - 深度匹配模式下，CF Worker LLM 调用设置 15s 超时
 * - 超时 → 自动切换到纯本地 embedding 快速匹配
 * - 降级后静默，不打断用户体验
 * - 同一 session 连续 3 次降级 → 建议切换模式
 * - 降级事件记录到 IndexedDB，用于回测统计
 *
 * 设计原则：
 * - Fast degradation, not silent failure
 * - 用户感知：匹配正常完成，只是方式略有不同
 * - 降级描述对用户透明但不制造焦虑
 */

const LLMFallback = {
  config: {
    timeoutMs: 15000,          // 15s 超时
    maxConsecutiveFallbacks: 3, // 连续 3 次降级后提示
    cooldownMinutes: 5          // 超过 3 次后建议等待时间
  },

  state: {
    consecutiveFallbacks: 0,   // 当前 session 降级次数
    lastFallbackTime: null
  },

  /**
   * 生成 HMAC 签名头（防止外部直接调用 Worker）
   * @param {string} url — 请求 URL
   * @param {string} hmacKey — HMAC 共享密钥
   * @returns {Object} — 包含 X-Fata-Signature 和 X-Fata-Timestamp 的 headers
   */
  async _buildHMACHeaders(url, hmacKey) {
    if (!hmacKey) {
      console.warn('fata: HMAC key not available, request may be rejected by Worker');
      return {};
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = new URL(url, window.location.origin).pathname;
    const message = `${timestamp}:${path}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(hmacKey);
    const key = await crypto.subtle.importKey('raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return {
      'X-Fata-Signature': sigStr,
      'X-Fata-Timestamp': timestamp
    };
  },

  /**
   * 通过 CF Worker 调用 LLM API（带超时）
   *
   * @param {string} endpoint — '/api/llm/analyze' | '/api/llm/resonance'
   * @param {Object} payload — LLM 调用参数
   * @param {string} [hmacKey] — 浏览器端 HMAC 密钥(与服务端 HMAC_KEY 相同)
   * @returns {Promise<Object|null>} — LLM 结果 | null（超时/失败）
   */
  async callWithTimeout(endpoint, payload, hmacKey) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const hmacHeaders = await this._buildHMACHeaders(endpoint, hmacKey);
      const fullUrl = endpoint.startsWith('http') ? endpoint : `https://worker.fata.uk${endpoint}`;
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...hmacHeaders
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM API returned ${response.status}`);
      }

      const data = await response.json();

      // 成功 → 重置降级计数
      this.state.consecutiveFallbacks = 0;

      return data;
    } catch (err) {
      clearTimeout(timeoutId);

      // 记录降级
      this._recordFallback(err.name === 'AbortError' ? 'timeout' : 'error');

      return null; // null = 降级信号
    }
  },

  /**
   * 深度匹配 → 快速匹配的降级逻辑
   * 在 match-engine.js 中调用
   *
   * @param {string} userText — 用户文字
   * @param {string} userEmail — 用户邮箱（加密后）
   * @returns {Object} — 匹配结果
   */
  async matchWithFallback(userText, userEmail) {
    const t = window.t || (k => k);
    // 尝试深度匹配（含 LLM 意图解析）
    this._showStatus(t('model.statusAnalyzing'));

    const llmResult = await this.callWithTimeout('/api/llm/analyze', {
      prompt_type: 'intent_parse',
      text_a: userText,
      lang: (typeof window !== 'undefined' && window.currentLang) || 'zh'
    });

    if (llmResult !== null) {
      // 深度匹配成功
      return this._buildMatchResult(userText, userEmail, llmResult, 'deep');
    }

    // 降级：纯本地 embedding 快速匹配
    this._showStatus(t('model.statusFastMatching'));
    this.state.consecutiveFallbacks++;

    const embedding = await this._generateEmbeddingLocal(userText);
    const matchResult = await this._matchByEmbeddingOnly(embedding, userEmail);

    matchResult.matchMode = 'fast_fallback';

    // 连续 3 次降级 → 建议用户切换模式
    if (this.state.consecutiveFallbacks >= this.config.maxConsecutiveFallbacks) {
      matchResult.showModeSwitchHint = true;
    }

    return matchResult;
  },

  /**
   * 获取用户提示信息（在匹配成功后展示）
   */
  getFallbackNotice() {
    if (this.state.consecutiveFallbacks === 0) return null;
    const t = window.t || (k => k);

    if (this.state.consecutiveFallbacks >= this.config.maxConsecutiveFallbacks) {
      return {
        type: 'suggestion',
        html: `
          <p class="fallback-notice">
            ${t('fallback.busy')}
            <br>
            <button class="btn-text" onclick="fata.switchMatchMode('fast')">
              ${t('fallback.switchBtn')}
            </button>
          </p>`
      };
    }

    return {
      type: 'info',
      html: `
        <p class="fallback-notice-subtle">
          ${t('fallback.switched')}
        </p>`
    };
  },

  // --- 内部方法 ---

  async _generateEmbeddingLocal(text) {
    if (window.MatchEngine && window.MatchEngine._generateEmbedding) {
      return window.MatchEngine._generateEmbedding(text);
    }
    // MatchEngine 未初始化时降级生成向量（语言感知）
    const lang = (typeof window !== 'undefined' && window.currentLang) || 'zh';
    const dim = lang === 'en' ? 384 : 512;
    if (lang === 'en') {
      // English: word-bigram（与 match-engine.js _wordBigramVector 一致）
      const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
      if (words.length < 2) words.push('.');
      const bigrams = {};
      for (let i = 0; i < words.length - 1; i++) {
        const bg = words[i] + '_' + words[i + 1];
        bigrams[bg] = (bigrams[bg] || 0) + 1;
      }
      const total = Object.values(bigrams).reduce((a, b) => a + b, 0) || 1;
      const vec = new Array(dim).fill(0);
      for (const [bg, cnt] of Object.entries(bigrams)) {
        let h = 0;
        for (let i = 0; i < bg.length; i++) h = ((h << 5) - h + bg.charCodeAt(i)) | 0;
        vec[Math.abs(h) % dim] += cnt / total;
      }
      const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0));
      if (norm > 0) vec.forEach((_, i) => vec[i] /= norm);
      return vec;
    }
    // Chinese: char bigram（原始行为）
    const chars = (text || '').replace(/\s+/g, '').split('');
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < chars.length - 1; i++) {
      const h = ((chars[i] + chars[i + 1]).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 0)) % dim;
      vec[Math.abs(h)] += 1 / (chars.length || 1);
    }
    const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0));
    if (norm > 0) vec.forEach((_, i) => vec[i] /= norm);
    return vec;
  },

  async _matchByEmbeddingOnly(embedding, userEmail) {
    if (window.MatchEngine && window.MatchEngine.findMatch) {
      // 传入已生成的 embedding，避免用空字符串重新生成零向量
      window.MatchEngine._cachedEmbedding = embedding;
      const result = await window.MatchEngine.findMatch('', userEmail, null, 'fast_fallback');
      window.MatchEngine._cachedEmbedding = null;
      return result;
    }
    return { matched: false, poolSize: 0 };
  },

  _buildMatchResult(userText, userEmail, llmResult, mode) {
    return {
      matched: true,
      matchInfo: {
        otherEmail: llmResult?.email || '',
        similarityScore: llmResult?.score || 0,
        otherText: llmResult?.text || '',
        candidatesCount: 1
      },
      mode: mode || 'fallback'
    };
  },

  _recordFallback(reason) {
    this.state.lastFallbackTime = Date.now();

    // 记录到 IndexedDB（用于后续回测分析降级频率）
    this._logToIndexedDB({
      timestamp: Date.now(),
      reason,
      consecutiveCount: this.state.consecutiveFallbacks
    });
  },

  async _logToIndexedDB(entry) {
    try {
      const db = await this._openDB();
      const tx = db.transaction('fallback_log', 'readwrite');
      const store = tx.objectStore('fallback_log');
      await store.put({ id: Date.now(), ...entry });
    } catch (e) {
      // 静默失败
    }
  },

  _showStatus(text) {
    const event = new CustomEvent('fata:match-status', { detail: { text } });
    window.dispatchEvent(event);
  },

  async _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('fata_fallback', 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('fallback_log')) {
          db.createObjectStore('fallback_log', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
};

export { LLMFallback };
