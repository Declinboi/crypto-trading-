import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonnifyController } from './monnify.controller';
import { MonnifyService } from './monnify.service';
import { Payout } from '../entities/payout.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';
import { SystemWallet } from '../entities/system-wallet.entity';
import { SystemWalletModule } from '../system-wallet/system-wallet.module';
import { SystemWalletTransaction } from 'src/entities/system-wallet-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payout,
      BankAccount,
      WebhookEvent,
      Notification,
      AuditLog,
      User,
      SystemWallet,
      SystemWalletTransaction,
    ]),
    SystemWalletModule,
  ],
  controllers: [MonnifyController],
  providers: [MonnifyService],
  exports: [MonnifyService],
})
export class MonnifyModule {}
