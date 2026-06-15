/**
 * fata Resend 通知重试 — Loop 4.3
 *
 * 职责：
 * - 匹配完成后向双方各发一封独立邮件（正确视角）
 * - Resend 失败 → Match Issue label 设为 matched-pending-notification
 * - CF Worker 定时扫描未发送的通知并重试
 * - 匹配成功后前端直接显示对方邮箱（不依赖邮件送达）
 */

const ResendRetry = {
  config: {
    maxRetries: 3,
    retryIntervalsMs: [60000, 300000, 900000], // 1min, 5min, 15min
    pendingLabel: 'matched-pending-notification'
  },

  /**
   * 发送匹配通知（含重试逻辑）— 双方各发一封独立邮件
   *
   * @param {Object} matchInfo — { personA: {ownEmail,ownText,showOwnText,otherEmail,otherText,showOtherText,emailHash}, personB: {...}, resonance, icebreakers }
   * @param {string} matchIssueNumber
   * @returns {Promise<Object>}
   */
  async sendWithRetry(matchInfo, matchIssueNumber) {
    const API_BASE = 'https://worker.fata.uk';
    const endpoint = '/api/resend/send';

    // 分别构建两封邮件
    const emails = [
      { to: matchInfo.personA.ownEmail, html: this._buildEmailHTML(matchInfo.personA, matchInfo.resonance, matchInfo.icebreakers) },
      { to: matchInfo.personB.ownEmail, html: this._buildEmailHTML(matchInfo.personB, matchInfo.resonance, matchInfo.icebreakers) }
    ];

    let allSent = true;

    for (const email of emails) {
      let sent = false;
      for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            await this._sleep(this.config.retryIntervalsMs[attempt - 1]);
          }

          const hmacHeaders = await this._buildHMACHeaders(endpoint);
          const response = await fetch(API_BASE + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...hmacHeaders },
            body: JSON.stringify({
              to: [email.to],
              subject: '有人在文字频率上与你共振 — fata',
              html: email.html,
              matchIssueNumber
            })
          });

          if (response.ok) {
            sent = true;
            break;
          }
        } catch (e) {
          console.warn(`ResendRetry: attempt ${attempt + 1} failed for ${email.to}`, e);
        }
      }
      if (!sent) allSent = false;
    }

    if (allSent) {
      await this._updateMatchLabel(matchIssueNumber, 'matched');
      return { success: true, sent: true };
    }

    // 至少一封失败 → 标记 pending-notification
    await this._updateMatchLabel(matchIssueNumber, this.config.pendingLabel);
    return { success: false, sent: false, pendingRetry: true };
  },

  /**
   * 构建单封通知邮件 HTML（一人视角）
   */
  _buildEmailHTML(person, resonance, icebreakers) {
    const icebreakerItems = (icebreakers || [])
      .map((q, i) => `<li style="margin-bottom:8px;color:#4a4a4a;">${q}</li>`)
      .join('');

    const mailtoSubject = encodeURIComponent('关于那件事——来自 fata 的引介');
    const mailtoBody = encodeURIComponent('嘿。\n\nfata 说我们的文字频率很接近。\n\n' + resonance + '\n\n—— 你在 fata 上匹配到的人\n');

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#faf9f6;font-family:Georgia,serif;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:48px 40px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

    <p style="font-size:18px;color:#333;line-height:1.8;margin:0 0 32px;">嘿。</p>

    <p style="font-size:16px;color:#2a2a2a;line-height:2;margin:0 0 32px;">
      ${resonance}
    </p>

    ${person.showOwnText ? `
    <div style="border-left:2px solid #e0d8cc;padding-left:16px;margin:0 0 24px;">
      <p style="font-size:14px;color:#999;margin:0 0 8px;">还记得你写下的这段话吗——</p>
      <p style="font-size:15px;color:#555;line-height:1.9;margin:0;font-style:italic;">
        "${person.ownText}"
      </p>
    </div>` : ''}

    ${person.showOtherText ? `
    <div style="border-left:2px solid #e0d8cc;padding-left:16px;margin:0 0 32px;">
      <p style="font-size:14px;color:#999;margin:0 0 8px;">TA 写了——</p>
      <p style="font-size:15px;color:#555;line-height:1.9;margin:0;font-style:italic;">
        "${person.otherText}"
      </p>
    </div>` : ''}

    <div style="background:#faf9f6;padding:20px 24px;border-radius:4px;margin:0 0 24px;">
      <p style="font-size:14px;color:#999;margin:0 0 8px;">TA 的邮箱</p>
      <p style="font-size:20px;color:#2a2a2a;margin:0;font-weight:bold;letter-spacing:0.5px;">
        ${person.otherEmail}
      </p>
    </div>

    ${icebreakerItems ? `
    <div style="margin:0 0 32px;">
      <p style="font-size:14px;color:#999;margin:0 0 12px;">不知道怎么下笔？试试这几句——</p>
      <ul style="padding-left:20px;margin:0;">${icebreakerItems}</ul>
    </div>` : ''}

    <a href="mailto:${person.otherEmail}?subject=${mailtoSubject}&body=${mailtoBody}"
      style="display:inline-block;background:#2a2a2a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:15px;font-family:Georgia,serif;">
      写信给 TA
    </a>

    <p style="font-size:13px;color:#bbb;margin:32px 0 0;line-height:1.6;">
      如果按钮打不开，直接复制上面的邮箱地址到你的邮件客户端中新建邮件。
    </p>

    <hr style="border:none;border-top:1px solid #e8e4dc;margin:32px 0;">

    <p style="font-size:12px;color:#ccc;line-height:1.8;margin:0;">
      通信在你自己的邮箱中进行。fata 只是一个引介工具——把人介绍给你后，它主动退出。<br>
      <a href="https://fata.uk" style="color:#bbb;">想再写一封？回到 fata</a>
      &nbsp;·&nbsp;
      <a href="https://worker.fata.uk/unsubscribe?h=${encodeURIComponent(person.emailHash || '')}" style="color:#bbb;">暂停通知</a>
    </p>

  </div>
</body>
</html>`;
  },

  /**
   * 更新 GitHub Issue 的 label（通过 CF Worker）
   */
  async _updateMatchLabel(issueNumber, newLabel) {
    try {
      const API_BASE = 'https://worker.fata.uk';
      const endpoint = `/api/github/issues/${issueNumber}/labels`;
      const hmacHeaders = await this._buildHMACHeaders(endpoint);
      await fetch(API_BASE + endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...hmacHeaders },
        body: JSON.stringify({ labels: [newLabel] })
      });
    } catch (e) {
      console.error('ResendRetry: Failed to update issue label', e);
    }
  },

  async _buildHMACHeaders(endpoint) {
    const rawKey = (typeof window !== 'undefined' && window.HMAC_KEY_RAW) || '';
    if (!rawKey) return {};
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = new URL(endpoint, 'https://worker.fata.uk').pathname;
    const message = `${timestamp}:${path}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(rawKey);
    const key = await crypto.subtle.importKey('raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return { 'X-Fata-Signature': sigStr, 'X-Fata-Timestamp': timestamp };
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

export { ResendRetry };
