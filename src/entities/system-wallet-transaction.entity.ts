import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SystemWallet } from './system-wallet.entity';
import { SystemWalletTransactionType } from './enums';

@Entity('system_wallet_transactions')
@Index(['systemWalletId', 'createdAt'])
@Index(['type'])
@Index(['reference'], { unique: true })
export class SystemWalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'system_wallet_id' })
  systemWalletId: string;

  @ManyToOne(() => SystemWallet, (sw) => sw.transactions)
  @JoinColumn({ name: 'system_wallet_id' })
  systemWallet: SystemWallet;

  @Column({ type: 'enum', enum: SystemWalletTransactionType })
  type: SystemWalletTransactionType;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'amount_ngn' })
  amountNgn: number;
  // Always NGN — no crypto, no USD

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'balance_before',
  })
  balanceBefore: number;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'balance_after',
  })
  balanceAfter: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  reference: string;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'uuid', name: 'related_payout_id', nullable: true })
  relatedPayoutId: string | null;

  @Column({ type: 'uuid', name: 'related_transaction_id', nullable: true })
  relatedTransactionId: string | null;
  // Link to crypto transaction that generated this fee

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}