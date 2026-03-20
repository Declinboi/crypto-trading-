import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemWalletController } from './system-wallet.controller';
import { SystemWalletService } from './system-wallet.service';
import { SystemWallet } from '../entities/system-wallet.entity';
import { SystemWalletTransaction } from '../entities/system-wallet-transaction.entity';
import { ExchangeRate } from '../entities/exchange-rate.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SystemWallet,
      SystemWalletTransaction,
      ExchangeRate,
      AuditLog,
      Notification,
      User,
    ]),
  ],
  controllers: [SystemWalletController],
  providers: [SystemWalletService],
  exports: [SystemWalletService],
})
export class SystemWalletModule {}