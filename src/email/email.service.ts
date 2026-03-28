import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import {
  welcomeTemplate,
  emailVerificationTemplate,
  passwordResetTemplate,
  twoFAOtpTemplate,
  pinResetTemplate,
} from './templates/auth.templates';
import {
  paymentReceivedTemplate,
  paymentWaitingTemplate,
  invoiceExpiredTemplate,
  invoiceCreatedTemplate,
  invoiceCancelledTemplate,
} from './templates/payment.templates';
import {
  payoutSuccessTemplate,
  payoutFailedTemplate,
  payoutReversedTemplate,
} from './templates/payout.templates';
import {
  walletCreditedTemplate,
  transferSentTemplate,
  transferReceivedTemplate,
} from './templates/wallet.templates';
import {
  kycSubmittedTemplate,
  kycApprovedTemplate,
  kycRejectedTemplate,
} from './templates/kyc.templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly replyTo: string;

  constructor(private config: ConfigService) {
    this.resend = new Resend(config.get<string>('RESEND_API_KEY'));
    this.from =
      config.get<string>('RESEND_FROM_EMAIL') ??
      'CryptoPay NG <noreply@cryptopayng.com>';
    this.replyTo =
      config.get<string>('RESEND_REPLY_TO') ?? 'support@cryptopayng.com';
  }

  // ── CORE SEND METHOD ──────────────────────────────────────────────────────────
  private async send(params: {
    to: string | string[];
    subject: string;
    html: string;
  }): Promise<boolean> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        replyTo: this.replyTo,
      });

      if (error) {
        this.logger.error(`Resend error: ${JSON.stringify(error)}`);
        return false;
      }

      this.logger.log(
        `Email sent: id=${data?.id} to=${params.to} subject="${params.subject}"`,
      );
      return true;
    } catch (err) {
      this.logger.error(`Email send failed: ${err.message}`);
      return false;
    }
  }

  // ── AUTH EMAILS ───────────────────────────────────────────────────────────────
  async sendWelcome(to: string, data: { firstName: string; email: string }) {
    return this.send({
      to,
      subject: `Welcome to CryptoPay NG, ${data.firstName}! 🎉`,
      html: welcomeTemplate(data),
    });
  }

  async sendEmailVerification(
    to: string,
    data: { firstName: string; otp: string },
  ) {
    return this.send({
      to,
      subject: `${data.otp} — Your CryptoPay NG Verification Code`,
      html: emailVerificationTemplate(data),
    });
  }

  async sendPasswordReset(
    to: string,
    data: { firstName: string; resetLink: string },
  ) {
    return this.send({
      to,
      subject: 'Reset your CryptoPay NG password',
      html: passwordResetTemplate(data),
    });
  }

  async sendTwoFAOtp(
    to: string,
    data: { firstName: string; otp: string; ipAddress?: string },
  ) {
    return this.send({
      to,
      subject: `${data.otp} — Your CryptoPay NG Login Code`,
      html: twoFAOtpTemplate(data),
    });
  }

  async sendPinReset(to: string, data: { firstName: string; otp: string }) {
    return this.send({
      to,
      subject: 'Your CryptoPay NG PIN Reset Code',
      html: pinResetTemplate(data),
    });
  }

  // ── PAYMENT EMAILS ────────────────────────────────────────────────────────────
  async sendPaymentReceived(
    to: string,
    data: {
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
    },
  ) {
    return this.send({
      to,
      subject: `Payment confirmed: ₦${Number(data.netNgnAmount).toLocaleString('en-NG')} received`,
      html: paymentReceivedTemplate(data),
    });
  }

  async sendPaymentWaiting(
    to: string,
    data: {
      firstName: string;
      invoiceNumber: string;
      cryptoAmount: number;
      coin: string;
      paymentAddress: string;
      amountUsd: number;
      expiresAt: Date;
    },
  ) {
    return this.send({
      to,
      subject: `Payment detected for invoice ${data.invoiceNumber} — awaiting confirmation`,
      html: paymentWaitingTemplate(data),
    });
  }

  async sendInvoiceCreated(
    to: string,
    data: {
      firstName: string;
      invoiceNumber: string;
      amountUsd: number;
      title: string;
      autoCashout: boolean;
      invoiceLink: string;
    },
  ) {
    return this.send({
      to,
      subject: `Invoice ${data.invoiceNumber} created — $${data.amountUsd}`,
      html: invoiceCreatedTemplate(data),
    });
  }

  async sendInvoiceExpired(
    to: string,
    data: {
      firstName: string;
      invoiceNumber: string;
      amountUsd: number;
    },
  ) {
    return this.send({
      to,
      subject: `Invoice ${data.invoiceNumber} has expired`,
      html: invoiceExpiredTemplate(data),
    });
  }

  async sendInvoiceCancelled(
    to: string,
    data: {
      firstName: string;
      invoiceNumber: string;
      amountUsd: number;
    },
  ) {
    return this.send({
      to,
      subject: `Invoice ${data.invoiceNumber} cancelled`,
      html: invoiceCancelledTemplate(data),
    });
  }

  // ── PAYOUT EMAILS ─────────────────────────────────────────────────────────────
  async sendPayoutSuccess(
    to: string,
    data: {
      firstName: string;
      amountNgn: number;
      bankName: string;
      accountLastFour: string;
      reference: string;
      platformFee: number;
      flwFee: number;
    },
  ) {
    return this.send({
      to,
      subject: `₦${Number(data.amountNgn).toLocaleString('en-NG')} sent to your ${data.bankName} account`,
      html: payoutSuccessTemplate(data),
    });
  }

  async sendPayoutFailed(
    to: string,
    data: {
      firstName: string;
      amountNgn: number;
      reason: string;
      payoutId: string;
    },
  ) {
    return this.send({
      to,
      subject: `Payout failed — action required`,
      html: payoutFailedTemplate(data),
    });
  }

  async sendPayoutReversed(
    to: string,
    data: {
      firstName: string;
      amountNgn: number;
      bankName: string;
      reason: string;
    },
  ) {
    return this.send({
      to,
      subject: `Payout reversed — ₦${Number(data.amountNgn).toLocaleString('en-NG')} returned`,
      html: payoutReversedTemplate(data),
    });
  }

  // ── WALLET EMAILS ─────────────────────────────────────────────────────────────
  async sendWalletCredited(
    to: string,
    data: {
      firstName: string;
      amountNgn: number;
      description: string;
      newBalance: number;
    },
  ) {
    return this.send({
      to,
      subject: `₦${Number(data.amountNgn).toLocaleString('en-NG')} added to your wallet`,
      html: walletCreditedTemplate(data),
    });
  }

  async sendTransferSent(
    to: string,
    data: {
      firstName: string;
      amountNgn: number;
      recipientTag: string;
      recipientName: string;
      note?: string;
      newBalance: number;
      reference: string;
    },
  ) {
    return this.send({
      to,
      subject: `Transfer sent: ₦${Number(data.amountNgn).toLocaleString('en-NG')} to @${data.recipientTag}`,
      html: transferSentTemplate(data),
    });
  }

  async sendTransferReceived(
    to: string,
    data: {
      firstName: string;
      amountNgn: number;
      senderTag: string;
      senderName: string;
      note?: string;
      newBalance: number;
    },
  ) {
    return this.send({
      to,
      subject: `You received ₦${Number(data.amountNgn).toLocaleString('en-NG')} from @${data.senderTag}`,
      html: transferReceivedTemplate(data),
    });
  }

  // ── KYC EMAILS ────────────────────────────────────────────────────────────────
  async sendKycSubmitted(to: string, data: { firstName: string }) {
    return this.send({
      to,
      subject: 'KYC documents received — verification in progress',
      html: kycSubmittedTemplate(data),
    });
  }

  async sendKycApproved(to: string, data: { firstName: string }) {
    return this.send({
      to,
      subject: 'KYC approved — your account is fully verified 🎉',
      html: kycApprovedTemplate(data),
    });
  }

  async sendKycRejected(
    to: string,
    data: { firstName: string; reason: string },
  ) {
    return this.send({
      to,
      subject: 'KYC verification failed — please resubmit',
      html: kycRejectedTemplate(data),
    });
  }
}
