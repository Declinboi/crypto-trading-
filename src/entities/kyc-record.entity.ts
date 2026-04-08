import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { KycStatus } from './enums';
import { User } from './user.entity';

@Entity('kyc_records')
@Index(['userId'])
@Index(['bvnHash'], { where: '"bvn_hash" IS NOT NULL' })
@Index(['ninHash'], { where: '"nin_hash" IS NOT NULL' })
export class KycRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.kycRecords, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // ── Plaintext — document category, not sensitive ──────────────────────────────
  @Column({ type: 'varchar', length: 50, name: 'document_type' })
  documentType: string;

  // ── ENCRYPTED — the actual ID number ─────────────────────────────────────────
  @Column({ type: 'text', name: 'document_number' })
  documentNumber: string; // AES-256-GCM encrypted

  // ── ENCRYPTED — file URLs may contain signed tokens ───────────────────────────
  // @Column({ type: 'text', name: 'document_front_url', nullable: true })
  // documentFrontUrl: string | null; // AES-256-GCM encrypted

  // @Column({ type: 'text', name: 'document_back_url', nullable: true })
  // documentBackUrl: string | null; // AES-256-GCM encrypted

  @Column({ type: 'text', name: 'selfie_url', nullable: true })
  selfieUrl: string | null; // AES-256-GCM encrypted

  // ── HMAC hashes — for deduplication lookups ONLY ─────────────────────────────
  // These cannot be reversed — they are purely for "has this ID been used before?"
  @Column({ type: 'varchar', length: 64, name: 'bvn_hash', nullable: true })
  bvnHash: string | null; // HMAC-SHA256

  @Column({ type: 'varchar', length: 64, name: 'nin_hash', nullable: true })
  ninHash: string | null; // HMAC-SHA256

  @Column({ type: 'enum', enum: KycStatus, default: KycStatus.PENDING })
  status: KycStatus;

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'uuid', name: 'reviewed_by_id', nullable: true })
  reviewedById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by_id' })
  reviewedBy: User | null;

  @Column({ type: 'timestamptz', name: 'reviewed_at', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  provider: string | null;

  // ── ENCRYPTED — external provider reference ───────────────────────────────────
  @Column({ type: 'text', name: 'provider_ref', nullable: true })
  providerRef: string | null; // AES-256-GCM encrypted

  // ── Metadata — strip sensitive fields before saving ───────────────────────────
  // Never store raw ID numbers or face data in metadata JSONB
  @Column({ type: 'jsonb', nullable: true, default: null })
  metadata: any;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
