import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../entities/user.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { WalletStatus } from 'src/wallet/dto/wallet.dto';

@Entity('user_wallets')
@Index(['userId'], { unique: true })
@Index(['tag'], { unique: true })
export class UserWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 20, unique: true })
  tag: string; // unique wallet tag e.g. JOHN1234

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'balance_ngn',
    default: 0,
  })
  balanceNgn: number; // available balance

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'locked_balance_ngn',
    default: 0,
  })
  lockedBalanceNgn: number; // funds locked during processing

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_received_ngn',
    default: 0,
  })
  totalReceivedNgn: number; // lifetime total received

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    name: 'total_sent_ngn',
    default: 0,
  })
  totalSentNgn: number; // lifetime total sent

  @Column({
    type: 'enum',
    enum: WalletStatus,
    default: WalletStatus.ACTIVE,
  })
  status: WalletStatus;

  @Column({ type: 'text', name: 'freeze_reason', nullable: true })
  freezeReason: string | null;

  @Column({ type: 'timestamptz', name: 'frozen_at', nullable: true })
  frozenAt: Date | null;

  @Column({ type: 'timestamptz', name: 'last_transaction_at', nullable: true })
  lastTransactionAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => WalletTransaction, (tx) => tx.wallet)
  transactions: WalletTransaction[];
}
