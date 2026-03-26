import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger, Injectable } from '@nestjs/common';
import type { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Notification } from '../../entities/notification.entity';
import {
  QUEUE_NOTIFICATION,
  JOB_SEND_EMAIL,
  JOB_SEND_IN_APP,
} from '../queue.constants';
import { EmailService } from 'src/email/email.service';
import { User } from 'src/entities';

export interface SendEmailJobData {
  userId: string;
  email: string;
  subject: string;
  body: string;
  data?: Record<string, any>;
}

export interface SendInAppJobData {
  notificationId: string;
}

@Injectable()
@Processor(QUEUE_NOTIFICATION)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private emailService: EmailService,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  // ── IN-APP ────────────────────────────────────────────────────────────────────
  @Process(JOB_SEND_IN_APP)
  async handleSendInApp(job: Job<SendInAppJobData>) {
    const { notificationId } = job.data;

    await this.notifRepo.update(notificationId, {
      sentAt: new Date(),
      sent: true,
    });

    this.logger.debug(`In-app notification delivered: ${notificationId}`);
  }

  // ── EMAIL ─────────────────────────────────────────────────────────────────────
  @Process(JOB_SEND_EMAIL)
  async handleSendEmail(job: Job<SendEmailJobData>) {
    const { userId, email, data = {} } = job.data;

    // Load user for first name
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['firstName', 'email'],
    });

    const firstName = user?.firstName ?? 'there';
    const toEmail = email ?? user?.email;

    if (!toEmail) {
      this.logger.warn(`No email address for userId=${userId}`);
      return;
    }

    const type = data.type;

    if (!type) {
      this.logger.warn('No notification type provided');
      return;
    }

    switch (type) {
      case 'email_verification':
        await this.emailService.sendEmailVerification(toEmail, {
          firstName,
          otp: data.otp,
        });
        break;
      case 'two_fa_otp':
        await this.emailService.sendTwoFAOtp(toEmail, {
          firstName,
          otp: data.otp,
          ipAddress: data.ipAddress,
        });
        break;
      case 'password_reset':
        await this.emailService.sendPasswordReset(toEmail, {
          firstName,
          resetLink: data.resetLink,
        });
        break;
      case 'pin_reset':
        await this.emailService.sendPinReset(toEmail, {
          firstName,
          otp: data.otp,
        });
        break;
      case 'welcome':
        await this.emailService.sendWelcome(toEmail, {
          firstName,
          email: toEmail,
          walletTag: data.walletTag,
        });
        break;
      case 'payment_received':
        await this.emailService.sendPaymentReceived(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'payment_waiting':
        await this.emailService.sendPaymentWaiting(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'invoice_expired':
        await this.emailService.sendInvoiceExpired(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'payout_success':
        await this.emailService.sendPayoutSuccess(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'payout_failed':
        await this.emailService.sendPayoutFailed(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'payout_reversed':
        await this.emailService.sendPayoutReversed(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'wallet_credited':
        await this.emailService.sendWalletCredited(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'transfer_sent':
        await this.emailService.sendTransferSent(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'transfer_received':
        await this.emailService.sendTransferReceived(toEmail, {
          firstName,
          ...(data as any),
        });
        break;
      case 'kyc_submitted':
        await this.emailService.sendKycSubmitted(toEmail, { firstName });
        break;
      case 'kyc_approved':
        await this.emailService.sendKycApproved(toEmail, { firstName });
        break;
      case 'kyc_rejected':
        await this.emailService.sendKycRejected(toEmail, {
          firstName,
          reason: data.reason,
        });
        break;
      default:
        this.logger.warn(`No email template for type: ${type}`);
    }

    // Mark notification as sent
    if (data?.notificationId) {
      await this.notifRepo.update(data.notificationId, {
        sentAt: new Date(),
        sent: true,
      });
    }
  }

  // ── ERROR HANDLER ─────────────────────────────────────────────────────────────
  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Notification job failed: ${job.name} error=${err.message}`,
    );
  }
}
