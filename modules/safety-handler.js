/**
 * fata 安全处理器 — Loop 1.2
 *
 * 职责：
 * - 接收 LLM 返回的 risk_level 和 content_flag
 * - risk_level=high → 不创建 Issue，展示心理援助资源页面
 * - content_flag=hate/harassment → 拒绝创建 Issue，冷却 session
 * - risk_level=low → 正常匹配，但在匹配页面上有微妙提示
 *
 * 设计原则：
 * - 不警告、不标记用户、不弹窗
 * - "展示资源，不判断人"
 * - 高危文字仍存本地加密，用户可随时查看
 */

const SafetyHandler = {
  // 心理援助资源（中文 + 国际）
  resources: [
    {
      name: '北京心理援助热线（24小时）',
      phone: '010-82951332',
      region: 'cn'
    },
    {
      name: '生命热线（24小时）',
      phone: '400-161-9995',
      region: 'cn'
    },
    {
      name: '988 Suicide & Crisis Lifeline（US, 24/7）',
      phone: '988',
      region: 'intl'
    }
  ],

  /**
   * 处理 LLM 返回的安全分析结果
   * @param {Object} analysisResult — { score, reason, risk_level, content_flag }
   * @param {string} originalText — 用户原始文字（用于本地加密存储）
   * @returns {Object} — { action, message, shouldCreateIssue, cooldownSeconds }
   */
  handleAnalysis(analysisResult, originalText) {
    const { risk_level, content_flag } = analysisResult;

    // 第一优先级：content_flag=hate/harassment → 拒绝入池
    if (content_flag === 'hate' || content_flag === 'harassment') {
      return {
        action: 'reject',
        shouldCreateIssue: false,
        cooldownSeconds: 3600, // 1 小时 session 冷却
        message: 'fata 是一个让人互相理解的地方。你的文字目前不适合这里的匹配池。如果你有不同的想法，一个小时后可以再试。',
        uiState: 'rejected'
      };
    }

    // 第二优先级：content_flag=self_harm 或 risk_level=high → 不匹配 + 展示资源
    if (content_flag === 'self_harm' || risk_level === 'high') {
      // 文字存本地加密，不创建 Issue
      this._storeLocalEncrypted(originalText, 'high_risk');

      return {
        action: 'support',
        shouldCreateIssue: false,
        cooldownSeconds: 0, // 不冷却，用户可以随时写新文字
        message: null, // 不使用纯文本 message，使用 UI 页面
        uiState: 'support_resources',
        resources: this.resources
      };
    }

    // 第三优先级：risk_level=low → 正常匹配，但存标记
    if (risk_level === 'low') {
      return {
        action: 'allow_with_note',
        shouldCreateIssue: true,
        cooldownSeconds: 0,
        message: null,
        uiState: 'normal',
        internalFlag: 'low_risk' // 内部标记，不展示给用户或匹配对象
      };
    }

    // 所有安全标记为 none → 正常
    return {
      action: 'allow',
      shouldCreateIssue: true,
      cooldownSeconds: 0,
      message: null,
      uiState: 'normal'
    };
  },

  /**
   * LLM 不可用时的本地关键词兜底检查。
   * 不替代 LLM 的语义理解能力，但能拦截最明显的危险信号。
   * @param {string} text - 用户文字
   * @returns {{ action: 'allow'|'support'|'reject' }}
   */
  localCheck(text) {
    const t = text || '';

    // 高危自伤关键词（中文常见表达）
    const selfHarmPatterns = [
      /想死/, /不想活/, /自杀/, /结束生命/, /活不下去/,
      /自残/, /割腕/, /跳楼/, /上吊/, /安眠药/,
      /没有意义.*活着/, /活着.*没有意义/, /不如死/,
      /不想.*醒过来/, /永远.*睡过去/, /离开这个世界/
    ];

    // 仇恨/骚扰关键词
    const hatePatterns = [
      /杀光/, /灭掉/, /弄死.*人/, /暴力/, /殴打/,
      /人肉/, /曝光.*隐私/, /报复/
    ];

    for (const p of selfHarmPatterns) {
      if (p.test(t)) {
        return { action: 'support' };
      }
    }

    for (const p of hatePatterns) {
      if (p.test(t)) {
        return { action: 'reject' };
      }
    }

    return { action: 'allow' };
  },

  /**
   * 获取心理援助资源页面的 HTML
   * 这个页面替换"等待匹配"页面，在 risk_level=high 时展示
   *
   * 设计意图：
   * - 不喊"我们检测到你有自杀倾向"（触发防御机制）
   * - 语气像"有一个人在另一端"
   * - 不强制、不说教、不拯救
   */
  getSupportResourcesHTML(resources) {
    const resourceItems = resources.map(r =>
      `<div class="resource-item">
        <span class="resource-name">${r.name}</span>
        <span class="resource-phone">${r.phone}</span>
      </div>`
    ).join('');

    return `
      <div class="support-resources-container">
        <div class="support-greeting">
          <p class="support-main-text">你写的文字在这里，加密的，只有你能看到。</p>
          <p class="support-sub-text">无论你现在在想什么，有一些人24小时在电话那头。他们不会评判你，只是听。</p>
        </div>

        <div class="support-resource-list">
          ${resourceItems}
        </div>

        <div class="support-divider"></div>

        <div class="support-alt-actions">
          <p class="support-alt-text">你还可以——</p>
          <button class="btn-alt" onclick="fata.ui.showWritePage()">
            写一段新的文字
          </button>
          <button class="btn-alt-ghost" onclick="fata.ui.showHistory()">
            看看你之前写过的
          </button>
        </div>

        <p class="support-footer-text">
          fata 不会标记你、不会限制你、不会让你等不到匹配。
          无论什么时候，你都值得被听到。
        </p>
      </div>
    `;
  },

  /**
   * 获取 content_flag 拒绝页面的 HTML
   * content_flag=hate/harassment 时展示
   */
  getRejectionHTML(cooldownMinutes) {
    return `
      <div class="rejection-container">
        <p class="rejection-main-text">
          fata 是一个让人互相理解的地方。
        </p>
        <p class="rejection-sub-text">
          你的文字目前不适合这里的匹配池。
          如果你有不同的想法，${cooldownMinutes} 分钟后可以再试。
        </p>
        <p class="rejection-footer-text">
          这不是惩罚。fata 不做惩罚。
          只是你的这段文字暂时不适合遇到陌生人。
        </p>
      </div>
    `;
  },

  /**
   * 获取页面底部常驻的心理援助资源（所有用户可见）
   */
  getFooterResourcesHTML() {
    return `
      <div class="footer-resources">
        <span class="footer-resources-label">需要找人聊聊？</span>
        <span class="footer-resources-phone">北京心理援助热线 010-82951332 · 生命热线 400-161-9995</span>
        <span class="footer-resources-note">24小时 · 免费 · 匿名</span>
      </div>
    `;
  },

  /**
   * 将高危文字加密后存本地 IndexedDB
   * 不上传、不创建 Issue
   */
  async _storeLocalEncrypted(text, category) {
    try {
      const db = await this._openDB();
      const tx = db.transaction('local_texts', 'readwrite');
      const store = tx.objectStore('local_texts');

      // 使用 Web Crypto API 加密
      const encoder = new TextEncoder();
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt']
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(text)
      );

      // 导出密钥（存本地，不离开设备）
      const exportedKey = await crypto.subtle.exportKey('raw', key);

      await store.put({
        id: Date.now(),
        category,
        encryptedText: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv),
        key: Array.from(new Uint8Array(exportedKey)),
        timestamp: Date.now()
      });
    } catch (e) {
      // IndexedDB 不可用时静默失败，不阻断用户体验
      console.error('SafetyHandler: Failed to store local encrypted text', e);
    }
  },

  async _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('fata_safety', 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('local_texts')) {
          db.createObjectStore('local_texts', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
};

export { SafetyHandler };
