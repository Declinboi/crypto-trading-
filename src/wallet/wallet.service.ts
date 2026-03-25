import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { nanoid } from 'nanoid';
import { Invoice } from '../entities/invoice.entity';

// import { UserWallet } from './entities/user-wallet.entity';
// import { WalletTransaction } from './entities/wallet-transaction.entity';
import { User } from '../entities/user.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { Transaction } from '../entities/transaction.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import {
  AuditActorType,
  NotificationType,
  NotificationChannel,
  TransactionStatus,
} from '../entities/enums';
import {
  TransferToUserDto,
  WithdrawTobankDto,
  FundWalletDto,
  WalletTransactionQueryDto,
  UpdateWalletTagDto,
  AdminFreezeWalletDto,
  WalletTransactionType,
  WalletStatus,
} from './dto/wallet.dto';
import { UserWallet } from 'src/entities/user-wallet.entity';
import { WalletTransaction } from 'src/entities/wallet-transaction.entity';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { QUEUE_PAYOUT, JOB_INITIATE_PAYOUT } from '../queue/queue.constants';
import { FlutterwaveService } from 'src/flutterwave/flutterwave.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(UserWallet)
    private walletRepo: Repository<UserWallet>,

    @InjectRepository(WalletTransaction)
    private walletTxRepo: Repository<WalletTransaction>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(BankAccount)
    private bankAccountRepo: Repository<BankAccount>,

    @InjectRepository(Transaction)
    private txRepo: Repository<Transaction>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectQueue(QUEUE_PAYOUT)
    private payoutQueue: Queue,
    private flutterwaveService: FlutterwaveService,
    private dataSource: DataSource,
  ) {}

  // ── CREATE WALLET (called on user registration) ───────────────────────────────
  async createWallet(userId: string): Promise<UserWallet> {
    const existing = await this.walletRepo.findOne({ where: { userId } });
    if (existing) return existing;

    const tag = await this.generateUniqueTag(userId);

    const wallet = await this.walletRepo.save(
      this.walletRepo.create({
        userId,
        tag,
        balanceNgn: 0,
        lockedBalanceNgn: 0,
        totalReceivedNgn: 0,
        totalSentNgn: 0,
        status: WalletStatus.ACTIVE,
      }),
    );

    this.logger.log(`Wallet created for user ${userId} with tag @${tag}`);
    return wallet;
  }

  // ── GET MY WALLET ─────────────────────────────────────────────────────────────
  async getMyWallet(userId: string): Promise<{
    wallet: UserWallet;
    tag: string;
    displayTag: string;
  }> {
    const wallet = await this.getOrCreateWallet(userId);
    return {
      wallet,
      tag: wallet.tag,
      displayTag: `@${wallet.tag}`,
    };
  }

  // ── GET WALLET BY TAG (for transfer lookup) ───────────────────────────────────
  async getWalletByTag(tag: string): Promise<{
    tag: string;
    displayTag: string;
    ownerName: string;
  }> {
    const cleanTag = tag.replace('@', '').toUpperCase();

    const wallet = await this.walletRepo.findOne({
      where: { tag: cleanTag },
      relations: ['user'],
    });

    if (!wallet) {
      throw new NotFoundException(`No wallet found for tag @${cleanTag}`);
    }

    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(
        'This wallet is not available to receive transfers',
      );
    }

    return {
      tag: wallet.tag,
      displayTag: `@${wallet.tag}`,
      ownerName: `${wallet.user.firstName} ${wallet.user.lastName}`,
    };
  }

  // ── UPDATE WALLET TAG ─────────────────────────────────────────────────────────
  async updateTag(
    userId: string,
    dto: UpdateWalletTagDto,
  ): Promise<UserWallet> {
    const wallet = await this.getOrCreateWallet(userId);
    const newTag = dto.tag.toUpperCase();

    // Check tag is not taken
    const existing = await this.walletRepo.findOne({
      where: { tag: newTag },
    });

    if (existing && existing.userId !== userId) {
      throw new ConflictException(`Tag @${newTag} is already taken`);
    }

    const oldTag = wallet.tag;
    await this.walletRepo.update(wallet.id, { tag: newTag });

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'wallet.tag_updated',
      'user_wallets',
      wallet.id,
      { tag: oldTag },
      { tag: newTag },
    );

    return (await this.walletRepo.findOne({
      where: { id: wallet.id },
    })) as UserWallet;
  }

  // ── CREDIT WALLET (called after payment confirmed) ────────────────────────────
  async creditWallet(
    userId: string,
    amountNgn: number,
    description: string,
    relatedTransactionId?: string,
    reference?: string,
  ): Promise<WalletTransaction> {
    return await this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(UserWallet);
      const walletTxRepo = manager.getRepository(WalletTransaction);

      // Pessimistic lock
      const wallet = await walletRepo
        .createQueryBuilder('w')
        .setLock('pessimistic_write')
        .where('w.user_id = :userId', { userId })
        .getOne();

      let targetWallet = wallet;

      if (!targetWallet) {
        // Auto-create wallet if it doesn't exist
        const tag = await this.generateUniqueTag(userId);
        targetWallet = await walletRepo.save(
          walletRepo.create({
            userId,
            tag,
            balanceNgn: 0,
            lockedBalanceNgn: 0,
            totalReceivedNgn: 0,
            totalSentNgn: 0,
            status: WalletStatus.ACTIVE,
          }),
        );
      }

      if (targetWallet.status === WalletStatus.SUSPENDED) {
        throw new ForbiddenException(
          'Wallet is suspended and cannot receive funds',
        );
      }

      const balanceBefore = Number(targetWallet.balanceNgn);
      const balanceAfter = balanceBefore + amountNgn;

      // Update wallet balance
      await walletRepo.update(targetWallet.id, {
        balanceNgn: balanceAfter,
        totalReceivedNgn: Number(targetWallet.totalReceivedNgn) + amountNgn,
        lastTransactionAt: new Date(),
      });

      // Create ledger entry
      const txRecord = await walletTxRepo.save(
        walletTxRepo.create({
          walletId: targetWallet.id,
          type: WalletTransactionType.CREDIT,
          amount: amountNgn,
          balanceBefore,
          balanceAfter,
          reference: reference ?? this.generateReference('CREDIT'),
          description,
          relatedTransactionId: relatedTransactionId ?? null,
          metadata: { creditedAt: new Date() },
        }),
      );

      this.logger.log(
        `Wallet credited: userId=${userId} amount=₦${amountNgn} balance=${balanceBefore}→${balanceAfter}`,
      );

      return txRecord;
    });
  }

  // ── TRANSFER TO USER ──────────────────────────────────────────────────────────
  async transferToUser(
    senderId: string,
    dto: TransferToUserDto,
  ): Promise<{
    reference: string;
    amount: number;
    fee: number;
    recipientTag: string;
    recipientName: string;
    senderNewBalance: number;
  }> {
    // Validate PIN first (outside transaction for performance)
    const sender = await this.userRepo.findOne({
      where: { id: senderId },
      select: ['id', 'pinHash', 'isPinSet', 'firstName', 'lastName'],
    });

    if (!sender) throw new NotFoundException('User not found');

    if (!sender.isPinSet || !sender.pinHash) {
      throw new BadRequestException(
        'Please set a transaction PIN before making transfers',
      );
    }

    const pinValid = await argon2.verify(sender.pinHash, dto.pin);
    if (!pinValid) throw new BadRequestException('Incorrect PIN');

    // Resolve recipient
    const recipientTag = dto.recipientTag.replace('@', '').toUpperCase();

    const recipientWallet = await this.walletRepo.findOne({
      where: { tag: recipientTag },
      relations: ['user'],
    });

    if (!recipientWallet) {
      throw new NotFoundException(`No wallet found for tag @${recipientTag}`);
    }

    if (recipientWallet.userId === senderId) {
      throw new BadRequestException('You cannot transfer to your own wallet');
    }

    if (recipientWallet.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException('Recipient wallet is not available');
    }

    const senderWallet = await this.getOrCreateWallet(senderId);

    if (senderWallet.status === WalletStatus.FROZEN) {
      throw new ForbiddenException('Your wallet is frozen. Contact support.');
    }

    if (senderWallet.status === WalletStatus.SUSPENDED) {
      throw new ForbiddenException(
        'Your wallet is suspended. Contact support.',
      );
    }

    const totalDebit = dto.amount; // free transfers — no fee
    const availableBalance = Number(senderWallet.balanceNgn);

    if (availableBalance < totalDebit) {
      throw new BadRequestException(
        `Insufficient balance. Available: ₦${availableBalance.toLocaleString('en-NG')}, Required: ₦${totalDebit.toLocaleString('en-NG')} (₦${dto.amount} fee)`,
      );
    }

    const reference = this.generateReference('TRF');
    const recipientName = `${recipientWallet.user.firstName} ${recipientWallet.user.lastName}`;

    // Execute transfer atomically
    const result = await this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(UserWallet);
      const walletTxRepo = manager.getRepository(WalletTransaction);

      // Lock both wallets in consistent order (prevent deadlocks)
      const [w1Id, w2Id] = [senderWallet.id, recipientWallet.id].sort();

      const lockedWallets = await walletRepo
        .createQueryBuilder('w')
        .setLock('pessimistic_write')
        .where('w.id IN (:...ids)', { ids: [w1Id, w2Id] })
        .getMany();

      const lockedSender = lockedWallets.find((w) => w.id === senderWallet.id);
      const lockedRecipient = lockedWallets.find(
        (w) => w.id === recipientWallet.id,
      );

      if (!lockedSender || !lockedRecipient) {
        throw new NotFoundException('Wallet not found during transfer');
      }

      // Re-validate balance with locked data
      const senderBalance = Number(lockedSender.balanceNgn);
      if (senderBalance < totalDebit) {
        throw new BadRequestException('Insufficient balance');
      }

      const senderBalanceBefore = senderBalance;
      const senderBalanceAfter = senderBalance - totalDebit;

      const recipientBalanceBefore = Number(lockedRecipient.balanceNgn);
      const recipientBalanceAfter = recipientBalanceBefore + dto.amount;

      // Debit sender
      await walletRepo.update(lockedSender.id, {
        balanceNgn: senderBalanceAfter,
        totalSentNgn: Number(lockedSender.totalSentNgn) + dto.amount,
        lastTransactionAt: new Date(),
      });

      // Credit recipient
      await walletRepo.update(lockedRecipient.id, {
        balanceNgn: recipientBalanceAfter,
        totalReceivedNgn: Number(lockedRecipient.totalReceivedNgn) + dto.amount,
        lastTransactionAt: new Date(),
      });

      // Sender ledger entry (debit + fee in one entry)
      await walletTxRepo.save(
        walletTxRepo.create({
          walletId: lockedSender.id,
          type: WalletTransactionType.TRANSFER_OUT,
          amount: totalDebit,
          balanceBefore: senderBalanceBefore,
          balanceAfter: senderBalanceAfter,
          reference: `${reference}-OUT`,
          description: `Transfer to @${recipientTag}${dto.note ? ` — ${dto.note}` : ''}`,
          counterpartWalletId: lockedRecipient.id,
          counterpartTag: recipientTag,
          metadata: {
            transferAmount: dto.amount,
            fee: 0, // free transfers — no fee
            note: dto.note ?? null,
            recipientName,
          },
        }),
      );

      // Recipient ledger entry (credit)
      await walletTxRepo.save(
        walletTxRepo.create({
          walletId: lockedRecipient.id,
          type: WalletTransactionType.TRANSFER_IN,
          amount: dto.amount,
          balanceBefore: recipientBalanceBefore,
          balanceAfter: recipientBalanceAfter,
          reference: `${reference}-IN`,
          description: `Transfer from @${senderWallet.tag}${dto.note ? ` — ${dto.note}` : ''}`,
          counterpartWalletId: lockedSender.id,
          counterpartTag: senderWallet.tag,
          metadata: {
            transferAmount: dto.amount,
            note: dto.note ?? null,
            senderName: `${sender.firstName} ${sender.lastName}`,
          },
        }),
      );

      return { senderBalanceAfter };
    });

    // Notify both parties
    await this.sendNotification(
      senderId,
      NotificationType.PAYOUT_SENT,
      'Transfer Sent ✅',
      `₦${dto.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} sent to @${recipientTag} (${recipientName}). New balance: ₦${result.senderBalanceAfter.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
      {
        type: 'transfer_out',
        amount: dto.amount,
        fee: 0, // free transfers — no fee
        recipientTag,
        recipientName,
        reference,
        newBalance: result.senderBalanceAfter,
      },
    );

    await this.sendNotification(
      recipientWallet.userId,
      NotificationType.INVOICE_PAID,
      'Money Received 💰',
      `₦${dto.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} received from @${senderWallet.tag} (${sender.firstName} ${sender.lastName})${dto.note ? `. Note: "${dto.note}"` : ''}`,
      {
        type: 'transfer_in',
        amount: dto.amount,
        senderTag: senderWallet.tag,
        senderName: `${sender.firstName} ${sender.lastName}`,
        note: dto.note ?? null,
        reference,
      },
    );

    await this.saveAudit(
      senderId,
      AuditActorType.USER,
      'wallet.transfer',
      'wallet_transactions',
      reference,
      null,
      {
        amount: dto.amount,
        fee: 0,
        recipientTag,
        reference,
      },
    );

    this.logger.log(
      `Transfer: ${senderWallet.tag} → ${recipientTag} ₦${dto.amount} ref=${reference}`,
    );

    return {
      reference,
      amount: dto.amount,
      fee: 0, // free transfers — no fee
      recipientTag,
      recipientName,
      senderNewBalance: result.senderBalanceAfter,
    };
  }

  async withdrawToBank(
    userId: string,
    dto: WithdrawTobankDto,
  ): Promise<{
    message: string;
    jobId: string | number;
    reference: string;
    amount: number;
    bankAccount: string;
  }> {
    // ── Validate PIN ─────────────────────────────────────────────────────────────
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'pinHash', 'isPinSet'],
    });

    if (!user?.isPinSet || !user?.pinHash) {
      throw new BadRequestException('Please set a PIN before withdrawing');
    }

    const pinValid = await argon2.verify(user.pinHash, dto.pin);
    if (!pinValid) throw new BadRequestException('Incorrect PIN');

    // ── Validate wallet ──────────────────────────────────────────────────────────
    const wallet = await this.getOrCreateWallet(userId);

    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new ForbiddenException(
        `Wallet is ${wallet.status}. Contact support.`,
      );
    }

    const availableBalance =
      Number(wallet.balanceNgn) - Number(wallet.lockedBalanceNgn);

    if (availableBalance < dto.amount) {
      throw new BadRequestException(
        `Insufficient balance. Available: ₦${availableBalance.toLocaleString('en-NG')}`,
      );
    }

    // ── Validate bank account ────────────────────────────────────────────────────
    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: dto.bankAccountId, userId },
    });

    if (!bankAccount) throw new NotFoundException('Bank account not found');

    if (!bankAccount.isVerified) {
      throw new BadRequestException('Bank account is not verified');
    }

    const reference = this.generateReference('WDR');

    // ── Debit wallet and lock funds atomically ───────────────────────────────────
    await this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(UserWallet);
      const walletTxRepo = manager.getRepository(WalletTransaction);

      const lockedWallet = await walletRepo
        .createQueryBuilder('w')
        .setLock('pessimistic_write')
        .where('w.id = :id', { id: wallet.id })
        .getOne();

      if (!lockedWallet) throw new NotFoundException('Wallet not found');

      const available =
        Number(lockedWallet.balanceNgn) - Number(lockedWallet.lockedBalanceNgn);

      if (available < dto.amount) {
        throw new BadRequestException('Insufficient available balance');
      }

      const balanceBefore = Number(lockedWallet.balanceNgn);
      const balanceAfter = balanceBefore - dto.amount;

      await walletRepo.update(wallet.id, {
        balanceNgn: balanceAfter,
        totalSentNgn: Number(lockedWallet.totalSentNgn) + dto.amount,
        lastTransactionAt: new Date(),
      });

      await walletTxRepo.save(
        walletTxRepo.create({
          walletId: wallet.id,
          type: WalletTransactionType.PAYOUT,
          amount: dto.amount,
          balanceBefore,
          balanceAfter,
          reference,
          description: `Withdrawal to ${bankAccount.bankName} ****${bankAccount.accountNumber.slice(-4)}`,
          metadata: {
            bankAccountId: dto.bankAccountId,
            bankName: bankAccount.bankName,
            accountNumber: bankAccount.accountNumber,
            narration: dto.narration ?? null,
          },
        }),
      );
    });

    // ── Trigger Monnify payout directly ──────────────────────────────────────
    // No synthetic transaction needed — wallet NGN is already converted and final
    try {
      const payoutJob = await this.payoutQueue.add(
        JOB_INITIATE_PAYOUT,
        {
          userId: userId,
          amountNgn: dto.amount,
          bankAccountId: dto.bankAccountId,
          narration: dto.narration ?? 'CryptoPay NG wallet withdrawal',
          reference,
          isAutoCashout: false,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          jobId: `payout-wallet-${reference}`,
        },
      );

      return {
        message: 'Withdrawal queued successfully',
        jobId: payoutJob.id,
        reference,
        amount: dto.amount,
        bankAccount: `${bankAccount.bankName} ****${bankAccount.accountNumber.slice(-4)}`,
      };
    } catch (err) {
      // ── Reverse the debit if payout fails ───────────────────────────────────────
      await this.dataSource.transaction(async (manager) => {
        const walletRepo = manager.getRepository(UserWallet);
        const walletTxRepo = manager.getRepository(WalletTransaction);

        const current = await walletRepo.findOne({ where: { id: wallet.id } });
        if (!current) return;

        const reversalBalance = Number(current.balanceNgn) + dto.amount;

        await walletRepo.update(wallet.id, {
          balanceNgn: reversalBalance,
          totalSentNgn: Math.max(0, Number(current.totalSentNgn) - dto.amount),
        });

        await walletTxRepo.save(
          walletTxRepo.create({
            walletId: wallet.id,
            type: WalletTransactionType.REVERSAL,
            amount: dto.amount,
            balanceBefore: Number(current.balanceNgn),
            balanceAfter: reversalBalance,
            reference: this.generateReference('REV'),
            description: `Reversal of failed withdrawal ${reference}`,
            metadata: { originalReference: reference, error: err.message },
          }),
        );
      });

      throw err;
    }
  }

  // ── GET WALLET TRANSACTIONS ───────────────────────────────────────────────────
  async getTransactions(userId: string, query: WalletTransactionQueryDto) {
    const wallet = await this.getOrCreateWallet(userId);

    const qb = this.walletTxRepo
      .createQueryBuilder('wt')
      .where('wt.wallet_id = :walletId', { walletId: wallet.id })
      .orderBy('wt.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.type) {
      qb.andWhere('wt.type = :type', { type: query.type });
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

  // ── GET WALLET SUMMARY ────────────────────────────────────────────────────────
  async getWalletSummary(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const stats = await this.walletTxRepo
      .createQueryBuilder('wt')
      .select('wt.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(wt.amount)', 'total')
      .where('wt.wallet_id = :walletId', { walletId: wallet.id })
      .andWhere('wt.created_at >= :since', { since: thirtyDaysAgo })
      .groupBy('wt.type')
      .getRawMany();

    return {
      balance: Number(wallet.balanceNgn),
      lockedBalance: Number(wallet.lockedBalanceNgn),
      availableBalance:
        Number(wallet.balanceNgn) - Number(wallet.lockedBalanceNgn),
      tag: wallet.tag,
      displayTag: `@${wallet.tag}`,
      totalReceivedNgn: Number(wallet.totalReceivedNgn),
      totalSentNgn: Number(wallet.totalSentNgn),
      status: wallet.status,
      last30DaysStats: stats,
      lastTransactionAt: wallet.lastTransactionAt,
    };
  }

  // ── ADMIN: GET ALL WALLETS ────────────────────────────────────────────────────
  async adminGetAllWallets(page = 1, limit = 20) {
    const [wallets, total] = await this.walletRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.user', 'u')
      .orderBy('w.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: wallets,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── ADMIN: FREEZE / UNFREEZE WALLET ──────────────────────────────────────────
  async adminFreezeWallet(
    walletId: string,
    dto: AdminFreezeWalletDto,
    adminId: string,
  ) {
    const wallet = await this.walletRepo.findOne({
      where: { id: walletId },
      relations: ['user'],
    });

    if (!wallet) throw new NotFoundException('Wallet not found');

    const oldStatus = wallet.status;

    await this.walletRepo.update(walletId, {
      status: dto.status,
      freezeReason: dto.reason ?? null,
      frozenAt: dto.status === WalletStatus.FROZEN ? new Date() : null,
    });

    await this.sendNotification(
      wallet.userId,
      NotificationType.KYC_REJECTED,
      dto.status === WalletStatus.FROZEN
        ? 'Wallet Frozen ❄️'
        : dto.status === WalletStatus.SUSPENDED
          ? 'Wallet Suspended 🚫'
          : 'Wallet Reactivated ✅',
      dto.status === WalletStatus.ACTIVE
        ? 'Your wallet has been reactivated. You can now make transactions.'
        : `Your wallet has been ${dto.status}. ${dto.reason ? `Reason: ${dto.reason}.` : ''} Please contact support.`,
    );

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      `wallet.${dto.status}`,
      'user_wallets',
      walletId,
      { status: oldStatus },
      { status: dto.status, reason: dto.reason },
    );

    return {
      message: `Wallet ${dto.status} successfully`,
      walletId,
      status: dto.status,
    };
  }

  // ── ADMIN: PLATFORM WALLET STATS ─────────────────────────────────────────────
  async adminGetStats() {
    const totalStats = await this.walletRepo
      .createQueryBuilder('w')
      .select('COUNT(*)', 'totalWallets')
      .addSelect('SUM(w.balance_ngn)', 'totalBalanceNgn')
      .addSelect('SUM(w.total_received_ngn)', 'totalReceivedNgn')
      .addSelect('SUM(w.total_sent_ngn)', 'totalSentNgn')
      .getRawOne();

    const statusBreakdown = await this.walletRepo
      .createQueryBuilder('w')
      .select('w.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('w.status')
      .getRawMany();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTransfers = await this.walletTxRepo
      .createQueryBuilder('wt')
      .select('COUNT(*)', 'count')
      .addSelect('SUM(wt.amount)', 'totalNgn')
      .where('wt.created_at >= :today', { today })
      .andWhere('wt.type = :type', { type: WalletTransactionType.TRANSFER_OUT })
      .getRawOne();

    return {
      totalWallets: Number(totalStats?.totalWallets ?? 0),
      totalBalanceNgn: Number(totalStats?.totalBalanceNgn ?? 0),
      totalReceivedNgn: Number(totalStats?.totalReceivedNgn ?? 0),
      totalSentNgn: Number(totalStats?.totalSentNgn ?? 0),
      statusBreakdown,
      todayTransfers: {
        count: Number(todayTransfers?.count ?? 0),
        totalNgn: Number(todayTransfers?.totalNgn ?? 0),
      },
    };
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────
  async getOrCreateWallet(userId: string): Promise<UserWallet> {
    let wallet = await this.walletRepo.findOne({ where: { userId } });
    if (!wallet) {
      wallet = await this.createWallet(userId);
    }
    return wallet;
  }

  private async generateUniqueTag(userId: string): Promise<string> {
    // Try to use part of the user's name + random suffix
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['firstName'],
    });

    const prefix = user?.firstName
      ? user.firstName
          .replace(/[^a-zA-Z]/g, '')
          .substring(0, 4)
          .toUpperCase()
      : 'USER';

    let tag: string;
    let exists: UserWallet | null;
    let attempts = 0;

    do {
      const suffix = nanoid(6)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '0');
      tag = `${prefix}${suffix}`;
      exists = await this.walletRepo.findOne({ where: { tag } });
      attempts++;
      if (attempts > 10) {
        // Full random fallback
        tag = nanoid(10)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '0');
        exists = await this.walletRepo.findOne({ where: { tag } });
      }
    } while (exists);

    return tag;
  }

  private generateReference(prefix: string): string {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private async getSystemInvoiceId(): Promise<string> {
    // Returns a system invoice ID for wallet withdrawals
    // In production you'd have a dedicated system invoice

    const invoiceRepo = this.dataSource.getRepository(Invoice);
    const systemInvoice = await invoiceRepo.findOne({
      where: { invoiceNumber: 'SYS-WALLET-001' },
    });
    if (systemInvoice) return systemInvoice.id;
    // Fallback: return a zeroed UUID
    return '00000000-0000-0000-0000-000000000000';
  }

  private async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, any>,
  ) {
    await this.notifRepo.save([
      this.notifRepo.create({
        userId,
        type,
        channel: NotificationChannel.IN_APP,
        title,
        body,
        data: data ?? null,
      }),
      this.notifRepo.create({
        userId,
        type,
        channel: NotificationChannel.EMAIL,
        title,
        body,
        data: data ?? null,
      }),
    ]);
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
