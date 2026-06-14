/**
 * fata 模型加载器 — Loop 2.1 (revised)
 *
 * 职责：
 * - 通过 CDN 动态导入 Transformers.js pipeline
 * - pipeline() 自带 IndexedDB 缓存（二次加载 < 3s）
 * - 进度回调实时更新 UI
 * - 加载失败 → TF-IDF 降级
 * - 网络恢复后自动重新加载
 */

const ModelLoader = {
  state: {
    status: 'idle', // idle | loading | ready | fallback
    progress: 0,
    fallbackMode: false
  },

  /**
   * 初始化：加载 pipeline + 模型
   * @param {Function} onProgress — 进度回调 (0-100, statusText)
   * @returns {Promise<Object>} — { mode: 'full'|'fallback', pipeline }
   */
  async initialize(onProgress) {
    this._reportProgress(onProgress, 0, '正在加载 AI 引擎...');
    this.state.status = 'loading';

    try {
      const { pipeline } = await import(
        'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js'
      );

      const pipe = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
        progress_callback: (info) => {
          if (info.status === 'progress' && info.progress !== undefined) {
            const pct = Math.round(info.progress);
            this.state.progress = pct;
            const label = info.file || '';
            this._reportProgress(onProgress, pct,
              `正在下载模型... ${label} (${pct}%)`);
          } else if (info.status === 'ready') {
            this._reportProgress(onProgress, 100, '模型就绪');
          }
        }
      });

      this._reportProgress(onProgress, 100, '模型就绪');
      this.state.status = 'ready';
      this.state.progress = 100;
      return { mode: 'full', source: 'cache', pipeline: pipe };
    } catch (e) {
      console.warn('ModelLoader: pipeline creation failed, switching to fallback', e);
      return this._switchToFallback(onProgress);
    }
  },

  async _switchToFallback(onProgress) {
    this.state.status = 'fallback';
    this.state.fallbackMode = true;
    this._reportProgress(onProgress, 100,
      'AI 引擎暂时无法加载，已切换到基础匹配模式。完整体验可在 Wi-Fi 环境下打开 fata。');
    this._waitForNetworkRecovery(onProgress);
    return { mode: 'fallback', source: 'tfidf' };
  },

  async _waitForNetworkRecovery(onProgress) {
    if ('connection' in navigator) {
      const connection = navigator.connection;
      const handler = async () => {
        if (connection.effectiveType !== 'slow-2g' && this.state.fallbackMode) {
          connection.removeEventListener('change', handler);
          const result = await this.initialize(onProgress);
          if (result.mode === 'full') {
            window.dispatchEvent(new CustomEvent('fata:model-ready', {
              detail: { pipeline: result.pipeline }
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

export { ModelLoader };
