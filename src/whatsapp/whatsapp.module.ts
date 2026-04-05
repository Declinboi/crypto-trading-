import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappBotService } from './whatsapp-bot.service';
import { GupshupService } from './gupshup.service';
import { WhatsappSessionService } from './whatsapp-session.service';
import { WhatsappOtpService } from './whatsapp-otp.service';

import { User } from '../entities/user.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { Notification } from '../entities/notification.entity';

import { WalletModule } from '../wallet/wallet.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { EmailModule } from '../email/email.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, BankAccount, Notification]),
    WalletModule,
    InvoiceModule,
    EmailModule,
    RedisModule,
  ],
  controllers: [WhatsappController],
  providers: [
    GupshupService,
    WhatsappBotService,
    WhatsappSessionService,
    WhatsappOtpService,
  ],
  exports: [GupshupService, WhatsappOtpService, WhatsappBotService],
})
export class WhatsappModule {}
