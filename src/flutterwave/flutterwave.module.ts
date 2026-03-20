import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FlutterwaveController } from './flutterwave.controller';
import { FlutterwaveService } from './flutterwave.service';
import { Payout } from '../entities/payout.entity';
import { Transaction } from '../entities/transaction.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { Invoice } from '../entities/invoice.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';
import { SystemWalletModule } from '../system-wallet/system-wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payout,
      Transaction,
      BankAccount,
      Invoice,
      WebhookEvent,
      Notification,
      AuditLog,
      User,
    ]),
    SystemWalletModule,
  ],
  controllers: [FlutterwaveController],
  providers: [FlutterwaveService],
  exports: [FlutterwaveService],
})
export class FlutterwaveModule {}