import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CoinType, SystemWalletTransactionType } from './enums';
import { SystemWallet } from './system-wallet.entity';
import { Transaction } from './transaction.entity';
import { Payout } from './payout.entity';

/**
 * SystemWalletTransaction is the ledger for the platform's own wallets.
 *
 * Every movement in or out of a SystemWallet is recorded here:
 *  - DEPOSIT      : crypto received from NowPayments settlement into platform wallet
 *  - WITHDRAWAL   : crypto swept to cold storage or exchange
 *  - FEE_CREDIT   : platform fee portion credited from a user transaction
 *  - PAYOUT_RESERVE: NGN deducted from reserve when a Flutterwave payout is initiated
 *  - RECONCILIATION: balance correction entries from manual reconciliation
 */
@Entity('system_wallet_transactions')
@Index(['systemWalletId', 'createdAt'])
@Index(['type'])
@Index(['txHash'])
@Index(['transactionId'])
@Index(['payoutId'])
export class SystemWalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'system_wallet_id' })
  systemWalletId: string;

  @ManyToOne(() => SystemWallet, (sw) => sw.walletTransactions)
  @JoinColumn({ name: 'system_wallet_id' })
  systemWallet: SystemWallet;

  @Column({ type: 'enum', enum: SystemWalletTransactionType })
  type: SystemWalletTransactionType;

  @Column({ type: 'enum', enum: CoinType, nullable: true })
  coin: CoinType | null;

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'amount_crypto', default: 0 })
  amountCrypto: number;
  // positive = inflow, negative = outflow

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'amount_usd', default: 0 })
  amountUsd: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'amount_ngn', default: 0 })
  amountNgn: number;
  // populated for payout_reserve and reconciliation entries

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'balance_before', nullable: true })
  balanceBefore: number | null;
  // snapshot of wallet balance before this entry

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'balance_after', nullable: true })
  balanceAfter: number | null;
  // snapshot of wallet balance after this entry

  @Column({ type: 'varchar', length: 255, name: 'tx_hash', nullable: true })
  txHash: string | null;
  // on-chain hash for DEPOSIT and WITHDRAWAL types

  @Column({ type: 'uuid', name: 'transaction_id', nullable: true })
  transactionId: string | null;
  // FK to user-facing Transaction that triggered this entry

  @ManyToOne(() => Transaction, { nullable: true })
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction | null;

  @Column({ type: 'uuid', name: 'payout_id', nullable: true })
  payoutId: string | null;
  // FK to Payout that triggered a PAYOUT_RESERVE entry

  @ManyToOne(() => Payout, { nullable: true })
  @JoinColumn({ name: 'payout_id' })
  payout: Payout | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, name: 'usd_rate_snapshot', nullable: true })
  usdRateSnapshot: number | null;
  // USD/NGN rate at time of this entry

  @Column({ type: 'text', nullable: true })
  description: string | null;
  // human-readable note e.g. 'Fee from invoice INV-2024-0042'

  @Column({ type: 'varchar', length: 100, name: 'reference', nullable: true })
  reference: string | null;
  // internal idempotency reference for this entry

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
