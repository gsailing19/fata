/**
 * fata 试探型用户引导 — Loop 2.4
 *
 * 职责：
 * - 信号密度 < 0.3 → 不创建 GitHub Issue（文字不够丰富，匹配概率极低）
 * - 温和引导用户多写一点
 * - 三个选项：多说一点 / 就这样投递 / 存为草稿
 * - 实时字数微妙提示
 *
 * 设计原则：
 * - 不拒绝、不评判
 * - "你的文字很短，AI 可能没法帮你找到合适的人" ≠ "你写得不好"
 * - 引导是邀请，不是强制
 */

const LowSignalGuide = {
  config: {
    signalThreshold: 0.30,
    minTextLength: 20,        // ≤ 20 字显示提示
    draftExpireMs: 3600000,   // 草稿 1 小时后自动清除
    showLengthHint: true       // 显示字数微妙提示
  },

  /**
   * 检查文字是否需要引导
   *
   * @param {string} text — 用户文字
   * @param {Object} signalResult — LLM 信号密度评分结果 { score, reason, risk_level }
   * @returns {Object} — { needsGuide, guideType, options }
   */
  checkNeedsGuide(text, signalResult) {
    const { score } = signalResult;
    const textLength = text.trim().length;

    // 字数太少 + 信号低 → 引导
    if (score < this.config.signalThreshold && textLength < 30) {
      return {
        needsGuide: true,
        guideType: 'too_short',
        signalScore: score,
        textLength,
        options: ['write_more', 'force_submit', 'save_draft']
      };
    }

    // 信号低但字数不少 → 可能是"堆辞藻但空洞"
    // 这种情况不阻断，但可以给一个轻柔的提示
    if (score < this.config.signalThreshold && textLength >= 30) {
      return {
        needsGuide: false,
        guideType: 'low_signal_long',
        subtleHint: true,
        signalScore: score,
        textLength
      };
    }

    return { needsGuide: false };
  },

  /**
   * 获取引导 UI HTML
   */
  getGuideHTML(text) {
    const t = window.t || (k => k);
    return `
      <div class="signal-guide-container">
        <div class="signal-guide-icon">~</div>
        <p class="signal-guide-main">
          ${t('lowSignal.guideTitle')}
        </p>
        <p class="signal-guide-sub">
          ${t('lowSignal.guideHint')}
        </p>
        <div class="signal-guide-actions">
          <button class="btn-primary" onclick="fata.ui.expandEditor('${this._escapeHTML(text)}')">
            ${t('lowSignal.sayMore')}
          </button>
          <button class="btn-ghost" onclick="fata.ui.forceSubmit()">
            ${t('lowSignal.sendAnyway')}
          </button>
          <button class="btn-text" onclick="fata.ui.saveAsDraft()">
            ${t('lowSignal.saveDraft')}
          </button>
        </div>
        ${this._getRecentSnippetsHTML()}
      </div>
    `;
  },

  /**
   * 输入框实时字数提示
   * 在编辑区下方微妙显示
   */
  getLengthHintHTML(textLength) {
    const t = window.t || (k => k);
    if (textLength === 0) return '';

    if (textLength <= 20) {
      return `
        <p class="length-hint subtle-encourage">
          ${t('lowSignal.guideTitle').split('。')[0]}
        </p>`;
    }

    // > 20 字后不显示提示，干净
    return '';
  },

  /**
   * "就这样投递"二次确认
   */
  getForceConfirmHTML() {
    const t = window.t || (k => k);
    return `
      <div class="force-confirm-container">
        <p class="force-confirm-main">
          ${t('lowSignal.forceConfirmTitle')}
        </p>
        <p class="force-confirm-sub">
          ${t('lowSignal.forceConfirmHint')}
        </p>
        <div class="force-confirm-actions">
          <button class="btn-primary" onclick="fata.ui.expandEditor()">
            ${t('lowSignal.keepWriting')}
          </button>
          <button class="btn-ghost" onclick="fata.submit()">
            ${t('lowSignal.forceSend')}
          </button>
        </div>
      </div>
    `;
  },

  /**
   * 展示最近匿名写作片段（降低"不知道写什么"的焦虑）
   */
  _getRecentSnippetsHTML() {
    const t = window.t || (k => k);
    return `
      <div class="recent-snippets">
        <p class="snippets-label">${t('snippets.label')}</p>
        <div class="snippets-list" id="writing-snippets">
          <!-- 动态填充 LLM 生成的写作启-发片段 -->
        </div>
      </div>
    `;
  },

  /**
   * 将低密度文字存为草稿
   */
  saveDraft(text) {
    const draft = {
      text,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.draftExpireMs
    };

    try {
      localStorage.setItem('fata_draft', JSON.stringify(draft));
    } catch (e) {
      // localStorage 不可用，静默失败
    }

    return draft;
  },

  /**
   * 读取草稿
   */
  loadDraft() {
    try {
      const raw = localStorage.getItem('fata_draft');
      if (!raw) return null;

      const draft = JSON.parse(raw);
      if (Date.now() > draft.expiresAt) {
        localStorage.removeItem('fata_draft');
        return null;
      }

      return draft;
    } catch (e) {
      return null;
    }
  },

  /**
   * 清除草稿
   */
  clearDraft() {
    localStorage.removeItem('fata_draft');
  },

  _escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
  }
};

export { LowSignalGuide };
