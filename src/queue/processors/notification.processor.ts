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
    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,
  ) {}

  @Process(JOB_SEND_EMAIL)
  async handleSendEmail(job: Job<SendEmailJobData>) {
    const { userId, email, subject, body } = job.data;
    this.logger.log(`Sending email to ${email} subject="${subject}"`);

    // TODO: integrate your email provider (SendGrid, Mailgun, etc.)
    // For now just log — replace with actual email service
    this.logger.log(`[EMAIL] To: ${email} | Subject: ${subject}`);

    // Mark notification as sent
    if (job.data.data?.notificationId) {
      await this.notifRepo.update(job.data.data.notificationId, {
        sentAt: new Date(),
        sent: true,
      });
    }
  }

  @Process(JOB_SEND_IN_APP)
  async handleSendInApp(job: Job<SendInAppJobData>) {
    const { notificationId } = job.data;
    await this.notifRepo.update(notificationId, {
      sentAt: new Date(),
      sent: true,
    });
    this.logger.debug(`In-app notification delivered: ${notificationId}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Notification job failed: ${job.name} error=${err.message}`,
    );
  }
}
