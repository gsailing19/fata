/**
 * fata API client — token-based Worker API wrapper
 *
 * Phase 3: HMAC signing removed. Auth via X-Fata-Submit-Token header.
 * Token obtained through bootstrap → PoW → challenge flow.
 *
 * Supports automatic fallback: tries primary baseURL first,
 * if unreachable falls back to workers.dev subdomain.
 */

const APIClient = {
  config: {
    baseURL: 'https://fata.uk',
    fallbackURL: 'https://fata-api-proxy.gsailing19.workers.dev',
    timeoutMs: 25000
  },

  _apiToken: null,
  _activeBase: null, // set after first successful probe
  _probing: null,    // pending probe promise

  /** Store the api token for subsequent requests */
  setToken(token) {
    this._apiToken = token;
  },

  /** Build request headers with token auth */
  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this._apiToken) {
      headers['X-Fata-Submit-Token'] = this._apiToken;
    }
    return headers;
  },

  /** Probe an endpoint to see if it's reachable */
  async _probe(base) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${base}/api/health`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.status === 'ok') return base;
      }
    } catch (_) { /* unreachable */ }
    return null;
  },

  /** Get the working base URL (probes primary then fallback) */
  async _getBaseURL() {
    if (this._activeBase) return this._activeBase;
    if (this._probing) return this._probing;

    this._probing = (async () => {
      // Try primary first
      let working = await this._probe(this.config.baseURL);
      if (working) { this._activeBase = working; return working; }
      // Try fallback
      working = await this._probe(this.config.fallbackURL);
      if (working) { this._activeBase = working; return working; }
      // Neither works — return primary and let it fail with error
      this._activeBase = this.config.baseURL;
      return this.config.baseURL;
    })();

    return this._probing;
  },

  /** Make an API call with timeout + token auth */
  async call(endpoint, payload) {
    const base = await this._getBaseURL();
    const url = `${base}${endpoint}`;
    const headers = this._buildHeaders();

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
export { APIClient };
