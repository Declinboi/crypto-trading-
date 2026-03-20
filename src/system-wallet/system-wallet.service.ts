import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import * as crypto from 'crypto';

import { SystemWallet } from '../entities/system-wallet.entity';
import { SystemWalletTransaction } from '../entities/system-wallet-transaction.entity';
import { ExchangeRate } from '../entities/exchange-rate.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';
import { User } from '../entities/user.entity';
import {
  SystemWalletStatus,
  SystemWalletTransactionType,
  AuditActorType,
  CoinType,
  NotificationType,
  NotificationChannel,
} from '../entities/enums';
import {
  CreateSystemWalletDto,
  UpdateSystemWalletDto,
  RecordTransactionDto,
  SyncBalanceDto,
  WalletQueryDto,
  TransactionQueryDto,
} from './dto/system-wallet.dto';

@Injectable()
export class SystemWalletService {
  private readonly logger = new Logger(SystemWalletService.name);

  constructor(
    @InjectRepository(SystemWallet)
    private walletRepo: Repository<SystemWallet>,

    @InjectRepository(SystemWalletTransaction)
    private txRepo: Repository<SystemWalletTransaction>,

    @InjectRepository(ExchangeRate)
    private rateRepo: Repository<ExchangeRate>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    private dataSource: DataSource,
  ) {}

  // ── CREATE WALLET ─────────────────────────────────────────────────────────────
  async create(dto: CreateSystemWalletDto, adminId: string) {
    // Prevent duplicate address
    if (dto.address) {
      const existing = await this.walletRepo.findOne({
        where: { address: dto.address },
      });
      if (existing) {
        throw new ConflictException('A wallet with this address already exists');
      }
    }

    // Encrypt address before saving
    const addressEncrypted = dto.address
      ? this.encryptAddress(dto.address)
      : null;

    const wallet = this.walletRepo.create({
      label: dto.label,
      coin: dto.coin ?? null,
      network: dto.network ?? null,
      address: dto.address ?? null,
      addressEncrypted,
      isHotWallet: dto.isHotWallet ?? true,
      minBalanceAlertUsd: dto.minBalanceAlertUsd ?? null,
      nowpaymentsWalletId: dto.nowpaymentsWalletId ?? null,
      notes: dto.notes ?? null,
      status: SystemWalletStatus.ACTIVE,
      balanceCrypto: 0,
      balanceUsdEquiv: 0,
      balanceNgnReserve: 0,
      totalFeesCollected: 0,
      totalFeesCollectedUsd: 0,
    });

    await this.walletRepo.save(wallet);

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'system_wallet.created',
      'system_wallets',
      wallet.id,
      null,
      { label: wallet.label, coin: wallet.coin, address: dto.address },
    );

    this.logger.log(`System wallet created: ${wallet.label} (${wallet.id})`);

