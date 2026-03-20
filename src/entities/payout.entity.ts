import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { PayoutStatus } from './enums';
import { Transaction } from './transaction.entity';
import { User } from './user.entity';
import { BankAccount } from './bank-account.entity';

@Entity('payouts')
@Index(['transactionId'], { unique: true })
@Index(['userId'])
@Index(['status'])
@Index(['flwTransferId'])
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'transaction_id', unique: true })
  transactionId: string;

  @OneToOne(() => Transaction, (tx) => tx.payout)
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'bank_account_id' })
  bankAccountId: string;

  @ManyToOne(() => BankAccount, (ba) => ba.payouts)
  @JoinColumn({ name: 'bank_account_id' })
  bankAccount: BankAccount;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'amount_ngn' })
  amountNgn: number; // gross NGN before Flutterwave fee

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'fee_ngn',
    default: 0,
  })
  feeNgn: number; // Flutterwave transfer fee

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'net_amount_ngn' })
  netAmountNgn: number; // amount actually credited to user

  @Column({
    type: 'enum',
    enum: PayoutStatus,
    default: PayoutStatus.PENDING,
  })
  status: PayoutStatus;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'flw_transfer_id',
    nullable: true,
  })
  flwTransferId: string | null;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'flw_reference',
    nullable: true,
  })
  flwReference: string | null; // unique reference sent to Flutterwave

  @Column({ type: 'varchar', length: 50, name: 'flw_status', nullable: true })
  flwStatus: string | null; // raw status from Flutterwave

  @Column({ type: 'varchar', length: 255, nullable: true })
  narration: string | null; // bank transfer narration

  @Column({ type: 'integer', name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ type: 'timestamptz', name: 'last_retry_at', nullable: true })
  lastRetryAt: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'text', name: 'failure_reason', nullable: true })
  failureReason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null; // raw Flutterwave webhook payload

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
