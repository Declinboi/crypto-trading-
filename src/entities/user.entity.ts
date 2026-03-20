import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserRole, KycStatus } from './enums';
import { Invoice } from './invoice.entity';
import { BankAccount } from './bank-account.entity';
import { WalletAddress } from './wallet-address.entity';
import { Transaction } from './transaction.entity';
import { KycRecord } from './kyc-record.entity';
import { Notification } from './notification.entity';
import { AuditLog } from './audit-log.entity';
import { Referral } from './referral.entity';

@Entity('users')
@Index(['email'], { unique: true })
@Index(['referralCode'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, name: 'last_name' })
  lastName: string;

  @Column({ type: 'varchar', length: 200, name: 'business_name', nullable: true })
  businessName: string | null;

  @Column({ type: 'text', name: 'avatar_url', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({
    type: 'enum',
    enum: KycStatus,
    name: 'kyc_status',
    default: KycStatus.PENDING,
  })
  kycStatus: KycStatus;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  @Column({ type: 'boolean', name: 'is_phone_verified', default: false })
  isPhoneVerified: boolean;

  @Column({ type: 'boolean', name: 'two_fa_enabled', default: false })
  twoFaEnabled: boolean;

  @Column({ type: 'varchar', length: 100, name: 'two_fa_secret', nullable: true })
  twoFaSecret: string | null;

  @Column({ type: 'varchar', length: 20, name: 'referral_code', unique: true })
  referralCode: string;

  @Column({ type: 'uuid', name: 'referred_by_id', nullable: true })
  referredById: string | null;

  @ManyToOne(() => User, (user) => user.referredUsers, { nullable: true })
  @JoinColumn({ name: 'referred_by_id' })
  referredBy: User | null;

  @OneToMany(() => User, (user) => user.referredBy)
  referredUsers: User[];

  @Column({ type: 'timestamptz', name: 'last_login_at', nullable: true })
  lastLoginAt: Date | null;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => Invoice, (invoice) => invoice.user)
  invoices: Invoice[];

  @OneToMany(() => BankAccount, (ba) => ba.user)
  bankAccounts: BankAccount[];

  @OneToMany(() => WalletAddress, (wa) => wa.user)
  walletAddresses: WalletAddress[];

  @OneToMany(() => Transaction, (tx) => tx.user)
  transactions: Transaction[];

  @OneToMany(() => KycRecord, (kyc) => kyc.user)
  kycRecords: KycRecord[];

  @OneToMany(() => Notification, (n) => n.user)
  notifications: Notification[];

  @OneToMany(() => AuditLog, (log) => log.user)
  auditLogs: AuditLog[];

  @OneToMany(() => Referral, (r) => r.referrer)
  referralsMade: Referral[];

  @OneToMany(() => Referral, (r) => r.referred)
  referralsReceived: Referral[];
}
