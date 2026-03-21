import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';

import { SystemWallet } from '../entities/system-wallet.entity';
import { SystemWalletTransaction } from '../entities/system-wallet-transaction.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';
import { User } from '../entities/user.entity';
import {
  SystemWalletStatus,
  SystemWalletTransactionType,
  AuditActorType,
  NotificationType,
  NotificationChannel,
} from '../entities/enums';
import {
  CreateSystemWalletDto,
  UpdateSystemWalletDto,
  TopUpSystemWalletDto,
  RecordTransactionDto,
  WalletQueryDto,
  TransactionQueryDto,
  WithdrawSystemWalletDto,
} from './dto/system-wallet.dto';

@Injectable()
export class SystemWalletService implements OnModuleInit {
  private readonly logger = new Logger(SystemWalletService.name);

  constructor(
    @InjectRepository(SystemWallet)
    private walletRepo: Repository<SystemWallet>,

    @InjectRepository(SystemWalletTransaction)
    private txRepo: Repository<SystemWalletTransaction>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    private dataSource: DataSource,
  ) {}

  // ── AUTO-INITIALIZE on server start ──────────────────────────────────────────
  // Ensures the main system wallet always exists as long as the server runs
  async onModuleInit() {
    await this.ensureSystemWalletExists();
  }

  private async ensureSystemWalletExists(): Promise<void> {
    const existing = await this.walletRepo.findOne({
      where: { label: 'Main NGN Reserve' },
    });

    if (!existing) {
      await this.walletRepo.save(
        this.walletRepo.create({
          label: 'Main NGN Reserve',
          balanceNgn: 0,
          totalCreditedNgn: 0,
          totalDebitedNgn: 0,
          totalFeesCollectedNgn: 0,
          minBalanceAlertNgn: 50000, // alert if below ₦50,000
          status: SystemWalletStatus.ACTIVE,
          notes: 'Auto-created main system wallet. Holds all platform NGN.',
        }),
      );
      this.logger.log('Main NGN Reserve system wallet created on startup');
    } else if (existing.status !== SystemWalletStatus.ACTIVE) {
      // Always ensure main wallet is active on startup
      await this.walletRepo.update(existing.id, {
        status: SystemWalletStatus.ACTIVE,
      });
      this.logger.log('Main NGN Reserve system wallet reactivated on startup');
    } else {
      this.logger.log(
        `Main NGN Reserve online — balance: ₦${Number(existing.balanceNgn).toLocaleString('en-NG')}`,
      );
    }
  }

  // ── GET MAIN SYSTEM WALLET ────────────────────────────────────────────────────
  async getMainWallet(): Promise<SystemWallet> {
    const wallet = await this.walletRepo.findOne({
      where: { label: 'Main NGN Reserve' },
    });
    if (!wallet) {
      // Re-create if somehow missing
      await this.ensureSystemWalletExists();
      return this.walletRepo.findOne({
        where: { label: 'Main NGN Reserve' },
      }) as Promise<SystemWallet>;
    }
    return wallet;
  }

  // ── CREATE ADDITIONAL WALLET (admin) ──────────────────────────────────────────
  async create(dto: CreateSystemWalletDto, adminId: string) {
    const wallet = await this.walletRepo.save(
      this.walletRepo.create({
        label: dto.label,
        balanceNgn: 0,
        totalCreditedNgn: 0,
        totalDebitedNgn: 0,
        totalFeesCollectedNgn: 0,
        minBalanceAlertNgn: dto.minBalanceAlertNgn ?? null,
        status: SystemWalletStatus.ACTIVE,
        notes: dto.notes ?? null,
      }),
    );

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'system_wallet.created',
      'system_wallets',
      wallet.id,
      null,
      { label: wallet.label },
    );

