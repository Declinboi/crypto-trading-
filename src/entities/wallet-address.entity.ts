import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CoinType, NetworkType } from './enums';
import { User } from './user.entity';
import { Invoice } from './invoice.entity';

@Entity('wallet_addresses')
@Index(['address'], { unique: true })
@Index(['userId'])
@Index(['invoiceId'])
export class WalletAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.walletAddresses)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'invoice_id', nullable: true })
  invoiceId: string | null;

  @ManyToOne(() => Invoice, (invoice) => invoice.walletAddresses, {
    nullable: true,
  })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice | null;

  @Column({ type: 'enum', enum: CoinType })
  coin: CoinType;

  @Column({ type: 'enum', enum: NetworkType })
  network: NetworkType;

  @Column({ type: 'varchar', length: 255, unique: true })
  address: string;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'derivation_path',
    nullable: true,
  })
  derivationPath: string | null; // BIP44 path if using HD wallet

  @Column({ type: 'boolean', name: 'is_used', default: false })
  isUsed: boolean;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'nowpayments_ref',
    nullable: true,
  })
  nowpaymentsRef: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
