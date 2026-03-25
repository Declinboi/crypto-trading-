import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentProcessor } from './processors/payment.processor';
import { PayoutProcessor } from './processors/payout.processor';
import { RateProcessor } from './processors/rate.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { QueueScheduler } from './schedulers/queue.scheduler';

import { NowpaymentsModule } from '../nowpayments/nowpayments.module';
import { QuidaxModule } from '../quidax/quidax.module';
import { KafkaModule } from '../kafka/kafka.module';

import { Payout } from '../entities/payout.entity';
import { Notification } from '../entities/notification.entity';

import {
  QUEUE_PAYMENT,
  QUEUE_PAYOUT,
  QUEUE_RATE_FETCH,
  QUEUE_NOTIFICATION,
  QUEUE_VERIFICATION,
  QUEUE_INVOICE_EXPIRE,
} from './queue.constants';
import { FlutterwaveModule } from 'src/flutterwave/flutterwave.module';

const queues = [
  QUEUE_PAYMENT,
  QUEUE_PAYOUT,
  QUEUE_RATE_FETCH,
  QUEUE_NOTIFICATION,
  QUEUE_VERIFICATION,
  QUEUE_INVOICE_EXPIRE,
];

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
          password: config.get<string>('REDIS_PASSWORD') ?? undefined,
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 200,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
      inject: [ConfigService],
    }),
    ...queues.map((name) => BullModule.registerQueue({ name })),
    TypeOrmModule.forFeature([Payout, Notification]),
    NowpaymentsModule,
    FlutterwaveModule,
    QuidaxModule,
    KafkaModule,
  ],
  providers: [
    PaymentProcessor,
    PayoutProcessor,
    RateProcessor,
    NotificationProcessor,
    QueueScheduler,
  ],
  exports: [
    BullModule,
    ...queues.map((name) => BullModule.registerQueue({ name })),
  ],
})
export class QueueModule {}
