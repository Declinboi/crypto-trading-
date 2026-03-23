import { Processor, Process } from '@nestjs/bull';
import { Logger, Injectable } from '@nestjs/common';
import type { Job } from 'bull';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import type { Cache } from 'cache-manager';

import { NowpaymentsService } from '../../nowpayments/nowpayments.service';
import { KafkaService } from '../../kafka/kafka.service';
import {
  QUEUE_RATE_FETCH,
  JOB_FETCH_RATES,
  JOB_EXPIRE_RATE_LOCKS,
} from '../queue.constants';
import { KafkaTopic } from '../../kafka/kafka.constants';
import { CACHE_KEYS, CACHE_TTL } from '../../cache/cache.constants';

@Injectable()
@Processor(QUEUE_RATE_FETCH)
export class RateProcessor {
  private readonly logger = new Logger(RateProcessor.name);

  constructor(
    private nowpaymentsService: NowpaymentsService,
    private kafkaService: KafkaService,

    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  @Process(JOB_FETCH_RATES)
  async handleFetchRates(job: Job) {
    this.logger.log('Fetching live exchange rates');

    try {
      const rates = await this.nowpaymentsService.fetchLiveRates();

      // Cache all rates
      for (const rate of rates) {
        await this.cacheManager.set(
          `${CACHE_KEYS.EXCHANGE_RATE}:${rate.coin}`,
          rate,
          CACHE_TTL.EXCHANGE_RATE,
        );
      }

      // Cache all rates as a single object too
      const allRates = await this.nowpaymentsService.getAllLatestRates();
      await this.cacheManager.set(
        CACHE_KEYS.ALL_EXCHANGE_RATES,
        allRates,
        CACHE_TTL.EXCHANGE_RATE,
      );

      await this.kafkaService.publish(KafkaTopic.RATES_UPDATED, {
        coinsUpdated: rates.length,
        updatedAt: new Date().toISOString(),
        rates: allRates,
      });

      this.logger.log(`Rates updated for ${rates.length} coins and cached`);
      return { updated: rates.length };
    } catch (err) {
      this.logger.error(`Rate fetch failed: ${err.message}`);
      throw err;
    }
  }

  @Process(JOB_EXPIRE_RATE_LOCKS)
  async handleExpireRateLocks(job: Job) {
    this.logger.log('Expiring stale rate locks');
    await this.nowpaymentsService.expireRateLocks();
    this.logger.log('Rate lock expiry complete');
  }
}
