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
import { UserRole, KycStatus, TwoFaMethod } from './enums';
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
@Index(['phoneHash'], { unique: true, where: '"phone_hash" IS NOT NULL' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Plaintext — needed for login lookup ──────────────────────────────────────
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  // ── Argon2id hash — never store raw password ─────────────────────────────────
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  // ── Plaintext — low sensitivity, used in UI ───────────────────────────────────
  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName: string;

  @Column({ type: 'varchar', length: 100, name: 'last_name' })
  lastName: string;

  // ── ENCRYPTED — verified legal name from government ID ───────────────────────
  // Stored encrypted; decrypted only when needed for display/KYC
  @Column({ type: 'text', name: 'verified_name', nullable: true })
  verifiedName: string | null; // stored as AES-256-GCM ciphertext

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

  @Column({
    type: 'enum',
    enum: TwoFaMethod,
    name: 'two_fa_method',
    default: TwoFaMethod.EMAIL,
  })
  twoFaMethod: TwoFaMethod;

  // ── ENCRYPTED phone — stored as ciphertext ────────────────────────────────────
  // phoneHash: HMAC for uniqueness check and WhatsApp bot lookup
  // phone:     AES-256-GCM encrypted — decrypted only when needed
  @Column({ type: 'text', name: 'phone', nullable: true })
  phone: string | null; // encrypted

  @Column({
    type: 'varchar',
    length: 64,
    name: 'phone_hash',
    nullable: true,
    unique: true,
  })
  phoneHash: string | null; // HMAC-SHA256 — used for lookups/dedup

  @Column({ type: 'boolean', name: 'is_phone_verified', default: false })
  isPhoneVerified: boolean;

  @Column({ type: 'boolean', name: 'two_fa_enabled', default: true })
  twoFaEnabled: boolean;

  // ── ENCRYPTED — TOTP secret for authenticator app ────────────────────────────
  @Column({ type: 'text', name: 'two_fa_secret', nullable: true })
  twoFaSecret: string | null; // encrypted

  // ── Short-lived OTP — plaintext is fine (expires in 10 min) ──────────────────
  @Column({ type: 'varchar', length: 10, name: 'email_otp', nullable: true })
  emailOtp: string | null;

  @Column({ type: 'timestamptz', name: 'email_otp_expires_at', nullable: true })
  emailOtpExpiresAt: Date | null;

  // ── Argon2id hash — never store raw PIN ──────────────────────────────────────
  @Column({ type: 'varchar', length: 255, name: 'pin_hash', nullable: true })
  pinHash: string | null;

  @Column({ type: 'boolean', name: 'is_pin_set', default: false })
  isPinSet: boolean;

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

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => Invoice, (i) => i.user) invoices: Invoice[];
  @OneToMany(() => BankAccount, (ba) => ba.user) bankAccounts: BankAccount[];
  @OneToMany(() => WalletAddress, (wa) => wa.user)
  walletAddresses: WalletAddress[];
  @OneToMany(() => Transaction, (tx) => tx.user) transactions: Transaction[];
  @OneToMany(() => KycRecord, (kyc) => kyc.user) kycRecords: KycRecord[];
  @OneToMany(() => Notification, (n) => n.user) notifications: Notification[];
  @OneToMany(() => AuditLog, (log) => log.user) auditLogs: AuditLog[];
  @OneToMany(() => Referral, (r) => r.referrer) referralsMade: Referral[];
  @OneToMany(() => Referral, (r) => r.referred) referralsReceived: Referral[];
}
