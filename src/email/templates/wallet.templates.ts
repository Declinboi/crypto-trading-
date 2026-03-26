import { baseTemplate } from './base.template';

export const walletCreditedTemplate = (data: {
  firstName: string;
  amountNgn: number;
  description: string;
  newBalance: number;
}) =>
  baseTemplate(
    `
  <h1>Wallet Credited 💰</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your CryptoPay wallet has been credited.</p>

  <div class="amount-box">
    <div class="label">Amount Added</div>
    <div class="value">₦${Number(data.amountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
    <div class="sub">New Balance: ₦${Number(data.newBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
  </div>

  <table class="info-table">
    <tr><td>Description</td><td>${data.description}</td></tr>
    <tr><td>New Balance</td><td style="color:#10b981;font-weight:700;">₦${Number(data.newBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
  </table>

  <div style="text-align:center;margin-top:24px;">
    <a href="${process.env.FRONTEND_URL}/wallet" class="btn">View Wallet →</a>
  </div>
`,
    `₦${Number(data.amountNgn).toLocaleString('en-NG')} added to your CryptoPay wallet`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const transferSentTemplate = (data: {
  firstName: string;
  amountNgn: number;
  recipientTag: string;
  recipientName: string;
  note?: string;
  newBalance: number;
  reference: string;
}) =>
  baseTemplate(
    `
  <h1>Transfer Sent ✅</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your transfer has been sent successfully.</p>

  <div class="amount-box">
    <div class="label">Amount Sent</div>
    <div class="value">₦${Number(data.amountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
    <div class="sub">To @${data.recipientTag}</div>
  </div>

  <table class="info-table">
    <tr><td>Recipient</td><td>${data.recipientName}</td></tr>
    <tr><td>Wallet Tag</td><td>@${data.recipientTag}</td></tr>
    ${data.note ? `<tr><td>Note</td><td>${data.note}</td></tr>` : ''}
    <tr><td>Transfer Fee</td><td>Free ✅</td></tr>
    <tr><td>Reference</td><td style="font-family:monospace;font-size:12px;">${data.reference}</td></tr>
    <tr><td>New Balance</td><td>₦${Number(data.newBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
  </table>
`,
    `Transfer sent: ₦${Number(data.amountNgn).toLocaleString('en-NG')} to @${data.recipientTag}`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const transferReceivedTemplate = (data: {
  firstName: string;
  amountNgn: number;
  senderTag: string;
  senderName: string;
  note?: string;
  newBalance: number;
}) =>
  baseTemplate(
    `
  <h1>Money Received 💰</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>You have received a transfer to your CryptoPay wallet.</p>

  <div class="amount-box">
    <div class="label">Amount Received</div>
    <div class="value">₦${Number(data.amountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
    <div class="sub">From @${data.senderTag}</div>
  </div>

  <table class="info-table">
    <tr><td>Sender</td><td>${data.senderName}</td></tr>
    <tr><td>Wallet Tag</td><td>@${data.senderTag}</td></tr>
    ${data.note ? `<tr><td>Note</td><td>"${data.note}"</td></tr>` : ''}
    <tr><td>New Balance</td><td style="color:#10b981;font-weight:700;">₦${Number(data.newBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
  </table>

  <div style="text-align:center;margin-top:24px;">
    <a href="${process.env.FRONTEND_URL}/wallet" class="btn">View Wallet →</a>
  </div>
`,
    `You received ₦${Number(data.amountNgn).toLocaleString('en-NG')} from @${data.senderTag}`,
  );
