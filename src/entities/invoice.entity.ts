import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { InvoiceStatus, CoinType } from './enums';
import { User } from './user.entity';
import { InvoiceItem } from './invoice-item.entity';
import { Transaction } from './transaction.entity';
import { RateLock } from './rate-lock.entity';
import { WalletAddress } from './wallet-address.entity';

@Entity('invoices')
@Index(['userId', 'status'])
@Index(['invoiceNumber'], { unique: true })
@Index(['nowpaymentsInvoiceId'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.invoices)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 30, name: 'invoice_number', unique: true })
  invoiceNumber: string; // e.g. INV-2024-0042

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 200, name: 'client_name', nullable: true })
  clientName: string | null;

  @Column({ type: 'varchar', length: 255, name: 'client_email', nullable: true })
  clientEmail: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'amount_usd' })
  amountUsd: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'amount_ngn', nullable: true })
  amountNgn: number | null;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.DRAFT,
  })
  status: InvoiceStatus;

  @Column({
    type: 'enum',
    enum: CoinType,
    name: 'selected_coin',
    nullable: true,
  })
  selectedCoin: CoinType | null;

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'crypto_amount', nullable: true })
  cryptoAmount: number | null;

  @Column({ type: 'varchar', length: 100, name: 'nowpayments_invoice_id', nullable: true })
  nowpaymentsInvoiceId: string | null;

  @Column({ type: 'text', name: 'payment_url', nullable: true })
  paymentUrl: string | null;

  @Column({ type: 'varchar', length: 255, name: 'payment_address', nullable: true })
  paymentAddress: string | null;

  @Column({ type: 'text', name: 'qr_code_url', nullable: true })
  qrCodeUrl: string | null;

  @Column({ type: 'uuid', name: 'rate_lock_id', nullable: true })
  rateLockId: string | null;

  @OneToOne(() => RateLock, (rl) => rl.invoice, { nullable: true })
  @JoinColumn({ name: 'rate_lock_id' })
  rateLock: RateLock | null;

  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => InvoiceItem, (item) => item.invoice, { cascade: true })
  items: InvoiceItem[];

  @OneToMany(() => Transaction, (tx) => tx.invoice)
  transactions: Transaction[];

  @OneToMany(() => WalletAddress, (wa) => wa.invoice)
  walletAddresses: WalletAddress[];
}
