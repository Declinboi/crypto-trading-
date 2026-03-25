import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { User } from '../entities/user.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { Transaction } from '../entities/transaction.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { UserWallet } from 'src/entities/user-wallet.entity';
import { WalletTransaction } from 'src/entities/wallet-transaction.entity';
import { QUEUE_PAYOUT } from 'src/queue/queue.constants';
import { BullModule } from '@nestjs/bull';
import { FlutterwaveModule } from 'src/flutterwave/flutterwave.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserWallet,
      WalletTransaction,
      User,
      BankAccount,
      Transaction,
      Notification,
      AuditLog,
    ]),
    BullModule.registerQueue({
      name: QUEUE_PAYOUT, // ← this registers BullQueue_payout in this module
    }),
    FlutterwaveModule
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
