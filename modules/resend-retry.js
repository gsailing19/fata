/**
 * fata Resend 通知重试 — Loop 2.3
 *
 * 职责：
 * - 匹配完成后调用 Resend API 发送通知邮件
 * - Resend 失败 → Match Issue label 设为 matched-pending-notification
 * - CF Worker 定时扫描未发送的通知并重试
 * - 匹配成功后前端直接显示对方邮箱（不依赖邮件送达）
 *
 * 流程重构：
 *   Step 1: close Issue A + Issue B + 创建 Match Issue → 不可逆
 *   Step 2: Resend 通知发送 → 成功 → label = matched
 *   Step 3: Resend 失败 → label = matched-pending-notification → 定时重试
 */

const ResendRetry = {
  config: {
    maxRetries: 3,
    retryIntervalsMs: [60000, 300000, 900000], // 1min, 5min, 15min
    pendingLabel: 'matched-pending-notification'
  },

  /**
   * 发送匹配通知（含重试逻辑）
   *
   * @param {Object} matchInfo — { matchA: {email,text}, matchB: {email,text}, resonance, icebreakers }
   * @param {string} matchIssueNumber — Match Issue 的 GitHub Issue 编号
   * @returns {Promise<Object>} — { success, sent, emailA, emailB }
   */
  async sendWithRetry(matchInfo, matchIssueNumber) {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await this._sleep(this.config.retryIntervalsMs[attempt - 1]);
        }

        const API_BASE = 'https://worker.fata.uk';
        const response = await fetch(API_BASE + '/api/resend/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: [matchInfo.matchA.email, matchInfo.matchB.email],
            subject: '有人在文字频率上与你共振 — fata',
            html: this._buildEmailHTML(matchInfo),
            matchIssueNumber
          })
        });

        if (response.ok) {
          // 通知成功 → 更新 Match Issue label 为 matched
          await this._updateMatchLabel(matchIssueNumber, 'matched');

          return {
            success: true,
            sent: true,
            emailA: matchInfo.matchA.email,
            emailB: matchInfo.matchB.email
          };
        }
      } catch (e) {
        console.warn(`ResendRetry: attempt ${attempt + 1} failed`, e);
      }
    }

    // 所有重试失败 → 标记 pending-notification
    await this._updateMatchLabel(matchIssueNumber, this.config.pendingLabel);

    return {
      success: false,
      sent: false,
      emailA: matchInfo.matchA.email,
      emailB: matchInfo.matchB.email,
      pendingRetry: true
    };
  },

  /**
   * 构建通知邮件 HTML（信纸风格）
   */
  _buildEmailHTML(matchInfo) {
    const { resonance, icebreakers, matchA, matchB } = matchInfo;

    const icebreakerItems = (icebreakers || [])
      .map((q, i) => `<li style="margin-bottom:8px;color:#4a4a4a;">${q}</li>`)
      .join('');

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#faf9f6;font-family:Georgia,serif;padding:40px 20px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:48px 40px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

    <p style="font-size:18px;color:#333;line-height:1.8;margin:0 0 32px;">嘿。</p>

    <!-- 共鸣描述 -->
    <p style="font-size:16px;color:#2a2a2a;line-height:2;margin:0 0 32px;">
      ${resonance}
    </p>

    <!-- 引用用户自己的文字 -->
    ${matchA.showOwnText ? `
    <div style="border-left:2px solid #e0d8cc;padding-left:16px;margin:0 0 24px;">
      <p style="font-size:14px;color:#999;margin:0 0 8px;">还记得你写下的这段话吗——</p>
      <p style="font-size:15px;color:#555;line-height:1.9;margin:0;font-style:italic;">
        "${matchA.ownTextSnippet}"
      </p>
    </div>` : ''}

    <!-- 对方文字片段 -->
    ${matchA.seeOtherText ? `
    <div style="border-left:2px solid #e0d8cc;padding-left:16px;margin:0 0 32px;">
      <p style="font-size:14px;color:#999;margin:0 0 8px;">TA 写了——</p>
      <p style="font-size:15px;color:#555;line-height:1.9;margin:0;font-style:italic;">
        "${matchB.textSnippet}"
      </p>
    </div>` : ''}

    <!-- 对方邮箱 -->
    <div style="background:#faf9f6;padding:20px 24px;border-radius:4px;margin:0 0 24px;">
      <p style="font-size:14px;color:#999;margin:0 0 8px;">TA 的邮箱</p>
      <p style="font-size:20px;color:#2a2a2a;margin:0;font-weight:bold;letter-spacing:0.5px;">
        ${matchB.email}
      </p>
    </div>

    <!-- 破冰问题 -->
    ${icebreakerItems ? `
    <div style="margin:0 0 32px;">
      <p style="font-size:14px;color:#999;margin:0 0 12px;">不知道怎么下笔？试试这几句——</p>
      <ul style="padding-left:20px;margin:0;">${icebreakerItems}</ul>
    </div>` : ''}

    <!-- mailto: CTA -->
    <a href="mailto:${matchB.email}?subject=%E5%85%B3%E4%BA%8E%E9%82%A3%E4%BB%B6%E4%BA%8B%E2%80%94%E2%80%94%E6%9D%A5%E8%87%AA%20fata%20%E7%9A%84%E5%BC%95%E4%BB%8B&body=%E5%98%BF%E3%80%82%0A%0Afata%20%E8%AF%B4%E6%88%91%E4%BB%AC%E7%9A%84%E6%96%87%E5%AD%97%E9%A2%91%E7%8E%87%E5%BE%88%E6%8E%A5%E8%BF%91%E3%80%82%0A%0A%E2%80%94%E2%80%94%20%E4%BD%A0%E5%9C%A8%20fata%20%E4%B8%8A%E5%8C%B9%E9%85%8D%E5%88%B0%E7%9A%84%E4%BA%BA%0A%0A%5B%E9%9C%87%E5%85%B1%E9%B8%A3%E6%8F%8F%E8%BF%B0%5D%0A${encodeURIComponent(resonance)}%0A%0A"
      style="display:inline-block;background:#2a2a2a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:15px;font-family:Georgia,serif;">
      写信给 TA
    </a>

    <p style="font-size:13px;color:#bbb;margin:32px 0 0;line-height:1.6;">
      如果按钮打不开，直接复制上面的邮箱地址到你的邮件客户端中新建邮件。
    </p>

    <!-- 分隔线 -->
    <hr style="border:none;border-top:1px solid #e8e4dc;margin:32px 0;">

    <!-- 底部说明 -->
    <p style="font-size:12px;color:#ccc;line-height:1.8;margin:0;">
      通信在你自己的邮箱中进行。fata 只是一个引介工具——把人介绍给你后，它主动退出。<br>
      <a href="https://fata.uk" style="color:#bbb;">想再写一封？回到 fata</a>
      &nbsp;·&nbsp;
      <a href="https://worker.fata.uk/unsubscribe?h=${encodeURIComponent(matchB.emailHash || '')}" style="color:#bbb;">暂停通知</a>
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
      await fetch(API_BASE + `/api/github/issues/${issueNumber}/label`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel })
      });
    } catch (e) {
      console.error('ResendRetry: Failed to update issue label', e);
    }
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

export { ResendRetry };
