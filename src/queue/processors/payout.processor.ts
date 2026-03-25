import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger, Injectable } from '@nestjs/common';
import type { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FlutterwaveService } from '../../flutterwave/flutterwave.service';
import { KafkaService } from '../../kafka/kafka.service';
import { Payout } from '../../entities/payout.entity';
import { PayoutStatus } from '../../entities/enums';
import {
  QUEUE_PAYOUT,
  JOB_INITIATE_PAYOUT,
  JOB_RETRY_PAYOUT,
  JOB_RETRY_FAILED_PAYOUTS,
  JOB_SYNC_FLUTTERWAVE_BALANCE,
} from '../queue.constants';
import { KafkaTopic } from '../../kafka/kafka.constants';

export interface InitiatePayoutJobData {
  userId: string;
  amountNgn: number;
  bankAccountId: string;
  narration: string;
  reference: string;
  invoiceId?: string;
  isAutoCashout: boolean;
}

export interface RetryPayoutJobData {
  payoutId: string;
  userId: string;
  reason: string;
}

@Injectable()
@Processor(QUEUE_PAYOUT)
export class PayoutProcessor {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(
    private flutterwaveService: FlutterwaveService,
    private kafkaService: KafkaService,

    @InjectRepository(Payout)
    private payoutRepo: Repository<Payout>,
  ) {}

  // ── INITIATE PAYOUT JOB ───────────────────────────────────────────────────────
  @Process(JOB_INITIATE_PAYOUT)
  async handleInitiatePayout(job: Job<InitiatePayoutJobData>) {
    const {
      userId,
      amountNgn,
      bankAccountId,
      narration,
      reference,
      isAutoCashout,
      
    } = job.data;

    this.logger.log(
      `Initiating payout job: userId=${userId} amount=₦${amountNgn} ` +
        `autoCashout=${isAutoCashout} attempt=${job.attemptsMade + 1}`,
    );

    try {
      const payout = await this.flutterwaveService.initiateDirectPayout({
        userId,
        amountNgn,
        bankAccountId,
        narration,
        reference,
      });

      await this.kafkaService.publish(KafkaTopic.PAYOUT_INITIATED, {
        payoutId: payout.id,
        userId,
        amountNgn,
        netAmountNgn: payout.netAmountNgn,
        isAutoCashout,
        reference,
        initiatedAt: new Date().toISOString(),
      });

      this.logger.log(`Payout job completed: payoutId=${payout.id}`);
      return { payoutId: payout.id };
    } catch (err) {
      this.logger.error(
        `Payout job failed: ${err.message} attempt=${job.attemptsMade + 1}`,
      );

      await this.kafkaService.publish(KafkaTopic.PAYOUT_FAILED, {
        userId,
        amountNgn,
        reference,
        reason: err.message,
        attempt: job.attemptsMade + 1,
        failedAt: new Date().toISOString(),
      });

      throw err; // BullMQ retries
    }
  }

  // ── RETRY SINGLE PAYOUT JOB ───────────────────────────────────────────────────
  @Process(JOB_RETRY_PAYOUT)
  async handleRetryPayout(job: Job<RetryPayoutJobData>) {
    const { payoutId, userId } = job.data;

    this.logger.log(`Retrying payout: payoutId=${payoutId}`);

    const payout = await this.flutterwaveService.retryPayout(payoutId, userId);

    await this.kafkaService.publish(KafkaTopic.PAYOUT_RETRIED, {
      payoutId,
      userId,
      retryCount: payout.retryCount,
      retriedAt: new Date().toISOString(),
    });

    return { payoutId, status: payout.status };
  }

  // ── BULK RETRY FAILED PAYOUTS (scheduled) ─────────────────────────────────────
  @Process(JOB_RETRY_FAILED_PAYOUTS)
  async handleRetryFailedPayouts(job: Job) {
    this.logger.log('Running scheduled retry for failed payouts');

    const failedPayouts = await this.payoutRepo.find({
      where: { status: PayoutStatus.FAILED },
      order: { createdAt: 'ASC' },
      take: 20,
    });

    let retried = 0;
    let skipped = 0;

    for (const payout of failedPayouts) {
      const isLiquidityFailure =
        payout.failureReason?.toLowerCase().includes('insufficient') ||
        payout.failureReason?.toLowerCase().includes('monnify wallet');

      if (!isLiquidityFailure || payout.retryCount >= 3) {
        skipped++;
        continue;
      }

      try {
        await this.flutterwaveService.retryPayout(payout.id, payout.userId);
        retried++;
        this.logger.log(`Auto-retried payout ${payout.id}`);
      } catch (err) {
        this.logger.error(`Auto-retry failed for ${payout.id}: ${err.message}`);
      }
    }

    this.logger.log(
      `Bulk retry complete: retried=${retried} skipped=${skipped}`,
    );
    return { retried, skipped };
  }

  // ── SYNC MONNIFY BALANCE (scheduled) ──────────────────────────────────────────
  @Process(JOB_SYNC_FLUTTERWAVE_BALANCE)
  async handleSyncFlutterwaveBalance(job: Job) {
    this.logger.log('Syncing flutterwave wallet balance');
    const payout = await this.flutterwaveService.getPayoutStats();
    this.logger.log(`Flutterwave sync complete: ${JSON.stringify(payout.today)}`);
    return payout;
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Payout job failed: ${job.name} id=${job.id} ` +
        `attempts=${job.attemptsMade} error=${err.message}`,
    );
  }
}
