import { baseTemplate } from './base.template';

export const kycSubmittedTemplate = (data: { firstName: string }) =>
  baseTemplate(
    `
  <h1>KYC Submitted ✅</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Your KYC documents have been submitted successfully and are currently under review.</p>

  <div class="alert-box alert-info">
    <p>⏳ Verification typically takes 1–24 hours. We'll notify you via email once it's complete.</p>
  </div>

  <div class="steps">
    <div class="step">
      <div class="step-num">✓</div>
      <div class="step-text">Documents submitted</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">Under review by our team</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">Verification complete — full access unlocked</div>
    </div>
  </div>
`,
    `KYC documents submitted — verification in progress`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const kycApprovedTemplate = (data: { firstName: string }) =>
  baseTemplate(
    `
  <h1>KYC Approved 🎉</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Congratulations! Your identity has been verified successfully. You now have full access to all CryptoPay NG features.</p>

  <div class="alert-box alert-success">
    <p>✅ Your account is now fully verified. You can create invoices, receive payments, and withdraw funds without restrictions.</p>
  </div>

  <div style="text-align:center;margin-top:32px;">
    <a href="${process.env.FRONTEND_URL}/dashboard" class="btn">Start Receiving Payments →</a>
  </div>
`,
    `KYC approved — your account is fully verified`,
  );

// ─────────────────────────────────────────────────────────────────────────────

export const kycRejectedTemplate = (data: {
  firstName: string;
  reason: string;
}) =>
  baseTemplate(
    `
  <h1>KYC Verification Failed</h1>
  <p class="greeting">Hi ${data.firstName},</p>
  <p>Unfortunately, we were unable to verify your identity. Your KYC submission has been rejected.</p>

  <div class="alert-box alert-danger">
    <p>❌ Reason: ${data.reason}</p>
  </div>

  <p style="font-size:14px;font-weight:600;color:#111827;margin-bottom:12px;">Common reasons for rejection:</p>
  <div class="steps">
    <div class="step">
      <div class="step-num">•</div>
      <div class="step-text">Document image was blurry or unclear</div>
    </div>
    <div class="step">
      <div class="step-num">•</div>
      <div class="step-text">Document was expired</div>
    </div>
    <div class="step">
      <div class="step-num">•</div>
      <div class="step-text">Information didn't match account details</div>
    </div>
  </div>

  <div style="text-align:center;margin-top:32px;">
    <a href="${process.env.FRONTEND_URL}/kyc" class="btn">Resubmit KYC →</a>
  </div>
`,
    `KYC verification failed — please resubmit`,
  );
