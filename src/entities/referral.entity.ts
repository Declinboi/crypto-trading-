import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ReferralStatus } from './enums';
import { User } from './user.entity';

@Entity('referrals')
@Index(['referrerId'])
@Index(['referredId'], { unique: true }) // one referral per user
@Index(['referralCode'])
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'referrer_id' })
  referrerId: string;

  @ManyToOne(() => User, (user) => user.referralsMade)
  @JoinColumn({ name: 'referrer_id' })
  referrer: User;

  @Column({ type: 'uuid', name: 'referred_id', unique: true })
  referredId: string;

  @ManyToOne(() => User, (user) => user.referralsReceived)
  @JoinColumn({ name: 'referred_id' })
  referred: User;

  @Column({ type: 'varchar', length: 20, name: 'referral_code' })
  referralCode: string; // code that was used at signup

  @Column({ type: 'enum', enum: ReferralStatus, default: ReferralStatus.PENDING })
  status: ReferralStatus;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'reward_amount_ngn', nullable: true })
  rewardAmountNgn: number | null;

  @Column({ type: 'timestamptz', name: 'rewarded_at', nullable: true })
  rewardedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'qualified_at', nullable: true })
  qualifiedAt: Date | null; // when referred user paid their first invoice

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
