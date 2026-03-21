import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { SystemWalletTransaction } from './system-wallet-transaction.entity';
import { SystemWalletStatus } from './enums';

@Entity('system_wallets')
export class SystemWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  label: string;
  // e.g. 'Main NGN Reserve' | 'Fee Collection Wallet'

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'balance_ngn',
    default: 0,
  })
  balanceNgn: number;
  // Current available NGN balance

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_credited_ngn',
    default: 0,
  })
  totalCreditedNgn: number;
  // Lifetime total NGN credited (fees + top-ups)

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_debited_ngn',
    default: 0,
  })
  totalDebitedNgn: number;
  // Lifetime total NGN debited (payouts)

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_fees_collected_ngn',
    default: 0,
  })
  totalFeesCollectedNgn: number;
  // Lifetime fees only (subset of totalCreditedNgn)

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'min_balance_alert_ngn',
    nullable: true,
  })
  minBalanceAlertNgn: number | null;
  // Alert admins if balance drops below this

  @Column({
    type: 'enum',
    enum: SystemWalletStatus,
    default: SystemWalletStatus.ACTIVE,
  })
  status: SystemWalletStatus;
  // Always ACTIVE unless under maintenance

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', name: 'last_transaction_at', nullable: true })
  lastTransactionAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => SystemWalletTransaction, (tx) => tx.systemWallet)
  transactions: SystemWalletTransaction[];
}