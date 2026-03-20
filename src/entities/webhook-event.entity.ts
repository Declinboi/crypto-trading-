import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { WebhookSource } from './enums';

@Entity('webhook_events')
@Index(['idempotencyKey'], { unique: true })
@Index(['externalRef'])
@Index(['processed'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: WebhookSource })
  source: WebhookSource;

  @Column({ type: 'varchar', length: 100, name: 'event_type' })
  eventType: string;
  // e.g. payment.waiting | payment.confirmed | transfer.success

  @Column({
    type: 'varchar',
    length: 255,
    name: 'external_ref',
    nullable: true,
  })
  externalRef: string | null;
  // NowPayments payment_id or Flutterwave transfer_id

  @Column({ type: 'jsonb' })
  payload: Record<string, any>; // full raw webhook JSON body

  @Column({ type: 'boolean', name: 'signature_valid', default: false })
  signatureValid: boolean; // HMAC verification result

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'text', name: 'processing_error', nullable: true })
  processingError: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'idempotency_key',
    unique: true,
  })
  idempotencyKey: string; // prevents duplicate processing

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
