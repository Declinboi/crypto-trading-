import {
  Processor,
  Process,
  OnQueueActive,
  OnQueueCompleted,
  OnQueueFailed,
  OnQueueStalled,
} from '@nestjs/bull';
import { Logger, Injectable } from '@nestjs/common';
import type { Job } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';

import { NowpaymentsService } from '../../nowpayments/nowpayments.service';
import { QuidaxService } from '../../quidax/quidax.service';
import { KafkaService } from '../../kafka/kafka.service';
import {
  QUEUE_PAYMENT,
  QUEUE_PAYOUT,
  JOB_PROCESS_PAYMENT,
  JOB_VERIFY_DEPOSIT,
  JOB_INITIATE_PAYOUT,
} from '../queue.constants';
import { KafkaTopic } from '../../kafka/kafka.constants';
import { CoinType } from '../../entities/enums';
import { Invoice } from 'src/entities/invoice.entity';
import { Repository } from 'typeorm/repository/Repository.js';
import { Transaction } from 'src/entities';

export interface ProcessPaymentJobData {
  paymentId: string;
  invoiceId: string;
  userId: string;
  coin: CoinType;
  txHash: string | null;
  cryptoAmountReceived: number;
  paymentStatus: string;
  rawWebhookPayload: any;
}

export interface VerifyDepositJobData {
  txHash: string;
  coin: CoinType;
  expectedAmount: number;
  invoiceId: string;
  transactionId: string;
  nowpaymentsPaymentId: string;
  retryCount: number;
}

@Injectable()
@Processor(QUEUE_PAYMENT)
export class PaymentProcessor {
  private readonly logger = new Logger(PaymentProcessor.name);

  constructor(
    private nowpaymentsService: NowpaymentsService,
    private quidaxService: QuidaxService,
    private kafkaService: KafkaService,

    @InjectQueue(QUEUE_PAYOUT)
    private payoutQueue: Queue,

    @InjectQueue(QUEUE_PAYMENT) // ← add this
    private paymentQueue: Queue,
  ) {}

  // ── PROCESS PAYMENT JOB ───────────────────────────────────────────────────────
  @Process(JOB_PROCESS_PAYMENT)
  async handleProcessPayment(job: Job<ProcessPaymentJobData>) {
    const {
      paymentId,
      invoiceId,
      userId,
      coin,
      txHash,
      cryptoAmountReceived,
      rawWebhookPayload,
    } = job.data;

    this.logger.log(
      `Processing payment job: paymentId=${paymentId} invoiceId=${invoiceId} attempt=${job.attemptsMade + 1}`,
    );

    try {
      // Publish to Kafka for audit/event streaming
      await this.kafkaService.publish(KafkaTopic.PAYMENT_RECEIVED, {
        paymentId,
        invoiceId,
        userId,
        coin,
        txHash,
        cryptoAmountReceived,
        processedAt: new Date().toISOString(),
        attempt: job.attemptsMade + 1,
      });

      // ── Step 1: Quidax verification (anti-flash protection) ──────────────────
      if (txHash) {
        const verification = await this.quidaxService.runFullVerification(
          txHash,
          coin,
          cryptoAmountReceived,
          paymentId,
        );

        if (!verification.passed) {
          if (verification.result.isFlash) {
            // Flash deposit — publish alert, do NOT retry
            this.logger.error(`FLASH DEPOSIT BLOCKED: txHash=${txHash}`);
            await this.kafkaService.publish(KafkaTopic.PAYMENT_FLASH_DETECTED, {
              txHash,
              coin,
              invoiceId,
              reason: verification.result.reason,
              detectedAt: new Date().toISOString(),
            });
            return; // ← don't throw, don't retry flash deposits
          }

          // Not enough confirmations yet — throw so BullMQ retries
          throw new Error(
            `Verification not passed yet: ${verification.result.reason}`,
          );
        }

        this.logger.log(
          `Quidax verification PASSED: txHash=${txHash} confirmations=${verification.result.confirmations}`,
        );

        await this.kafkaService.publish(KafkaTopic.PAYMENT_VERIFIED, {
          txHash,
          coin,
          invoiceId,
          confirmations: verification.result.confirmations,
          verifiedAt: new Date().toISOString(),
        });
      } else {
        this.logger.warn(
          `No txHash for paymentId=${paymentId} — skipping Quidax check, trusting NowPayments`,
        );
      }

      // ── Step 2: Load invoice and transaction from DB ──────────────────────────
      // const { Invoice } = await import('../../entities/invoice.entity');
      // const { Transaction } = await import('../../entities/transaction.entity');

      const invoiceRepo = this.nowpaymentsService[
        'invoiceRepo'
      ] as Repository<Invoice>;
      const txRepo = this.nowpaymentsService[
        'txRepo'
      ] as Repository<Transaction>;

      const invoice = await invoiceRepo.findOne({ where: { id: invoiceId } });
      const transaction = await txRepo.findOne({
        where: { nowpaymentsPaymentId: paymentId },
      });

      if (!invoice || !transaction) {
        throw new Error(
          `Invoice or transaction not found: invoiceId=${invoiceId} paymentId=${paymentId}`,
        );
      }

      // ── Step 3: Run the full payment confirmation logic ───────────────────────
      await this.nowpaymentsService.onPaymentConfirmed(
        invoice,
        transaction,
        rawWebhookPayload,
      );

      await this.kafkaService.publish(KafkaTopic.PAYMENT_CONFIRMED, {
        paymentId,
        invoiceId,
        userId,
        coin,
        confirmedAt: new Date().toISOString(),
      });

      this.logger.log(`Payment job completed: paymentId=${paymentId}`);
    } catch (err) {
      this.logger.error(
        `Payment job failed: ${err.message} attempt=${job.attemptsMade + 1}`,
      );
      throw err; // BullMQ retries
    }
  }

