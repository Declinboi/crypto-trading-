import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './entities/database.module';
import { AuthModule } from './auth/auth.module';
import { KycModule } from './kyc/kyc.module';
import { SystemWalletModule } from './system-wallet/system-wallet.module';
import { NowpaymentsModule } from './nowpayments/nowpayments.module';
import { FlutterwaveModule } from './flutterwave/flutterwave.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    DatabaseModule,
    AuthModule,
    KycModule,
    SystemWalletModule,
    NowpaymentsModule,
    FlutterwaveModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
