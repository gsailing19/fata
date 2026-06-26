/**
 * fata proof-of-work solver — anti-abuse layer
 *
 * Generates a challenge-response PoW that takes ~1-2s on a mid-range mobile device.
 * Uses SHA-256 hashcash-style: find nonce where SHA-256(challenge + nonce) starts with N zero bits.
 *
 * NOT GPU-resistant (SHA-256 is fast on GPU), but raises the cost floor from "free curl" to
 * "need CPU time per request." Combined with rate limits and per-email caps, this makes bulk
 * automated abuse economically unattractive.
 */

const PoWSolver = {
  /** Current challenge state */
  state: {
    challengeNonce: null,
    difficulty: null,
    solution: null,
    submitToken: null,
    expiresAt: null
  },

  /**
   * Fetch challenge from Worker.
   * @returns {Promise<{challengeNonce: string, difficulty: number}>}
   */
  async fetchChallenge() {
    const resp = await fetch(`${APIClient.config.baseURL}/api/bootstrap`, { method: 'POST' });
    if (!resp.ok) throw new Error(`bootstrap failed: ${resp.status}`);
    const data = await resp.json();
    this.state.challengeNonce = data.challengeNonce;
    this.state.difficulty = data.difficulty || 4;
    return data;
  },

  /**
   * Solve PoW: find nonce where SHA-256(challenge + nonce) has `difficulty` leading zero bits.
   *
   * @param {string} challengeNonce - server-provided challenge
   * @param {number} difficulty - leading zero bits required
   * @returns {Promise<{nonce: string, hash: string, duration: number}>}
   */
  async solve(challengeNonce, difficulty) {
    const start = performance.now();
    const encoder = new TextEncoder();
    const challengeBytes = encoder.encode(challengeNonce);
    let nonce = 0;

    while (true) {
      const nonceStr = nonce.toString(36);
      const input = encoder.encode(challengeNonce + nonceStr);
      const hash = await crypto.subtle.digest('SHA-256', input);
      const hashBytes = new Uint8Array(hash);

      // Check leading zero bits
      let zeroBits = 0;
      for (let i = 0; i < hashBytes.length; i++) {
        if (hashBytes[i] === 0) {
          zeroBits += 8;
        } else {
          let b = hashBytes[i];
          while ((b & 0x80) === 0) { zeroBits++; b <<= 1; }
          break;
        }
      }

      if (zeroBits >= difficulty) {
        const hashHex = Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        const duration = Math.round(performance.now() - start);
        this.state.solution = { nonce: nonceStr, hash: hashHex, duration };
        return this.state.solution;
      }

      nonce++;
      // Yield to UI thread every 1000 attempts
      if (nonce % 1000 === 0) await new Promise(r => setTimeout(r, 0));
    }
  },

  /**
   * Submit solution to Worker, get short-lived submit token.
   * @returns {Promise<string>} submitToken
   */
  async submitSolution() {
    if (!this.state.solution) throw new Error('no solution to submit');
    const resp = await fetch(`${APIClient.config.baseURL}/api/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: this.state.solution.nonce,
        challengeNonce: this.state.challengeNonce
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `challenge failed: ${resp.status}`);
    }
    const data = await resp.json();
    this.state.submitToken = data.submitToken;
    this.state.expiresAt = data.expiresAt;
    return data.submitToken;
  },

  /** Reset state */
  reset() {
    this.state = { challengeNonce: null, difficulty: null, solution: null, submitToken: null, expiresAt: null };
  }
};

if (typeof window !== 'undefined') window.PoWSolver = PoWSolver;
export { PoWSolver };