    this.logger.log(`System wallet created: ${wallet.label} (${wallet.id})`);
    return { message: 'System wallet created successfully', wallet };
  }

  // ── GET ALL WALLETS ───────────────────────────────────────────────────────────
  async findAll(query: WalletQueryDto) {
    const qb = this.walletRepo
      .createQueryBuilder('sw')
      .orderBy('sw.createdAt', 'ASC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.status) {
      qb.andWhere('sw.status = :status', { status: query.status });
    }

    const [wallets, total] = await qb.getManyAndCount();
    return {
      data: wallets,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  // ── GET SINGLE WALLET ─────────────────────────────────────────────────────────
  async findOne(walletId: string): Promise<SystemWallet> {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');
    return wallet;
  }

  // ── UPDATE WALLET ─────────────────────────────────────────────────────────────
  async update(walletId: string, dto: UpdateSystemWalletDto, adminId: string) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    // Cannot deactivate the main wallet
    if (
      wallet.label === 'Main NGN Reserve' &&
      dto.status === SystemWalletStatus.MAINTENANCE
    ) {
      throw new BadRequestException(
        'The main NGN reserve wallet cannot be put under maintenance while payouts are active',
      );
    }

    const oldValues = {
      label: wallet.label,
      status: wallet.status,
      minBalanceAlertNgn: wallet.minBalanceAlertNgn,
    };

    await this.walletRepo.update(walletId, {
      ...(dto.label && { label: dto.label }),
      ...(dto.status && { status: dto.status }),
      ...(dto.minBalanceAlertNgn !== undefined && {
        minBalanceAlertNgn: dto.minBalanceAlertNgn,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
    });

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'system_wallet.updated',
      'system_wallets',
      walletId,
      oldValues,
      dto,
    );

    return {
      message: 'Wallet updated successfully',
      wallet: await this.walletRepo.findOne({ where: { id: walletId } }),
    };
  }

  // ── ADMIN TOP-UP (deposit NGN into system wallet) ─────────────────────────────
  // Called when admin manually transfers NGN to fund the reserve
  // e.g. from Flutterwave balance, direct bank transfer, etc.
  async adminTopUp(
    walletId: string,
    dto: TopUpSystemWalletDto,
    adminId: string,
  ) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    if (wallet.status === SystemWalletStatus.MAINTENANCE) {
      throw new BadRequestException('Wallet is under maintenance');
    }

    const reference =
      dto.reference ??
      `TOPUP-${adminId}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Check reference uniqueness
    const existing = await this.txRepo.findOne({ where: { reference } });
    if (existing) {
      throw new BadRequestException(
        `Reference ${reference} already exists. Use a unique reference.`,
      );
    }

    const result = await this.recordNgnTransaction(
      walletId,
      {
        type: SystemWalletTransactionType.TOP_UP,
        amountNgn: dto.amountNgn,
        description: dto.description,
        reference,
        relatedPayoutId: null,
        relatedTransactionId: null,
      },
      adminId,
    );

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'system_wallet.top_up',
      'system_wallets',
      walletId,
      null,
      { amountNgn: dto.amountNgn, reference, description: dto.description },
    );

    this.logger.log(
      `System wallet top-up: ₦${dto.amountNgn.toLocaleString('en-NG')} by admin=${adminId} ref=${reference}`,
    );

    return {
      message: `₦${dto.amountNgn.toLocaleString('en-NG', { minimumFractionDigits: 2 })} added to system wallet successfully`,
      newBalance: result.balanceAfter,
      reference,
      transaction: result.transaction,
    };
  }

  // ── ADMIN WITHDRAW (take profit out of system wallet) ─────────────────────────
  // Used when admin wants to transfer accumulated fees/profit to their own account
  async adminWithdraw(
    walletId: string,
    dto: WithdrawSystemWalletDto,
    adminId: string,
  ) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    if (wallet.status === SystemWalletStatus.MAINTENANCE) {
      throw new BadRequestException('Wallet is under maintenance');
    }

    const currentBalance = Number(wallet.balanceNgn);

    if (dto.amountNgn > currentBalance) {
      throw new BadRequestException(
        `Insufficient balance. Available: ₦${currentBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, Requested: ₦${dto.amountNgn.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
      );
    }

    // Safety check — don't allow withdrawing below the minimum reserve threshold
    const minReserve = Number(wallet.minBalanceAlertNgn ?? 0);
    const balanceAfterWithdrawal = currentBalance - dto.amountNgn;

    if (
      minReserve > 0 &&
      balanceAfterWithdrawal < minReserve &&
      !dto.forceWithdraw
    ) {
      throw new BadRequestException(
        `Withdrawal of ₦${dto.amountNgn.toLocaleString('en-NG')} would leave balance at ₦${balanceAfterWithdrawal.toLocaleString('en-NG')}, below the minimum reserve of ₦${minReserve.toLocaleString('en-NG')}. Set forceWithdraw=true to override.`,
      );
    }

    const reference =
      dto.reference ??
      `WITHDRAW-${adminId}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const existing = await this.txRepo.findOne({ where: { reference } });
    if (existing) {
      throw new BadRequestException(`Reference ${reference} already exists`);
    }

    const result = await this.recordNgnTransaction(
      walletId,
      {
        type: SystemWalletTransactionType.DEBIT,
        amountNgn: dto.amountNgn,
        description: dto.description,
        reference,
        relatedPayoutId: null,
        relatedTransactionId: null,
      },
      adminId,
    );

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'system_wallet.admin_withdraw',
      'system_wallets',
      walletId,
      { balanceBefore: result.balanceBefore },
      {
        amountNgn: dto.amountNgn,
        balanceAfter: result.balanceAfter,
        reference,
        description: dto.description,
        destinationBank: dto.destinationBank ?? null,
        destinationAccount: dto.destinationAccount ?? null,
      },
    );

    this.logger.log(
      `System wallet WITHDRAWAL: ₦${dto.amountNgn.toLocaleString('en-NG')} by admin=${adminId} ref=${reference} balance=${result.balanceBefore}→${result.balanceAfter}`,
    );

    return {
      message: `₦${dto.amountNgn.toLocaleString('en-NG', { minimumFractionDigits: 2 })} withdrawn from system wallet successfully`,
      amountWithdrawn: dto.amountNgn,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      reference,
      transaction: result.transaction,
    };
  }

  // ── CREDIT FEE (called after payment confirmed — NGN only) ────────────────────
  async creditFee(
    amountNgn: number,
    description: string,
    relatedTransactionId?: string,
    walletId?: string,
  ): Promise<void> {
    // Use provided walletId or fall back to main wallet
    let targetWalletId = walletId;

    if (!targetWalletId) {
      const mainWallet = await this.getMainWallet();
      targetWalletId = mainWallet.id;
    }

    const reference = `FEE-${relatedTransactionId ?? Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    await this.recordNgnTransaction(targetWalletId, {
      type: SystemWalletTransactionType.FEE_CREDIT,
      amountNgn,
      description,
      reference,
      relatedTransactionId: relatedTransactionId ?? null,
      relatedPayoutId: null,
    });

    this.logger.log(
      `Fee credited: ₦${amountNgn.toLocaleString('en-NG')} — ${description}`,
    );
  }

  // ── DEDUCT PAYOUT RESERVE (called before NGN payout is sent) ──────────────────
  async deductPayoutReserve(
    amountNgn: number,
    payoutId: string,
    description: string,
  ): Promise<void> {
    const mainWallet = await this.getMainWallet();

    if (Number(mainWallet.balanceNgn) < amountNgn) {
      this.logger.warn(
        `Low system wallet balance! Required: ₦${amountNgn}, Available: ₦${mainWallet.balanceNgn}`,
      );
      // Non-blocking — payout still proceeds, admin will be alerted
    }

    const reference = `PAYOUT-RESERVE-${payoutId}-${crypto.randomBytes(3).toString('hex')}`;

    await this.recordNgnTransaction(mainWallet.id, {
      type: SystemWalletTransactionType.PAYOUT_RESERVE,
      amountNgn,
      description,
      reference,
      relatedPayoutId: payoutId,
      relatedTransactionId: null,
    });
  }

  // ── CORE: RECORD NGN TRANSACTION ──────────────────────────────────────────────
  async recordNgnTransaction(
    walletId: string,
    dto: RecordTransactionDto,
    actorId?: string,
  ): Promise<{
    transaction: SystemWalletTransaction;
    balanceBefore: number;
    balanceAfter: number;
  }> {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    if (wallet.status === SystemWalletStatus.MAINTENANCE) {
      throw new BadRequestException('System wallet is under maintenance');
    }

    return await this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(SystemWallet);
      const txRepo = manager.getRepository(SystemWalletTransaction);

      // Pessimistic lock
      const locked = await walletRepo
        .createQueryBuilder('sw')
        .setLock('pessimistic_write')
        .where('sw.id = :id', { id: walletId })
        .getOne();

      if (!locked) throw new NotFoundException('Wallet not found');

      const balanceBefore = Number(locked.balanceNgn);
      const amountNgn = Number(dto.amountNgn);

      // Calculate new balance — credits add, debits subtract
      const isCredit = [
        SystemWalletTransactionType.FEE_CREDIT,
        SystemWalletTransactionType.TOP_UP,
        SystemWalletTransactionType.CREDIT,
        SystemWalletTransactionType.RECONCILIATION,
      ].includes(dto.type);

      const isDebit = [
        SystemWalletTransactionType.PAYOUT_RESERVE,
        SystemWalletTransactionType.DEBIT,
      ].includes(dto.type);

      let balanceAfter = balanceBefore;

      if (isCredit) {
        balanceAfter = balanceBefore + amountNgn;
      } else if (isDebit) {
        // Allow negative balance — system needs to process payouts
        // Admin will be alerted via low balance alert
        balanceAfter = balanceBefore - amountNgn;
      }

      // Update wallet
      const updateData: Partial<SystemWallet> = {
        balanceNgn: balanceAfter,
        lastTransactionAt: new Date(),
      };

      if (isCredit) {
        updateData.totalCreditedNgn =
          Number(locked.totalCreditedNgn) + amountNgn;
        if (dto.type === SystemWalletTransactionType.FEE_CREDIT) {
          updateData.totalFeesCollectedNgn =
            Number(locked.totalFeesCollectedNgn) + amountNgn;
        }
      }

      if (isDebit) {
        updateData.totalDebitedNgn = Number(locked.totalDebitedNgn) + amountNgn;
      }

      await walletRepo.update(walletId, updateData);

      // Save ledger entry
      const reference =
        dto.reference ??
        `SWT-${dto.type.toUpperCase()}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      const tx = await txRepo.save(
        txRepo.create({
          systemWalletId: walletId,
          type: dto.type,
          amountNgn,
          balanceBefore,
          balanceAfter,
          reference,
          description: dto.description,
          relatedPayoutId: dto.relatedPayoutId ?? null,
          relatedTransactionId: dto.relatedTransactionId ?? null,
          metadata: null,
        }),
      );

      // Low balance alert
      if (
        locked.minBalanceAlertNgn &&
        balanceAfter < Number(locked.minBalanceAlertNgn)
      ) {
        await this.triggerLowBalanceAlert(locked, balanceAfter);
      }

      if (actorId) {
        await this.saveAudit(
          actorId,
          AuditActorType.ADMIN,
          `system_wallet.${dto.type}`,
          'system_wallet_transactions',
          tx.id,
          { balanceBefore },
          { balanceAfter, amountNgn, type: dto.type },
        );
      }

      this.logger.log(
        `System wallet ${dto.type}: ₦${amountNgn.toLocaleString('en-NG')} | balance ₦${balanceBefore.toLocaleString('en-NG')} → ₦${balanceAfter.toLocaleString('en-NG')}`,
      );

      return { transaction: tx, balanceBefore, balanceAfter };
    });
  }

  // ── GET WALLET TRANSACTIONS ───────────────────────────────────────────────────
  async getTransactions(walletId: string, query: TransactionQueryDto) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    const qb = this.txRepo
      .createQueryBuilder('swt')
      .where('swt.system_wallet_id = :walletId', { walletId })
      .orderBy('swt.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.type) {
      qb.andWhere('swt.type = :type', { type: query.type });
    }

    const [transactions, total] = await qb.getManyAndCount();

    return {
      data: transactions,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  // ── PLATFORM STATS ────────────────────────────────────────────────────────────
  async getPlatformStats() {
    const wallets = await this.walletRepo.find();

    const totalBalanceNgn = wallets.reduce(
      (s, w) => s + Number(w.balanceNgn),
      0,
    );
    const totalFeesCollectedNgn = wallets.reduce(
      (s, w) => s + Number(w.totalFeesCollectedNgn),
      0,
    );
    const totalCreditedNgn = wallets.reduce(
      (s, w) => s + Number(w.totalCreditedNgn),
      0,
    );
    const totalDebitedNgn = wallets.reduce(
      (s, w) => s + Number(w.totalDebitedNgn),
      0,
    );

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const txSummary = await this.txRepo
      .createQueryBuilder('swt')
      .select('swt.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(swt.amount_ngn)', 'totalNgn')
      .where('swt.created_at >= :since', { since: thirtyDaysAgo })
      .groupBy('swt.type')
      .getRawMany();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayFees = await this.txRepo
      .createQueryBuilder('swt')
      .select('SUM(swt.amount_ngn)', 'totalNgn')
      .addSelect('COUNT(*)', 'count')
      .where('swt.created_at >= :today', { today: todayStart })
      .andWhere('swt.type = :type', {
        type: SystemWalletTransactionType.FEE_CREDIT,
      })
      .getRawOne();

    return {
      wallets: wallets.map((w) => ({
        id: w.id,
        label: w.label,
        balanceNgn: Number(w.balanceNgn),
        totalFeesCollectedNgn: Number(w.totalFeesCollectedNgn),
        totalCreditedNgn: Number(w.totalCreditedNgn),
        totalDebitedNgn: Number(w.totalDebitedNgn),
        minBalanceAlertNgn: w.minBalanceAlertNgn,
        status: w.status,
        lastTransactionAt: w.lastTransactionAt,
      })),
      totals: {
        balanceNgn: totalBalanceNgn.toFixed(2),
        feesCollectedNgn: totalFeesCollectedNgn.toFixed(2),
        creditedNgn: totalCreditedNgn.toFixed(2),
        debitedNgn: totalDebitedNgn.toFixed(2),
        netNgn: (totalCreditedNgn - totalDebitedNgn).toFixed(2),
      },
      today: {
        feesNgn: Number(todayFees?.totalNgn ?? 0).toFixed(2),
        feeCount: Number(todayFees?.count ?? 0),
      },
      last30Days: txSummary,
    };
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────
  private async triggerLowBalanceAlert(
    wallet: SystemWallet,
    currentBalance: number,
  ): Promise<void> {
    this.logger.warn(
      `LOW BALANCE ALERT: wallet="${wallet.label}" current=₦${currentBalance.toLocaleString('en-NG')} threshold=₦${wallet.minBalanceAlertNgn?.toLocaleString('en-NG')}`,
    );

    const admins = await this.userRepo.find({
      where: [{ role: 'admin' as any }, { role: 'super_admin' as any }],
    });

    for (const admin of admins) {
      await this.notifRepo.save(
        this.notifRepo.create({
          userId: admin.id,
          type: NotificationType.PAYOUT_FAILED,
          channel: NotificationChannel.IN_APP,
          title: '⚠️ Low System Wallet Balance',
          body: `System wallet "${wallet.label}" balance is ₦${currentBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })}, below alert threshold of ₦${Number(wallet.minBalanceAlertNgn).toLocaleString('en-NG')}. Please top up immediately to avoid failed payouts.`,
          data: {
            walletId: wallet.id,
            currentBalanceNgn: currentBalance,
            thresholdNgn: wallet.minBalanceAlertNgn,
          },
        }),
      );
    }
  }

  private async saveAudit(
    userId: string | null,
    actorType: AuditActorType,
    action: string,
    entityType?: string,
    entityId?: string,
    oldValues?: any,
    newValues?: any,
  ) {
    await this.auditRepo.save(
      this.auditRepo.create({
        userId,
        actorType,
        action,
        entityType,
        entityId,
        oldValues: oldValues ?? null,
        newValues: newValues ?? null,
      }),
    );
  }
}
