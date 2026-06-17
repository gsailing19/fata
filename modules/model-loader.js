/**
 * fata 模型加载器 — v3.2 (bilingual)
 *
 * 职责：
 * - 通过 CDN 动态导入 Transformers.js pipeline
 * - 根据语言加载对应模型（中文 bge-small-zh / 英文 bge-small-en）
 * - pipeline() 自带 IndexedDB 缓存（二次加载 < 3s）
 * - 进度回调实时更新 UI
 * - 加载失败 → TF-IDF 降级
 * - 网络恢复后自动重新加载
 */

const MODELS = {
  zh: { name: 'Xenova/bge-small-zh-v1.5', dim: 512 },
  en: { name: 'Xenova/bge-small-en-v1.5', dim: 384 }
};

const ModelLoader = {
  state: {
    status: 'idle', // idle | loading | ready | fallback
    progress: 0,
    fallbackMode: false,
    lang: 'zh'
  },

  /**
   * 初始化：加载 pipeline + 模型
   * @param {Function} onProgress — 进度回调 (0-100, statusText)
   * @param {string} lang — 语言代码 ('zh' | 'en')
   * @returns {Promise<Object>} — { mode: 'full'|'fallback', pipeline, dim }
   */
  async initialize(onProgress, lang) {
    const t = window.t || (k => k);
    this.state.lang = lang || 'zh';
    const model = MODELS[this.state.lang] || MODELS.zh;

    this._reportProgress(onProgress, 0, t('model.loadingAI'));
    this.state.status = 'loading';

    try {
      const { pipeline } = await import(
        'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js'
      );

      const pipe = await pipeline('feature-extraction', model.name, {
        progress_callback: (info) => {
          if (info.status === 'progress' && info.progress !== undefined) {
            const pct = Math.round(info.progress);
            this.state.progress = pct;
            const label = info.file || '';
            this._reportProgress(onProgress, pct,
              `${t('model.downloading')} ${label} (${pct}%)`);
          } else if (info.status === 'ready') {
            this._reportProgress(onProgress, 100, t('model.ready'));
          }
        }
      });

      this._reportProgress(onProgress, 100, t('model.ready'));
      this.state.status = 'ready';
      this.state.progress = 100;
      return { mode: 'full', source: 'cache', pipeline: pipe, dim: model.dim };
    } catch (e) {
      console.warn('ModelLoader: pipeline creation failed, switching to fallback', e);
      return this._switchToFallback(onProgress);
    }
  },

  async _switchToFallback(onProgress) {
    this.state.status = 'fallback';
    this.state.fallbackMode = true;
    const t = window.t || (k => k);
    this._reportProgress(onProgress, 100, t('model.fallback'));
    this._waitForNetworkRecovery(onProgress);
    const model = MODELS[this.state.lang] || MODELS.zh;
    return { mode: 'fallback', source: 'tfidf', dim: model.dim };
  },

  async _waitForNetworkRecovery(onProgress) {
    if ('connection' in navigator) {
      const connection = navigator.connection;
      const handler = async () => {
        if (connection.effectiveType !== 'slow-2g' && this.state.fallbackMode) {
          connection.removeEventListener('change', handler);
          const result = await this.initialize(onProgress, this.state.lang);
          if (result.mode === 'full') {
            window.dispatchEvent(new CustomEvent('fata:model-ready', {
              detail: { pipeline: result.pipeline, dim: result.dim }
            }));
          }
        }
      };
      connection.addEventListener('change', handler);
    }
  },

  _reportProgress(callback, pct, text) {
    if (callback) callback(pct, text);
  }
};

export { ModelLoader, MODELS };
