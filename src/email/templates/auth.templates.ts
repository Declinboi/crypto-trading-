import { baseTemplate } from './base.template';

export const welcomeTemplate = (data: {
  firstName: string;
  email: string;
  walletTag: string;
}) =>
  baseTemplate(
    `
  <h1>Welcome to CryptoPay NG 🎉</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your account has been created successfully. You can now receive crypto payments from anywhere in the world and get paid directly in Naira.</p>

  <div class="tag-box">
    <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">Your Wallet Tag</div>
    <div class="tag">@${data.walletTag}</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:6px;">Share this tag to receive transfers from other users</div>
  </div>

  <div class="divider"></div>

  <p style="font-size:14px;font-weight:600;color:#111827;margin-bottom:12px;">Get started in 3 steps:</p>
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">Complete your KYC verification to unlock all features</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">Add your Nigerian bank account for payouts</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">Create your first invoice and share with your client</div>
    </div>
  </div>

  <div style="text-align:center;margin-top:32px;">
    <a href="${process.env.FRONTEND_URL}/dashboard" class="btn">Go to Dashboard →</a>
  </div>
`,
    `Welcome to CryptoPay NG, ${data.firstName}! Your account is ready.`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const emailVerificationTemplate = (data: {
  firstName: string;
  otp: string;
}) =>
  baseTemplate(
    `
  <h1>Verify Your Email</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Use the code below to verify your email address. This code expires in <strong>10 minutes</strong>.</p>

  <div class="otp-box">
    <div class="otp-code">${data.otp}</div>
    <div class="otp-expiry">Expires in 10 minutes</div>
  </div>

  <div class="alert-box alert-warning">
    <p>⚠️ Never share this code with anyone. CryptoPay NG staff will never ask for your OTP.</p>
  </div>

  <p style="font-size:13px;color:#9ca3af;">If you didn't create an account, you can safely ignore this email.</p>
`,
    `Your CryptoPay NG verification code: ${data.otp}`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const passwordResetTemplate = (data: {
  firstName: string;
  resetLink: string;
}) =>
  baseTemplate(
    `
  <h1>Reset Your Password</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>We received a request to reset your password. Click the button below to create a new password. This link expires in <strong>1 hour</strong>.</p>

  <div style="text-align:center;margin:32px 0;">
    <a href="${data.resetLink}" class="btn">Reset Password →</a>
  </div>

  <div class="alert-box alert-danger">
    <p>🔒 If you didn't request a password reset, please contact support immediately — your account may be at risk.</p>
  </div>

  <p style="font-size:13px;color:#9ca3af;">This link will expire in 1 hour. If expired, please request a new password reset.</p>
`,
    `Reset your CryptoPay NG password`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const twoFAOtpTemplate = (data: {
  firstName: string;
  otp: string;
  ipAddress?: string;
}) =>
  baseTemplate(
    `
  <h1>Login Verification Code</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your login verification code is:</p>

  <div class="otp-box">
    <div class="otp-code">${data.otp}</div>
    <div class="otp-expiry">Expires in 10 minutes</div>
  </div>

  ${
    data.ipAddress
      ? `
  <table class="info-table">
    <tr><td>IP Address</td><td>${data.ipAddress}</td></tr>
    <tr><td>Time</td><td>${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} WAT</td></tr>
  </table>
  `
      : ''
  }

  <div class="alert-box alert-warning">
    <p>⚠️ If this wasn't you, change your password immediately and contact support.</p>
  </div>
`,
    `Your CryptoPay NG login code: ${data.otp}`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const pinResetTemplate = (data: { firstName: string; otp: string }) =>
  baseTemplate(
    `
  <h1>PIN Reset Request</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Use the code below to reset your transaction PIN:</p>

  <div class="otp-box">
    <div class="otp-code">${data.otp}</div>
    <div class="otp-expiry">Expires in 10 minutes</div>
  </div>

  <div class="alert-box alert-danger">
    <p>🔒 If you didn't request a PIN reset, contact support immediately.</p>
  </div>
`,
    `Your CryptoPay NG PIN reset code: ${data.otp}`,
  );
