/**
 * fata API client — token-based Worker API wrapper
 *
 * Auth via X-Fata-Submit-Token header.
 * Token obtained through bootstrap → PoW → challenge flow.
 *
 * All API calls go through fata.uk/api/* (Worker route on same domain).
 */

const APIClient = {
  config: {
    baseURL: 'https://fata.uk',
    timeoutMs: 45000
  },

  _apiToken: null,

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

  /** Make an API call with timeout + token auth */
  async call(endpoint, payload) {
    const url = `${this.config.baseURL}${endpoint}`;
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
