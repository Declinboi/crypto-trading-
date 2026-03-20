import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_items')
@Index(['invoiceId'])
export class InvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'varchar', length: 500 })
  description: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  quantity: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'unit_price_usd' })
  unitPriceUsd: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'total_usd' })
  totalUsd: number; // computed: quantity × unitPriceUsd

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // ── Lifecycle Hooks ────────────────────────────────────────────────────────
  @BeforeInsert()
  @BeforeUpdate()
  computeTotal() {
    this.totalUsd = Number(this.quantity) * Number(this.unitPriceUsd);
  }
}
