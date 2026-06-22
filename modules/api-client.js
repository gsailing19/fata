/**
 * fata API client — simplified Worker API wrapper
 *
 * Replaces llm-fallback.js. Now only handles generic API calls with HMAC signing.
 * All LLM-specific logic (signal density, intent parse, resonance, interview)
 * has been moved to browser-side heuristics or Worker-internal processing.
 */

const APIClient = {
  config: {
    baseURL: 'https://worker.fata.uk',
    timeoutMs: 25000
  },

  /**
   * Build HMAC signature headers.
   * @param {string} endpoint - API path (e.g. '/api/submit')
   * @param {string} hmacKey - HMAC signing key
   */
  async _buildHMACHeaders(endpoint, hmacKey) {
    if (!hmacKey) {
      console.warn('fata: HMAC key not available');
      return {};
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${timestamp}:${endpoint}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(hmacKey);
    const key = await crypto.subtle.importKey('raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return {
      'X-Fata-Signature': sigStr,
      'X-Fata-Timestamp': timestamp,
      'Content-Type': 'application/json'
    };
  },

  /**
   * Make an API call with timeout + HMAC signing.
   */
  async call(endpoint, payload, hmacKey, submitToken) {
    const url = `${this.config.baseURL}${endpoint}`;
    const headers = await this._buildHMACHeaders(endpoint, hmacKey);
    if (submitToken) headers['X-Fata-Submit-Token'] = submitToken;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `API ${resp.status}`);
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('timeout');
      throw e;
    }
  }
};

if (typeof window !== 'undefined') window.APIClient = APIClient;
