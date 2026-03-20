import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CoinType } from './enums';
import { Invoice } from './invoice.entity';
import { ExchangeRate } from './exchange-rate.entity';

@Entity('rate_locks')
@Index(['invoiceId'])
@Index(['expiresAt'])
export class RateLock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @OneToOne(() => Invoice, (invoice) => invoice.rateLock)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'uuid', name: 'exchange_rate_id' })
  exchangeRateId: string;

  @ManyToOne(() => ExchangeRate, (er) => er.rateLocks)
  @JoinColumn({ name: 'exchange_rate_id' })
  exchangeRate: ExchangeRate;

  @Column({ type: 'enum', enum: CoinType })
  coin: CoinType;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'locked_usd_ngn_rate' })
  lockedUsdNgnRate: number;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'locked_coin_usd_price' })
  lockedCoinUsdPrice: number;

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'crypto_amount_locked' })
  cryptoAmountLocked: number;

  @Column({ type: 'timestamptz', name: 'locked_at', default: () => 'NOW()' })
  lockedAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date; // lockedAt + 10 minutes

  @Column({ type: 'boolean', name: 'is_expired', default: false })
  isExpired: boolean;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt: Date | null;
}
