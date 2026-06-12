/**
 * fata 模型加载器 — Loop 2.1
 *
 * 职责：
 * - 从 jsDelivr CDN 下载 bge-small-zh-v1.5 的 ONNX 模型（24MB）
 * - 下载前校验 IndexedDB 中已有缓存的完整性
 * - 分块下载 + 真实进度条
 * - 下载失败 → 3 次指数退避重试 → 仍失败 → 自动切换到 TF-IDF 降级
 * - 网络恢复后自动重新下载完整模型
 *
 * 数据流：
 * 1. 检查本地缓存完整性 → 完整 → 直接加载
 * 2. 不完整 → 开始下载 → 分块 + 真实进度
 * 3. 下载失败 → 重试 (1s, 3s, 9s) → 仍失败 → TF-IDF 降级
 * 4. 网络恢复 → 自动重新下载
 */

const ModelLoader = {
  // 配置
  config: {
    modelUrl: 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/onnx/models/Xenova/bge-small-zh-v1.5',
    expectedSize: 24 * 1024 * 1024, // 24MB
    cacheName: 'fata-models-v1',
    dbName: 'fata_models',
    maxRetries: 3,
    retryDelays: [1000, 3000, 9000], // 指数退避
    chunkSize: 1024 * 1024 // 1MB 分块
  },

  // 状态
  state: {
    status: 'idle', // idle | checking | downloading | loading | ready | fallback | error
    progress: 0,    // 0-100
    fallbackMode: false
  },

  /**
   * 初始化：检查缓存 → 加载或下载
   * @param {Function} onProgress — 进度回调 (0-100, statusText)
   * @returns {Promise<Object>} — { mode: 'full'|'fallback', pipeline }
   */
  async initialize(onProgress) {
    this._reportProgress(onProgress, 0, '正在检查本地模型...');
    this.state.status = 'checking';

    // Step 1: 检查 IndexedDB 缓存
    const cached = await this._checkCache();

    if (cached && cached.size === this.config.expectedSize) {
      this._reportProgress(onProgress, 100, '模型已就绪（本地缓存）');
      this.state.status = 'ready';
      this.state.progress = 100;
      return { mode: 'full', source: 'cache' };
    }

    // Step 2: 缓存不完整，清除后重新下载
    if (cached) {
      await this._clearCache();
    }

    return this._downloadWithRetry(onProgress);
  },

  /**
   * 下载模型（含重试逻辑）
   */
  async _downloadWithRetry(onProgress) {
    this.state.status = 'downloading';

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this._reportProgress(onProgress, this.state.progress,
            `下载失败，正在重试（第 ${attempt} 次）...`);
          await this._sleep(this.config.retryDelays[attempt - 1]);
        }

        await this._downloadModel(onProgress);

        // 下载成功后校验
        const cached = await this._checkCache();
        if (cached && cached.size === this.config.expectedSize) {
          this._reportProgress(onProgress, 100, '模型就绪');
          this.state.status = 'ready';
          this.state.progress = 100;
          return { mode: 'full', source: 'download' };
        }

        // 校验失败，继续重试
        this._reportProgress(onProgress, this.state.progress, '文件校验失败，正在重试...');
      } catch (e) {
        console.warn(`ModelLoader: download attempt ${attempt + 1} failed`, e);
      }
    }

    // Step 3: 所有重试失败 → 切换到 TF-IDF 降级
    return this._switchToFallback(onProgress);
  },

  /**
   * 分块下载模型文件
   */
  async _downloadModel(onProgress) {
    const url = this.config.modelUrl + '/onnx/model.onnx';

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      received += value.length;

      if (contentLength > 0) {
        const pct = Math.round((received / contentLength) * 100);
        this.state.progress = pct;
        this._reportProgress(onProgress, pct,
          `正在下载模型... ${Math.round(received / 1024 / 1024)}MB / ${Math.round(contentLength / 1024 / 1024)}MB`);
      }
    }

    // 合并 chunks 存入 IndexedDB
    const fullBlob = new Blob(chunks);
    await this._storeToCache(fullBlob);
  },

  /**
   * 切换到 TF-IDF 降级模式
   */
  async _switchToFallback(onProgress) {
    this.state.status = 'fallback';
    this.state.fallbackMode = true;

    this._reportProgress(onProgress, 100,
      'AI 引擎暂时无法加载，已切换到基础匹配模式。完整体验可在 Wi-Fi 环境下打开 fata。');

    // 异步尝试：如果在降级模式下网络恢复，重新下载
    this._waitForNetworkRecovery(onProgress);

    return { mode: 'fallback', source: 'tfidf' };
  },

  /**
   * 监听网络恢复，自动重新下载
   */
  async _waitForNetworkRecovery(onProgress) {
    if ('connection' in navigator) {
      const connection = navigator.connection;
      const handler = async () => {
        if (connection.effectiveType !== 'slow-2g' && this.state.fallbackMode) {
          connection.removeEventListener('change', handler);
          await this._downloadWithRetry(onProgress);
          if (this.state.status === 'ready') {
            // 通知用户模型已就绪
            const event = new CustomEvent('fata:model-ready');
            window.dispatchEvent(event);
          }
        }
      };
      connection.addEventListener('change', handler);
    }
  },

  // --- IndexedDB 缓存操作 ---

  async _checkCache() {
    try {
      const db = await this._openDB();
      const tx = db.transaction('models', 'readonly');
      const store = tx.objectStore('models');
      return await store.get('bge-small-zh-v1.5');

      // 返回 { size, blob, timestamp } 或 undefined
    } catch (e) {
      return null;
    }
  },

  async _storeToCache(blob) {
    const db = await this._openDB();
    const tx = db.transaction('models', 'readwrite');
    const store = tx.objectStore('models');
    await store.put({
      key: 'bge-small-zh-v1.5',
      size: blob.size,
      blob: blob,
      timestamp: Date.now()
    });
  },

  async _clearCache() {
    const db = await this._openDB();
    const tx = db.transaction('models', 'readwrite');
    const store = tx.objectStore('models');
    await store.delete('bge-small-zh-v1.5');
  },

  async _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  // --- 辅助 ---

  _reportProgress(callback, pct, text) {
    if (callback) callback(pct, text);
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

export { ModelLoader };
