import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import {
  QUEUE_RATE_FETCH,
  QUEUE_PAYOUT,
  QUEUE_INVOICE_EXPIRE,
  JOB_FETCH_RATES,
  JOB_EXPIRE_RATE_LOCKS,
  JOB_EXPIRE_INVOICES,
  JOB_RETRY_FAILED_PAYOUTS,
  JOB_SYNC_MONNIFY_BALANCE,
} from '../queue.constants';

@Injectable()
export class QueueScheduler implements OnModuleInit {
  private readonly logger = new Logger(QueueScheduler.name);

  constructor(
    @InjectQueue(QUEUE_RATE_FETCH)
    private rateQueue: Queue,

    @InjectQueue(QUEUE_PAYOUT)
    private payoutQueue: Queue,

    @InjectQueue(QUEUE_INVOICE_EXPIRE)
    private invoiceExpireQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.setupRecurringJobs();
  }

  private async setupRecurringJobs() {
    // ── Nuclear option: remove ALL repeatables from each queue ────────────────
    await this.removeAllRepeatables(this.rateQueue);
    await this.removeAllRepeatables(this.payoutQueue);
    await this.removeAllRepeatables(this.invoiceExpireQueue);

    // ── Re-register fresh ─────────────────────────────────────────────────────
    await this.rateQueue.add(
      JOB_FETCH_RATES,
      {},
      {
        repeat: { cron: '*/1 * * * *' },
        jobId: 'recurring-rate-fetch',
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    await this.rateQueue.add(
      JOB_EXPIRE_RATE_LOCKS,
      {},
      {
        repeat: { cron: '*/2 * * * *' },
        jobId: 'recurring-rate-lock-expire',
        removeOnComplete: true,
      },
    );

    await this.invoiceExpireQueue.add(
      JOB_EXPIRE_INVOICES,
      {},
      {
        repeat: { cron: '*/5 * * * *' },
        jobId: 'recurring-invoice-expire',
        removeOnComplete: true,
      },
    );

    await this.payoutQueue.add(
      JOB_RETRY_FAILED_PAYOUTS,
      {},
      {
        repeat: { cron: '*/10 * * * *' },
        jobId: 'recurring-retry-failed-payouts',
        removeOnComplete: true,
      },
    );

    await this.payoutQueue.add(
      JOB_SYNC_MONNIFY_BALANCE,
      {},
      {
        repeat: { cron: '*/30 * * * *' },
        jobId: 'recurring-monnify-sync',
        removeOnComplete: true,
      },
    );

    this.logger.log('All recurring queue jobs scheduled');
  }

  private async removeAllRepeatables(queue: Queue) {
    const repeatableJobs = await queue.getRepeatableJobs();
    await Promise.all(
      repeatableJobs.map((job) => queue.removeRepeatableByKey(job.key)),
    );
    if (repeatableJobs.length > 0) {
      this.logger.log(
        `Cleared ${repeatableJobs.length} stale repeatable(s) from queue: ${queue.name}`,
      );
    }
  }
}
