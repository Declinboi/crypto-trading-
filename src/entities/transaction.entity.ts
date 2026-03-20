import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TransactionStatus, CoinType, NetworkType } from './enums';
import { Invoice } from './invoice.entity';
import { User } from './user.entity';
import { ExchangeRate } from './exchange-rate.entity';
import { Payout } from './payout.entity';

@Entity('transactions')
@Index(['invoiceId'])
@Index(['userId'])
@Index(['txHash'])
@Index(['nowpaymentsPaymentId'])
@Index(['status'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.transactions)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.transactions)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100, name: 'nowpayments_payment_id', nullable: true })
  nowpaymentsPaymentId: string | null;

  @Column({ type: 'varchar', length: 255, name: 'tx_hash', nullable: true })
  txHash: string | null;

  @Column({ type: 'enum', enum: CoinType })
  coin: CoinType;

  @Column({ type: 'enum', enum: NetworkType })
  network: NetworkType;

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'crypto_amount_expected' })
  cryptoAmountExpected: number;

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'crypto_amount_received', nullable: true })
  cryptoAmountReceived: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'usd_amount' })
  usdAmount: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'ngn_amount', nullable: true })
  ngnAmount: number | null;

  @Column({ type: 'uuid', name: 'exchange_rate_id', nullable: true })
  exchangeRateId: string | null;

  @ManyToOne(() => ExchangeRate, (er) => er.transactions, { nullable: true })
  @JoinColumn({ name: 'exchange_rate_id' })
  exchangeRate: ExchangeRate | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'usd_to_ngn_rate', nullable: true })
  usdToNgnRate: number | null; // snapshot at time of conversion

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'platform_fee_usd', nullable: true })
  platformFeeUsd: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'platform_fee_ngn', nullable: true })
  platformFeeNgn: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'net_ngn_amount', nullable: true })
  netNgnAmount: number | null; // amount after fees, credited to user

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.WAITING,
  })
  status: TransactionStatus;

  @Column({ type: 'integer', default: 0 })
  confirmations: number;

  @Column({ type: 'integer', name: 'required_confirmations', default: 1 })
  requiredConfirmations: number;

  @Column({ type: 'timestamptz', name: 'confirmed_at', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'varchar', length: 50, name: 'nowpayments_status', nullable: true })
  nowpaymentsStatus: string | null; // raw status string from NowPayments

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null; // raw NowPayments webhook payload

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToOne(() => Payout, (payout) => payout.transaction)
  payout: Payout;
}
