import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { CoinType, RateSource } from './enums';
import { RateLock } from './rate-lock.entity';
import { Transaction } from './transaction.entity';

@Entity('exchange_rates')
@Index(['coin', 'fetchedAt'])
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: CoinType })
  coin: CoinType;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'coin_usd_price' })
  coinUsdPrice: number; // 1 COIN in USD

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'usd_ngn_rate' })
  usdNgnRate: number; // 1 USD in NGN (raw, before spread)

  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'spread_percent', default: 1.5 })
  spreadPercent: number; // platform FX spread e.g. 1.5%

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'effective_usd_ngn' })
  effectiveUsdNgn: number; // usdNgnRate after spread applied

  @Column({ type: 'enum', enum: RateSource, default: RateSource.NOWPAYMENTS })
  source: RateSource;

  @Column({ type: 'timestamptz', name: 'fetched_at', default: () => 'NOW()' })
  fetchedAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => RateLock, (rl) => rl.exchangeRate)
  rateLocks: RateLock[];

  @OneToMany(() => Transaction, (tx) => tx.exchangeRate)
  transactions: Transaction[];
}
