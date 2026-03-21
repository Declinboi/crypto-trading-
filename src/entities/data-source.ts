import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { User } from './user.entity';
import { KycRecord } from './kyc-record.entity';
import { BankAccount } from './/bank-account.entity';
import { Invoice } from './/invoice.entity';
import { InvoiceItem } from './/invoice-item.entity';
import { WalletAddress } from './/wallet-address.entity';
import { ExchangeRate } from './/exchange-rate.entity';
import { RateLock } from './/rate-lock.entity';
import { Transaction } from './/transaction.entity';
import { Payout } from './/payout.entity';
import { WebhookEvent } from './/webhook-event.entity';
import { Notification } from './/notification.entity';
import { AuditLog } from './/audit-log.entity';
import { Referral } from './/referral.entity';
import { PlatformSetting } from './/platform-setting.entity';
import { SystemWallet } from './/system-wallet.entity';
import { SystemWalletTransaction } from './/system-wallet-transaction.entity';
import { UserWallet } from './user-wallet.entity';
import { WalletTransaction } from './wallet-transaction.entity';

export const ALL_ENTITIES = [
  User,
  KycRecord,
  BankAccount,
  Invoice,
  InvoiceItem,
  WalletAddress,
  ExchangeRate,
  RateLock,
  Transaction,
  Payout,
  WebhookEvent,
  Notification,
  AuditLog,
  Referral,
  PlatformSetting,
  SystemWallet,
  SystemWalletTransaction,
  UserWallet,
  WalletTransaction,
];

// ── Used by NestJS TypeOrmModule.forRootAsync() ───────────────────────────────
export const getTypeOrmConfig = (config: ConfigService): DataSourceOptions => ({
  type: 'postgres',
  host: config.get<string>('DB_HOST', 'localhost'),
  port: config.get<number>('DB_PORT', 5432),
  username: config.get<string>('DB_USER', 'postgres'),
  password: config.get<string>('DB_PASS', 'postgres'),
  database: config.get<string>('DB_NAME', 'cryptopay'),
  entities: ALL_ENTITIES,
  migrations: ['dist/migrations/*.js'],
  migrationsRun: false,
  synchronize: false, // NEVER true in production
  logging: config.get<string>('NODE_ENV') === 'development',
  ssl:
    config.get<string>('NODE_ENV') === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

// ── Used by TypeORM CLI (pnpm typeorm migration:generate) ─────────────────────
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASS ?? 'postgres',
  database: process.env.DB_NAME ?? 'cryptopay',
  entities: ALL_ENTITIES,
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
