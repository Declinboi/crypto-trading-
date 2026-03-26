import { baseTemplate } from './base.template';

export const payoutSuccessTemplate = (data: {
  firstName: string;
  amountNgn: number;
  bankName: string;
  accountLastFour: string;
  reference: string;
  platformFee: number;
  flwFee: number;
}) =>
  baseTemplate(
    `
  <h1>Payout Successful ✅</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your withdrawal has been successfully sent to your bank account.</p>

  <div class="amount-box">
    <div class="label">Amount Sent</div>
    <div class="value">₦${Number(data.amountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
    <div class="sub">${data.bankName} ****${data.accountLastFour}</div>
  </div>

  <table class="info-table">
    <tr><td>Bank</td><td>${data.bankName}</td></tr>
    <tr><td>Account</td><td>****${data.accountLastFour}</td></tr>
    <tr><td>Platform Fee</td><td>₦${Number(data.platformFee).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
    <tr><td>Transfer Fee</td><td>₦${Number(data.flwFee).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
    <tr><td>Reference</td><td style="font-family:monospace;font-size:12px;">${data.reference}</td></tr>
    <tr><td>Status</td><td><span class="status-badge status-success">Successful</span></td></tr>
  </table>

  <div class="alert-box alert-success">
    <p>✅ Funds should reflect in your account within minutes. If not received after 24 hours, contact your bank with the reference above.</p>
  </div>
`,
    `Payout successful: ₦${Number(data.amountNgn).toLocaleString('en-NG')} sent to ${data.bankName}`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const payoutFailedTemplate = (data: {
  firstName: string;
  amountNgn: number;
  reason: string;
  payoutId: string;
}) =>
  baseTemplate(
    `
  <h1>Payout Failed ❌</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Unfortunately your payout of <strong>₦${Number(data.amountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</strong> could not be processed.</p>

  <div class="alert-box alert-danger">
    <p>❌ Reason: ${data.reason}</p>
  </div>

  <table class="info-table">
    <tr><td>Amount</td><td>₦${Number(data.amountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
    <tr><td>Payout ID</td><td style="font-family:monospace;font-size:12px;">${data.payoutId}</td></tr>
    <tr><td>Status</td><td><span class="status-badge status-failed">Failed</span></td></tr>
  </table>

  <p>Your funds are safe and have not been deducted. You can retry the withdrawal from your dashboard.</p>

  <div style="text-align:center;margin-top:24px;">
    <a href="${process.env.FRONTEND_URL}/wallet" class="btn">Retry Withdrawal →</a>
    <br/>
    <a href="${process.env.FRONTEND_URL}/support" class="btn-outline">Contact Support</a>
  </div>
`,
    `Payout failed: ₦${Number(data.amountNgn).toLocaleString('en-NG')} — action required`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const payoutReversedTemplate = (data: {
  firstName: string;
  amountNgn: number;
  bankName: string;
  reason: string;
}) =>
  baseTemplate(
    `
  <h1>Payout Reversed ↩️</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your payout of <strong>₦${Number(data.amountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</strong> to ${data.bankName} was reversed by the bank.</p>

  <div class="alert-box alert-warning">
    <p>⚠️ Reason: ${data.reason ?? 'Transfer reversed by receiving bank'}</p>
  </div>

  <p>Please verify your bank account details are correct and try again. If the problem persists, contact your bank or our support team.</p>

  <div style="text-align:center;margin-top:24px;">
    <a href="${process.env.FRONTEND_URL}/settings/bank-accounts" class="btn">Check Bank Account →</a>
  </div>
`,
    `Payout reversed — ₦${Number(data.amountNgn).toLocaleString('en-NG')} returned`,
  );
