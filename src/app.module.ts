import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './entities/database.module';
import { AuthModule } from './auth/auth.module';
import { KycModule } from './kyc/kyc.module';
import { SystemWalletModule } from './system-wallet/system-wallet.module';
import { NowpaymentsModule } from './nowpayments/nowpayments.module';

import { WalletModule } from './wallet/wallet.module';
import { InvoiceModule } from './invoice/invoice.module';
import { RedisModule } from './redis/redis.module';
import { AppCacheModule } from './cache/cache.module';
import { KafkaModule } from './kafka/kafka.module';
import { QueueModule } from './queue/queue.module';
import { FlutterwaveModule } from './flutterwave/flutterwave.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    RedisModule, // ← add
    AppCacheModule, // ← add
    KafkaModule, // ← add
    QueueModule,
    DatabaseModule,
    AuthModule,
    KycModule,
    SystemWalletModule,
    NowpaymentsModule,
    FlutterwaveModule,
    WalletModule,
    InvoiceModule,
    EmailModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
