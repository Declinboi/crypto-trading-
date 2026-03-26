import { baseTemplate } from './base.template';

export const paymentReceivedTemplate = (data: {
  firstName: string;
  invoiceNumber: string;
  cryptoAmount: number;
  coin: string;
  grossNgnAmount: number;
  platformFeeNgn: number;
  netNgnAmount: number;
  autoCashout: boolean;
  bankName?: string;
  accountLastFour?: string;
}) =>
  baseTemplate(
    `
  <h1>Payment Received ✅</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your crypto payment for invoice <strong>${data.invoiceNumber}</strong> has been confirmed on the blockchain.</p>

  <div class="amount-box">
    <div class="label">You Receive</div>
    <div class="value">₦${Number(data.netNgnAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div>
    <div class="sub">${data.cryptoAmount} ${data.coin.toUpperCase()} received</div>
  </div>

  <table class="info-table">
    <tr><td>Invoice</td><td>${data.invoiceNumber}</td></tr>
    <tr><td>Crypto Received</td><td>${data.cryptoAmount} <span class="coin-badge">${data.coin.toUpperCase()}</span></td></tr>
    <tr><td>Gross NGN</td><td>₦${Number(data.grossNgnAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
    <tr><td>Platform Fee</td><td>₦${Number(data.platformFeeNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
    <tr><td>Net Amount</td><td style="color:#10b981;font-weight:700;">₦${Number(data.netNgnAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td></tr>
  </table>

  ${
    data.autoCashout && data.bankName
      ? `
  <div class="alert-box alert-success">
    <p>🚀 Auto-cashout is active — ₦${Number(data.netNgnAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })} is being sent directly to your ${data.bankName} account ending ****${data.accountLastFour}.</p>
  </div>
  `
      : `
  <div class="alert-box alert-info">
    <p>💰 ₦${Number(data.netNgnAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })} has been added to your CryptoPay wallet. Withdraw to your bank anytime.</p>
  </div>
  <div style="text-align:center;margin-top:24px;">
    <a href="${process.env.FRONTEND_URL}/wallet" class="btn">View Wallet →</a>
  </div>
  `
  }
`,
    `Payment received: ₦${Number(data.netNgnAmount).toLocaleString('en-NG')} for invoice ${data.invoiceNumber}`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const paymentWaitingTemplate = (data: {
  firstName: string;
  invoiceNumber: string;
  cryptoAmount: number;
  coin: string;
  paymentAddress: string;
  amountUsd: number;
  expiresAt: Date;
}) =>
  baseTemplate(
    `
  <h1>Payment Detected 👀</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>We have detected a payment for invoice <strong>${data.invoiceNumber}</strong>. We are waiting for blockchain confirmation.</p>

  <table class="info-table">
    <tr><td>Invoice</td><td>${data.invoiceNumber}</td></tr>
    <tr><td>Amount</td><td>$${data.amountUsd} USD</td></tr>
    <tr><td>Coin</td><td><span class="coin-badge">${data.coin.toUpperCase()}</span></td></tr>
    <tr><td>Expected</td><td>${data.cryptoAmount} ${data.coin.toUpperCase()}</td></tr>
    <tr><td>Status</td><td><span class="status-badge status-pending">Awaiting Confirmation</span></td></tr>
  </table>

  <div class="alert-box alert-info">
    <p>⏳ Blockchain confirmation usually takes 1–30 minutes depending on network congestion. You'll receive another email once confirmed.</p>
  </div>
`,
    `Payment detected for invoice ${data.invoiceNumber} — awaiting confirmation`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const invoiceExpiredTemplate = (data: {
  firstName: string;
  invoiceNumber: string;
  amountUsd: number;
}) =>
  baseTemplate(
    `
  <h1>Payment Window Expired ⏰</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>The payment window for invoice <strong>${data.invoiceNumber}</strong> ($${data.amountUsd}) has expired.</p>

  <div class="alert-box alert-warning">
    <p>⚠️ No payment was received within the 10-minute window. If your client already sent the payment, please contact support with the transaction hash.</p>
  </div>

  <div style="text-align:center;margin-top:24px;">
    <a href="${process.env.FRONTEND_URL}/invoices" class="btn">Create New Invoice →</a>
  </div>
`,
    `Payment window expired for invoice ${data.invoiceNumber}`,
  );
