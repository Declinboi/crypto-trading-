export const baseTemplate = (content: string, previewText: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>CryptoPay NG</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    .wrapper { width: 100%; background-color: #f4f4f5; padding: 40px 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px 40px; text-align: center; }
    .header-logo { font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; }
    .header-logo span { color: #f59e0b; }
    .header-tagline { font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px; }
    .body { padding: 40px; }
    .footer { background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer p { font-size: 12px; color: #9ca3af; line-height: 1.6; }
    .footer a { color: #6b7280; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    p { font-size: 15px; color: #4b5563; line-height: 1.7; margin-bottom: 16px; }
    .greeting { font-size: 16px; color: #111827; font-weight: 500; margin-bottom: 24px; }
    .btn { display: inline-block; background-color: #f59e0b; color: #1a1a2e !important; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; margin: 8px 0 24px; }
    .btn-outline { display: inline-block; background-color: transparent; color: #374151 !important; font-size: 14px; font-weight: 500; text-decoration: none; padding: 12px 28px; border-radius: 8px; border: 1.5px solid #d1d5db; margin: 8px 0 24px; }
    .divider { height: 1px; background-color: #e5e7eb; margin: 28px 0; }
    .amount-box { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 10px; padding: 24px; text-align: center; margin: 24px 0; }
    .amount-box .label { font-size: 13px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }
    .amount-box .value { font-size: 32px; font-weight: 700; color: #f59e0b; }
    .amount-box .sub { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 6px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .info-table tr { border-bottom: 1px solid #f3f4f6; }
    .info-table tr:last-child { border-bottom: none; }
    .info-table td { padding: 12px 0; font-size: 14px; }
    .info-table td:first-child { color: #6b7280; width: 45%; }
    .info-table td:last-child { color: #111827; font-weight: 500; text-align: right; }
    .alert-box { border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
    .alert-success { background-color: #ecfdf5; border-left: 4px solid #10b981; }
    .alert-warning { background-color: #fffbeb; border-left: 4px solid #f59e0b; }
    .alert-danger  { background-color: #fef2f2; border-left: 4px solid #ef4444; }
    .alert-info    { background-color: #eff6ff; border-left: 4px solid #3b82f6; }
    .alert-box p   { margin: 0; font-size: 14px; }
    .alert-success p { color: #065f46; }
    .alert-warning p { color: #92400e; }
    .alert-danger  p { color: #991b1b; }
    .alert-info    p { color: #1e40af; }
    .otp-box { background-color: #f9fafb; border: 2px dashed #e5e7eb; border-radius: 10px; padding: 24px; text-align: center; margin: 24px 0; }
    .otp-code { font-size: 40px; font-weight: 700; color: #111827; letter-spacing: 12px; font-family: 'Courier New', monospace; }
    .otp-expiry { font-size: 13px; color: #9ca3af; margin-top: 8px; }
    .tag-box { background-color: #f9fafb; border-radius: 8px; padding: 16px 20px; margin: 16px 0; text-align: center; }
    .tag-box .tag { font-size: 24px; font-weight: 700; color: #1a1a2e; letter-spacing: 2px; font-family: 'Courier New', monospace; }
    .steps { margin: 20px 0; }
    .step { display: flex; align-items: flex-start; margin-bottom: 16px; }
    .step-num { background-color: #f59e0b; color: #1a1a2e; width: 24px; height: 24px; border-radius: 50%; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 12px; margin-top: 2px; }
    .step-text { font-size: 14px; color: #4b5563; line-height: 1.5; }
    .coin-badge { display: inline-block; background-color: #fef3c7; color: #92400e; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; }
    .status-badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; }
    .status-success { background-color: #ecfdf5; color: #065f46; }
    .status-pending { background-color: #fffbeb; color: #92400e; }
    .status-failed  { background-color: #fef2f2; color: #991b1b; }
  </style>
</head>
<body>
  <span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="header-logo">Crypto<span>Pay</span> NG</div>
        <div class="header-tagline">Receive crypto, get paid in Naira</div>
      </div>
      <div class="body">
        ${content}
      </div>
      <div class="footer">
        <p>
          © ${new Date().getFullYear()} CryptoPay NG. All rights reserved.<br/>
          <a href="#">Privacy Policy</a> · <a href="#">Terms of Service</a> · <a href="#">Support</a>
        </p>
        <p style="margin-top: 12px;">
          You received this email because you have an account on CryptoPay NG.<br/>
          If you didn't request this, please <a href="#">contact support</a>.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`;
