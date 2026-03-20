import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { CoinType, NetworkType, SystemWalletStatus } from './enums';
import { SystemWalletTransaction } from './system-wallet-transaction.entity';

/**
 * SystemWallet represents the platform's own on-chain wallets.
 *
 * Purpose:
 *  - Receive aggregated crypto from NowPayments settlements
 *  - Track platform fee collection per coin
 *  - Maintain NGN liquidity reserve balance (off-chain, for Flutterwave payouts)
 *  - Track hot wallet balances for reconciliation
 *  - Sweep dust / consolidate UTXOs
 *
 * Each coin + network combination should have ONE active wallet.
 * Cold storage wallets are tracked here with is_hot_wallet = false.
 */
@Entity('system_wallets')
@Index(['coin', 'network', 'status'])
@Index(['address'], { unique: true })
export class SystemWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  label: string;
  // e.g. 'USDT-TRC20 Hot Wallet' | 'BTC Fee Collector' | 'NGN Reserve'

  @Column({ type: 'enum', enum: CoinType, nullable: true })
  coin: CoinType | null;
  // null for fiat reserve (NGN) wallets

  @Column({ type: 'enum', enum: NetworkType, nullable: true })
  network: NetworkType | null;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  address: string | null;
  // on-chain address; null for off-chain NGN reserve

  @Column({ type: 'varchar', length: 255, name: 'address_encrypted', nullable: true })
  addressEncrypted: string | null;
  // AES-256 encrypted version stored for internal ops

  @Column({ type: 'boolean', name: 'is_hot_wallet', default: true })
  isHotWallet: boolean;
  // false = cold storage (tracked only, no automated ops)

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'balance_crypto', default: 0 })
  balanceCrypto: number;
  // last known on-chain balance (synced by reconciliation job)

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'balance_usd_equiv', default: 0 })
  balanceUsdEquiv: number;
  // USD equivalent of balanceCrypto at last sync

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'balance_ngn_reserve', default: 0 })
  balanceNgnReserve: number;
  // for the NGN liquidity reserve wallet (off-chain, tracks Flutterwave balance)

  @Column({ type: 'numeric', precision: 28, scale: 10, name: 'total_fees_collected', default: 0 })
  totalFeesCollected: number;
  // cumulative platform fees collected in this wallet's coin

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'total_fees_collected_usd', default: 0 })
  totalFeesCollectedUsd: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'min_balance_alert_usd', nullable: true })
  minBalanceAlertUsd: number | null;
  // trigger notification if USD equiv drops below this

  @Column({ type: 'varchar', length: 100, name: 'nowpayments_wallet_id', nullable: true })
  nowpaymentsWalletId: string | null;
  // NowPayments sub-wallet / custody account ID if applicable

  @Column({ type: 'enum', enum: SystemWalletStatus, default: SystemWalletStatus.ACTIVE })
  status: SystemWalletStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', name: 'last_synced_at', nullable: true })
  lastSyncedAt: Date | null;
  // last time balance was fetched from chain / NowPayments

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => SystemWalletTransaction, (swt) => swt.systemWallet)
  walletTransactions: SystemWalletTransaction[];
}
