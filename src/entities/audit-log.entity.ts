import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AuditActorType } from './enums';
import { User } from './user.entity';

@Entity('audit_logs')
@Index(['entityType', 'entityId'])
@Index(['userId'])
@Index(['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null; // null for system-initiated actions

  @ManyToOne(() => User, (user) => user.auditLogs, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'enum', enum: AuditActorType, name: 'actor_type' })
  actorType: AuditActorType;

  @Column({ type: 'varchar', length: 100 })
  action: string;
  // e.g. invoice.created | payout.initiated | kyc.approved

  @Column({ type: 'varchar', length: 50, name: 'entity_type', nullable: true })
  entityType: string | null; // table name e.g. 'invoices'

  @Column({ type: 'uuid', name: 'entity_id', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', name: 'old_values', nullable: true })
  oldValues: Record<string, any> | null;

  @Column({ type: 'jsonb', name: 'new_values', nullable: true })
  newValues: Record<string, any> | null;

  @Column({ type: 'inet', name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'text', name: 'user_agent', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({type: 'timestamptz', name: 'created_at' } )
  createdAt: Date;
}
