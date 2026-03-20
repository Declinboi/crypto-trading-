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
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.bankAccounts)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 200, name: 'account_name' })
  accountName: string; // verified name from Flutterwave name enquiry

  @Column({ type: 'varchar', length: 20, name: 'account_number' })
  accountNumber: string; // 10-digit NUBAN

  @Column({ type: 'varchar', length: 10, name: 'bank_code' })
  bankCode: string; // CBN bank code e.g. 057 for Zenith

  @Column({ type: 'varchar', length: 100, name: 'bank_name' })
  bankName: string;

  @Column({ type: 'char', length: 3, default: 'NGN' })
  currency: string;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', name: 'is_verified', default: false })
  isVerified: boolean; // true after Flutterwave name enquiry passes

  @Column({
    type: 'varchar',
    length: 100,
    name: 'flw_recipient_id',
    nullable: true,
  })
  flwRecipientId: string | null; // Flutterwave saved transfer recipient

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  @OneToMany(() => Payout, (payout) => payout.bankAccount)
  payouts: Payout[];
}
