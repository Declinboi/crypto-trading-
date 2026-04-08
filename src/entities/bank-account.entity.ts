import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Payout } from './payout.entity';

@Entity('bank_accounts')
@Index(['userId'])
@Index(['accountNumberHash']) // fast lookup by account number
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.bankAccounts)
  @JoinColumn({ name: 'user_id' })
  user: User;

  // ── ENCRYPTED — sensitive financial PII ──────────────────────────────────────
  @Column({ type: 'text', name: 'account_name' })
  accountName: string; // AES-256-GCM encrypted

  @Column({ type: 'text', name: 'account_number' })
  accountNumber: string; // AES-256-GCM encrypted

  // ── HMAC hash for uniqueness check and fast lookup ───────────────────────────
  // Allows: "does this account already exist?" without decrypting
  @Column({ type: 'varchar', length: 64, name: 'account_number_hash' })
  accountNumberHash: string; // HMAC-SHA256

  // ── Plaintext — not sensitive, needed for display/routing ─────────────────────
  @Column({ type: 'varchar', length: 10, name: 'bank_code' })
  bankCode: string;

  @Column({ type: 'varchar', length: 100, name: 'bank_name' })
  bankName: string;

  @Column({ type: 'char', length: 3, default: 'NGN' })
  currency: string;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', name: 'is_verified', default: false })
  isVerified: boolean;

  // ── ENCRYPTED — external provider reference ───────────────────────────────────
  @Column({ type: 'text', name: 'flw_recipient_id', nullable: true })
  flwRecipientId: string | null; // AES-256-GCM encrypted

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Payout, (payout) => payout.bankAccount)
  payouts: Payout[];
}
