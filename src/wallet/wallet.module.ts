import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { User } from '../entities/user.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { Transaction } from '../entities/transaction.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { UserWallet } from 'src/entities/user-wallet.entity';
import { WalletTransaction } from 'src/entities/wallet-transaction.entity';

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
    FlutterwaveModule,
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
