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
export class KycRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.kycRecords, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 50, name: 'document_type' })
  documentType: string; // nin | bvn | passport | drivers_license

  @Column({ type: 'varchar', length: 100, name: 'document_number' })
  documentNumber: string; // encrypted at application level

  @Column({ type: 'text', name: 'document_front_url', nullable: true })
  documentFrontUrl: string | null;

  @Column({ type: 'text', name: 'document_back_url', nullable: true })
  documentBackUrl: string | null;

  @Column({ type: 'text', name: 'selfie_url', nullable: true })
  selfieUrl: string | null;

  @Column({ type: 'varchar', length: 255, name: 'bvn_hash', nullable: true })
  bvnHash: string | null; // hashed for deduplication

  @Column({ type: 'varchar', length: 255, name: 'nin_hash', nullable: true })
  ninHash: string | null; // hashed for deduplication

  @Column({
    type: 'enum',
    enum: KycStatus,
    default: KycStatus.PENDING,
  })
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
  provider: string | null; // youverify | smile_identity | manual

  @Column({ type: 'varchar', length: 255, name: 'provider_ref', nullable: true })
  providerRef: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
