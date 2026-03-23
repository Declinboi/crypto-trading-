import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NowpaymentsController } from './nowpayments.controller';
import { NowpaymentsService } from './nowpayments.service';
import { Invoice } from '../entities/invoice.entity';
import { Transaction } from '../entities/transaction.entity';
import { WalletAddress } from '../entities/wallet-address.entity';
import { ExchangeRate } from '../entities/exchange-rate.entity';
import { RateLock } from '../entities/rate-lock.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { SystemWalletModule } from '../system-wallet/system-wallet.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { MonnifyModule } from 'src/monnify/monnify.module';
import { QuidaxModule } from 'src/quidax/quidax.module';
import { QUEUE_PAYMENT } from 'src/queue/queue.constants';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      Transaction,
      WalletAddress,
      ExchangeRate,
      RateLock,
      WebhookEvent,
      Notification,
      AuditLog,
    ]),

    BullModule.registerQueue({ name: QUEUE_PAYMENT }),
    SystemWalletModule,
    WalletModule,
    MonnifyModule,
    QuidaxModule,
  ],
  controllers: [NowpaymentsController],
  providers: [NowpaymentsService],
  exports: [NowpaymentsService],
})
export class NowpaymentsModule {}