    return {
      message: 'System wallet created successfully',
      wallet: this.sanitizeWallet(wallet),
    };
  }

  // ── GET ALL WALLETS ───────────────────────────────────────────────────────────
  async findAll(query: WalletQueryDto) {
    const qb = this.walletRepo
      .createQueryBuilder('sw')
      .orderBy('sw.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.coin) qb.andWhere('sw.coin = :coin', { coin: query.coin });
    if (query.status) qb.andWhere('sw.status = :status', { status: query.status });
    if (query.isHotWallet !== undefined) {
      qb.andWhere('sw.is_hot_wallet = :isHot', { isHot: query.isHotWallet });
    }

    const [wallets, total] = await qb.getManyAndCount();

    return {
      data: wallets.map((w) => this.sanitizeWallet(w)),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  // ── GET SINGLE WALLET ─────────────────────────────────────────────────────────
  async findOne(walletId: string) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');
    return this.sanitizeWallet(wallet);
  }

  // ── GET WALLET BY COIN ────────────────────────────────────────────────────────
  async findByCoin(coin: CoinType) {
    const wallet = await this.walletRepo.findOne({
      where: { coin, status: SystemWalletStatus.ACTIVE, isHotWallet: true },
      order: { createdAt: 'DESC' },
    });
    if (!wallet) {
      throw new NotFoundException(`No active hot wallet found for ${coin}`);
    }
    return this.sanitizeWallet(wallet);
  }

  // ── UPDATE WALLET ─────────────────────────────────────────────────────────────
  async update(walletId: string, dto: UpdateSystemWalletDto, adminId: string) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    const oldValues = {
      label: wallet.label,
      status: wallet.status,
      minBalanceAlertUsd: wallet.minBalanceAlertUsd,
    };

    await this.walletRepo.update(walletId, {
      ...(dto.label && { label: dto.label }),
      ...(dto.status && { status: dto.status }),
      ...(dto.minBalanceAlertUsd !== undefined && {
        minBalanceAlertUsd: dto.minBalanceAlertUsd,
      }),
      ...(dto.nowpaymentsWalletId !== undefined && {
        nowpaymentsWalletId: dto.nowpaymentsWalletId,
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

    const updated = await this.walletRepo.findOne({ where: { id: walletId } });
    return {
      message: 'Wallet updated successfully',
      wallet: this.sanitizeWallet(updated!),
    };
  }

  // ── RECORD TRANSACTION ────────────────────────────────────────────────────────
  // All money movements in/out of system wallets go through here
  async recordTransaction(
    walletId: string,
    dto: RecordTransactionDto,
    actorId?: string,
  ) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    if (wallet.status === SystemWalletStatus.MAINTENANCE) {
      throw new BadRequestException('Wallet is under maintenance');
    }

    // Use DB transaction for atomicity
    return await this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(SystemWallet);
      const txRepo = manager.getRepository(SystemWalletTransaction);

      // Lock the wallet row for update to prevent race conditions
      const lockedWallet = await walletRepo
        .createQueryBuilder('sw')
        .setLock('pessimistic_write')
        .where('sw.id = :id', { id: walletId })
        .getOne();

      if (!lockedWallet) throw new NotFoundException('Wallet not found');

      const balanceBefore = Number(lockedWallet.balanceCrypto);
      const amountCrypto = Number(dto.amountCrypto ?? 0);
      const amountUsd = Number(dto.amountUsd ?? 0);
      const amountNgn = Number(dto.amountNgn ?? 0);

      // Calculate new balance based on transaction type
      let newBalanceCrypto = balanceBefore;
      let newBalanceNgn = Number(lockedWallet.balanceNgnReserve);
      let newTotalFees = Number(lockedWallet.totalFeesCollected);
      let newTotalFeesUsd = Number(lockedWallet.totalFeesCollectedUsd);

      switch (dto.type) {
        case SystemWalletTransactionType.DEPOSIT:
          newBalanceCrypto += amountCrypto;
          break;

        case SystemWalletTransactionType.WITHDRAWAL:
          if (amountCrypto > balanceBefore) {
            throw new BadRequestException(
              `Insufficient balance. Available: ${balanceBefore}, Requested: ${amountCrypto}`,
            );
          }
          newBalanceCrypto -= amountCrypto;
          break;

        case SystemWalletTransactionType.FEE_CREDIT:
          newBalanceCrypto += amountCrypto;
          newTotalFees += amountCrypto;
          newTotalFeesUsd += amountUsd;
          break;

        case SystemWalletTransactionType.PAYOUT_RESERVE:
          if (amountNgn > newBalanceNgn) {
            throw new BadRequestException(
              `Insufficient NGN reserve. Available: ${newBalanceNgn}, Requested: ${amountNgn}`,
            );
          }
          newBalanceNgn -= amountNgn;
          break;

        case SystemWalletTransactionType.RECONCILIATION:
          // Reconciliation can set balance to any value
          newBalanceCrypto = amountCrypto > 0 ? amountCrypto : balanceBefore;
          if (amountNgn > 0) newBalanceNgn = amountNgn;
          break;
      }

      // Get current USD equivalent
      const latestRate = await this.getLatestRate(lockedWallet.coin);
      const usdEquiv = latestRate
        ? newBalanceCrypto * latestRate.coinUsdPrice
        : 0;

      // Update wallet balances
      await walletRepo.update(walletId, {
        balanceCrypto: newBalanceCrypto,
        balanceUsdEquiv: usdEquiv,
        balanceNgnReserve: newBalanceNgn,
        totalFeesCollected: newTotalFees,
        totalFeesCollectedUsd: newTotalFeesUsd,
        lastSyncedAt: new Date(),
      });

      // Generate idempotency reference
      const reference =
        dto.reference ||
        `SWT-${dto.type.toUpperCase()}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      // Save ledger entry
      const tx = await txRepo.save(
        txRepo.create({
          systemWalletId: walletId,
          type: dto.type,
          coin: dto.coin ?? lockedWallet.coin ?? null,
          amountCrypto,
          amountUsd,
          amountNgn,
          balanceBefore,
          balanceAfter: newBalanceCrypto,
          txHash: dto.txHash ?? null,
          transactionId: dto.transactionId ?? null,
          payoutId: dto.payoutId ?? null,
          usdRateSnapshot: dto.usdRateSnapshot ?? latestRate?.coinUsdPrice ?? null,
          description: dto.description ?? null,
          reference,
          metadata: null,
        }),
      );

      // Check low balance alert
      if (
        lockedWallet.minBalanceAlertUsd &&
        usdEquiv < lockedWallet.minBalanceAlertUsd
      ) {
        await this.triggerLowBalanceAlert(lockedWallet, usdEquiv);
      }

      if (actorId) {
        await this.saveAudit(
          actorId,
          AuditActorType.ADMIN,
          `system_wallet.${dto.type}`,
          'system_wallet_transactions',
          tx.id,
          { balanceBefore },
          { balanceAfter: newBalanceCrypto, amountCrypto, type: dto.type },
        );
      }

      this.logger.log(
        `System wallet ${dto.type}: wallet=${walletId} amount=${amountCrypto} balance=${balanceBefore}→${newBalanceCrypto}`,
      );

      return {
        message: 'Transaction recorded successfully',
        transaction: tx,
        balanceBefore,
        balanceAfter: newBalanceCrypto,
      };
    });
  }

  // ── SYNC BALANCE (from external source like NowPayments) ──────────────────────
  async syncBalance(walletId: string, dto: SyncBalanceDto, adminId: string) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    const oldBalance = {
      balanceCrypto: wallet.balanceCrypto,
      balanceUsdEquiv: wallet.balanceUsdEquiv,
      balanceNgnReserve: wallet.balanceNgnReserve,
    };

    const updateData: Partial<SystemWallet> = { lastSyncedAt: new Date() };

    if (dto.balanceCrypto !== undefined) {
      updateData.balanceCrypto = dto.balanceCrypto;

      // Auto-calculate USD equivalent
      const latestRate = await this.getLatestRate(wallet.coin);
      if (latestRate) {
        updateData.balanceUsdEquiv = dto.balanceCrypto * latestRate.coinUsdPrice;
      }

      // Record reconciliation entry if balance changed
      const diff = dto.balanceCrypto - Number(wallet.balanceCrypto);
      if (diff !== 0) {
        await this.recordTransaction(
          walletId,
          {
            type: SystemWalletTransactionType.RECONCILIATION,
            amountCrypto: Math.abs(diff),
            description: `Balance sync reconciliation: ${diff > 0 ? '+' : ''}${diff}`,
            reference: `SYNC-${Date.now()}`,
          },
          adminId,
        );
      }
    }

    if (dto.balanceUsdEquiv !== undefined) {
      updateData.balanceUsdEquiv = dto.balanceUsdEquiv;
    }

    if (dto.balanceNgnReserve !== undefined) {
      updateData.balanceNgnReserve = dto.balanceNgnReserve;
    }

    await this.walletRepo.update(walletId, updateData);

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'system_wallet.balance_synced',
      'system_wallets',
      walletId,
      oldBalance,
      dto,
    );

    const updated = await this.walletRepo.findOne({ where: { id: walletId } });
    return {
      message: 'Balance synced successfully',
      wallet: this.sanitizeWallet(updated!),
    };
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

  // ── GET PLATFORM STATS ────────────────────────────────────────────────────────
  async getPlatformStats() {
    const wallets = await this.walletRepo.find({
      where: { status: SystemWalletStatus.ACTIVE },
    });

    const totalBalanceUsd = wallets.reduce(
      (sum, w) => sum + Number(w.balanceUsdEquiv),
      0,
    );

    const totalNgnReserve = wallets.reduce(
      (sum, w) => sum + Number(w.balanceNgnReserve),
      0,
    );

    const totalFeesCollectedUsd = wallets.reduce(
      (sum, w) => sum + Number(w.totalFeesCollectedUsd),
      0,
    );

    const byCoins = wallets.reduce(
      (acc, w) => {
        if (w.coin) {
          acc[w.coin] = {
            balanceCrypto: Number(w.balanceCrypto),
            balanceUsd: Number(w.balanceUsdEquiv),
            feesCollected: Number(w.totalFeesCollected),
            feesUsd: Number(w.totalFeesCollectedUsd),
            lastSynced: w.lastSyncedAt,
          };
        }
        return acc;
      },
      {} as Record<string, any>,
    );

    // Get transaction summary (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const txSummary = await this.txRepo
      .createQueryBuilder('swt')
      .select('swt.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(swt.amount_usd)', 'totalUsd')
      .where('swt.created_at >= :since', { since: thirtyDaysAgo })
      .groupBy('swt.type')
      .getRawMany();

    return {
      totalBalanceUsd: totalBalanceUsd.toFixed(2),
      totalNgnReserve: totalNgnReserve.toFixed(2),
      totalFeesCollectedUsd: totalFeesCollectedUsd.toFixed(2),
      walletCount: wallets.length,
      byCoins,
      last30DaysTxSummary: txSummary,
    };
  }

  // ── CREDIT FEE (called after a user transaction is confirmed) ─────────────────
  async creditFee(
    coin: CoinType,
    feeCrypto: number,
    feeUsd: number,
    userTransactionId: string,
    description: string,
  ) {
    const wallet = await this.walletRepo.findOne({
      where: { coin, status: SystemWalletStatus.ACTIVE, isHotWallet: true },
    });

    if (!wallet) {
      this.logger.warn(
        `No active hot wallet found for coin ${coin} to credit fee`,
      );
      return;
    }

    await this.recordTransaction(
      wallet.id,
      {
        type: SystemWalletTransactionType.FEE_CREDIT,
        coin,
        amountCrypto: feeCrypto,
        amountUsd: feeUsd,
        transactionId: userTransactionId,
        description,
        reference: `FEE-${userTransactionId}`,
      },
    );

    this.logger.log(
      `Fee credited: ${feeCrypto} ${coin} ($${feeUsd}) for tx ${userTransactionId}`,
    );
  }

  // ── DEDUCT PAYOUT RESERVE (called before NGN payout is sent) ──────────────────
  async deductPayoutReserve(
    amountNgn: number,
    payoutId: string,
    description: string,
  ) {
    // Find NGN reserve wallet
    const wallet = await this.walletRepo.findOne({
      where: {
        status: SystemWalletStatus.ACTIVE,
        isHotWallet: true,
        coin: IsNull(),
      },
      order: { balanceNgnReserve: 'DESC' },
    });

    if (!wallet) {
      this.logger.warn('No NGN reserve wallet found');
      return;
    }

    await this.recordTransaction(
      wallet.id,
      {
        type: SystemWalletTransactionType.PAYOUT_RESERVE,
        amountNgn,
        payoutId,
        description,
        reference: `PAYOUT-RESERVE-${payoutId}`,
      },
    );
  }

  // ── TOGGLE WALLET STATUS ──────────────────────────────────────────────────────
  async toggleStatus(
    walletId: string,
    status: SystemWalletStatus,
    adminId: string,
  ) {
    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('System wallet not found');

    await this.walletRepo.update(walletId, { status });

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'system_wallet.status_changed',
      'system_wallets',
      walletId,
      { status: wallet.status },
      { status },
    );

    return {
      message: `Wallet status changed to ${status}`,
      walletId,
      status,
    };
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────
  private async getLatestRate(coin: CoinType | null) {
    if (!coin) return null;
    return this.rateRepo.findOne({
      where: { coin },
      order: { fetchedAt: 'DESC' },
    });
  }

  private async triggerLowBalanceAlert(
    wallet: SystemWallet,
    currentUsdEquiv: number,
  ) {
    this.logger.warn(
      `LOW BALANCE ALERT: wallet=${wallet.label} current=$${currentUsdEquiv} threshold=$${wallet.minBalanceAlertUsd}`,
    );

    // Get all admins and notify
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
          body: `Wallet "${wallet.label}" (${wallet.coin ?? 'NGN'}) balance is $${currentUsdEquiv.toFixed(2)}, below threshold of $${wallet.minBalanceAlertUsd}. Please top up.`,
          data: {
            walletId: wallet.id,
            coin: wallet.coin,
            currentUsdEquiv,
            threshold: wallet.minBalanceAlertUsd,
          },
        }),
      );
    }
  }

  private encryptAddress(address: string): string {
    const key = crypto.scryptSync(
      process.env.FIELD_ENCRYPTION_KEY || 'default-key',
      'salt',
      32,
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(address, 'utf8'),
      cipher.final(),
    ]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  private decryptAddress(encrypted: string): string {
    try {
      const [ivHex, encryptedHex] = encrypted.split(':');
      const key = crypto.scryptSync(
        process.env.FIELD_ENCRYPTION_KEY || 'default-key',
        'salt',
        32,
      );
      const iv = Buffer.from(ivHex, 'hex');
      const encryptedText = Buffer.from(encryptedHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([
        decipher.update(encryptedText),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      return '';
    }
  }

  private sanitizeWallet(wallet: SystemWallet) {
    const { addressEncrypted, ...safe } = wallet as any;
    return safe;
  }

  private async saveAudit(
    userId: string | null,
    actorType: AuditActorType,
    action: string,
    entityType?: string,
    entityId?: string,
    oldValues?: any,
    newValues?: any,
    ipAddress?: string,
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
        ipAddress: ipAddress ?? null,
      }),
    );
  }
}