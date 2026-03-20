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
import { User } from './user.entity';

@Entity('platform_settings')
@Index(['key'], { unique: true })
export class PlatformSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  key: string;
  // e.g. fx_spread_percent | max_invoice_usd | supported_coins | maintenance_mode

  @Column({ type: 'text' })
  value: string; // cast to correct type based on valueType

  @Column({
    type: 'varchar',
    length: 20,
    name: 'value_type',
    default: 'string',
  })
  valueType: 'string' | 'number' | 'boolean' | 'json';

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', name: 'is_public', default: false })
  isPublic: boolean; // exposed to frontend via rates/config API

  @Column({ type: 'uuid', name: 'updated_by_id', nullable: true })
  updatedById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy: User | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // ── Helper ─────────────────────────────────────────────────────────────────
  getParsedValue(): string | number | boolean | Record<string, any> {
    switch (this.valueType) {
      case 'number':
        return Number(this.value);
      case 'boolean':
        return this.value === 'true';
      case 'json':
        return JSON.parse(this.value);
      default:
        return this.value;
    }
  }
}
