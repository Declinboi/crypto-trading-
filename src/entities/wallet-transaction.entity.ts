import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserWallet } from './user-wallet.entity';
import { WalletTransactionType } from 'src/wallet/dto/wallet.dto';


@Entity('wallet_transactions')
@Index(['walletId', 'createdAt'])
@Index(['reference'], { unique: true })
@Index(['walletId', 'type'])
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'wallet_id' })
  walletId: string;

  @ManyToOne(() => UserWallet, (wallet) => wallet.transactions)
  @JoinColumn({ name: 'wallet_id' })
  wallet: UserWallet;

  @Column({
    type: 'enum',
    enum: WalletTransactionType,
  })
  type: WalletTransactionType;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: number;

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
  reference: string; // unique idempotency reference

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'uuid', name: 'counterpart_wallet_id', nullable: true })
  counterpartWalletId: string | null; // for transfers: other party's wallet

  @Column({ type: 'varchar', length: 20, name: 'counterpart_tag', nullable: true })
  counterpartTag: string | null; // human-readable tag of other party

  @Column({ type: 'uuid', name: 'related_payout_id', nullable: true })
  relatedPayoutId: string | null; // link to payout if withdrawn

  @Column({ type: 'uuid', name: 'related_transaction_id', nullable: true })
  relatedTransactionId: string | null; // link to crypto transaction

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}