  // ── VERIFY DEPOSIT JOB ────────────────────────────────────────────────────────
  @Process(JOB_VERIFY_DEPOSIT)
  async handleVerifyDeposit(job: Job<VerifyDepositJobData>) {
    const {
      txHash,
      coin,
      expectedAmount,
      invoiceId,
      transactionId,
      nowpaymentsPaymentId,
    } = job.data;

    this.logger.log(
      `Verifying deposit: txHash=${txHash} coin=${coin} attempt=${job.attemptsMade + 1}`,
    );

    const result = await this.quidaxService.runFullVerification(
      txHash,
      coin,
      expectedAmount,
      nowpaymentsPaymentId,
    );

    if (!result.passed) {
      // If not enough confirmations yet — retry
      if (
        result.result.confirmations < result.result.requiredConfirmations &&
        !result.result.isFlash
      ) {
        this.logger.log(
          `Not enough confirmations yet (${result.result.confirmations}/${result.result.requiredConfirmations}) — will retry`,
        );
        throw new Error(
          `Waiting for confirmations: ${result.result.confirmations}/${result.result.requiredConfirmations}`,
        );
      }

      // Flash deposit — don't retry
      if (result.result.isFlash) {
        this.logger.error(`FLASH DEPOSIT BLOCKED: txHash=${txHash}`);
        await this.kafkaService.publish(KafkaTopic.PAYMENT_FLASH_DETECTED, {
          txHash,
          coin,
          invoiceId,
          transactionId,
          reason: result.result.reason,
          detectedAt: new Date().toISOString(),
        });
        return; // don't throw — we don't want to retry flash deposits
      }

      throw new Error(`Verification failed: ${result.result.reason}`);
    }

    // Verification passed — publish confirmed event
    await this.kafkaService.publish(KafkaTopic.PAYMENT_VERIFIED, {
      txHash,
      coin,
      invoiceId,
      transactionId,
      confirmations: result.result.confirmations,
      verifiedAt: new Date().toISOString(),
    });

    this.logger.log(`Deposit verified and confirmed: txHash=${txHash}`);
  }

  // ── QUEUE LIFECYCLE HOOKS ─────────────────────────────────────────────────────
  @OnQueueActive()
  onActive(job: Job) {
    this.logger.debug(`Job active: ${job.name} id=${job.id}`);
  }

  @OnQueueCompleted()
  onComplete(job: Job) {
    this.logger.debug(`Job completed: ${job.name} id=${job.id}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(
      `Job failed: ${job.name} id=${job.id} attempts=${job.attemptsMade} error=${err.message}`,
    );
  }

  @OnQueueStalled()
  onStalled(job: Job) {
    this.logger.warn(`Job stalled: ${job.name} id=${job.id} — will be retried`);
  }
}
