import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { Payout } from '../entities/payout.entity';
import { Transaction } from '../entities/transaction.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { Invoice } from '../entities/invoice.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';
import { SystemWalletService } from '../system-wallet/system-wallet.service';
import {
  PayoutStatus,
  TransactionStatus,
  WebhookSource,
  AuditActorType,
  NotificationType,
  NotificationChannel,
  SystemWalletTransactionType,
} from '../entities/enums';
import {
  InitiatePayoutDto,
  VerifyBankAccountDto,
  FlutterwaveWebhookDto,
  PayoutQueryDto,
} from './dto/flutterwave.dto';

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly client: AxiosInstance;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly MAX_RETRIES = 3;

  constructor(
    private config: ConfigService,

    @InjectRepository(Payout)
    private payoutRepo: Repository<Payout>,

    @InjectRepository(Transaction)
    private txRepo: Repository<Transaction>,

    @InjectRepository(BankAccount)
    private bankAccountRepo: Repository<BankAccount>,

    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,

    @InjectRepository(WebhookEvent)
    private webhookRepo: Repository<WebhookEvent>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    private systemWalletService: SystemWalletService,
    private dataSource: DataSource,
  ) {
    this.secretKey = config.get<string>('FLUTTERWAVE_SECRET_KEY') as string;
    this.webhookSecret = config.get<string>(
      'FLUTTERWAVE_WEBHOOK_SECRET',
    ) as string;

    this.client = axios.create({
      baseURL: 'https://api.flutterwave.com/v3',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  // ── VERIFY BANK ACCOUNT ───────────────────────────────────────────────────────
  async verifyBankAccount(dto: VerifyBankAccountDto): Promise<{
    accountName: string;
    accountNumber: string;
    bankCode: string;
  }> {
    try {
      const res = await this.client.post('/accounts/resolve', {
        account_number: dto.accountNumber,
        account_bank: dto.bankCode,
      });

      if (res.data.status !== 'success') {
        throw new BadRequestException('Bank account verification failed');
      }

      return {
        accountName: res.data.data.account_name,
        accountNumber: res.data.data.account_number,
        bankCode: dto.bankCode,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Bank verification failed: ${err.message}`);
      throw new BadRequestException(
        err.response?.data?.message ?? 'Unable to verify bank account',
      );
    }
  }

  // ── GET NIGERIAN BANKS LIST ───────────────────────────────────────────────────
  async getBanks(): Promise<{ name: string; code: string }[]> {
    try {
      const res = await this.client.get('/banks/NG');
      return (res.data.data ?? []).map((bank: any) => ({
        name: bank.name,
        code: bank.code,
      }));
    } catch (err) {
      this.logger.error(`Failed to fetch banks: ${err.message}`);
      throw new InternalServerErrorException('Failed to fetch bank list');
    }
  }

  // ── INITIATE PAYOUT Admin only───────────────────────────────────────────────────────────
  private async initiatePayout(
    dto: InitiatePayoutDto,
    userId: string,
  ): Promise<Payout> {
    const transaction = await this.txRepo.findOne({
      where: { id: dto.transactionId, userId },
      relations: ['invoice'],
    });

    if (!transaction) throw new NotFoundException('Transaction not found');

    if (transaction.status !== TransactionStatus.CONFIRMED) {
      throw new BadRequestException(
        `Transaction must be confirmed before payout. Current status: ${transaction.status}`,
      );
    }

    const existingPayout = await this.payoutRepo.findOne({
      where: { transactionId: dto.transactionId },
    });

    if (existingPayout) {
      if (existingPayout.status === PayoutStatus.SUCCESS) {
        throw new ConflictException(
          'Payout already completed for this transaction',
        );
      }
      if (existingPayout.status === PayoutStatus.PROCESSING) {
        throw new ConflictException(
          'Payout already in progress for this transaction',
        );
      }
      if (existingPayout.status === PayoutStatus.FAILED) {
        return this.retryPayout(existingPayout.id, userId);
      }
    }

    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: dto.bankAccountId, userId },
    });

    if (!bankAccount) throw new NotFoundException('Bank account not found');

    if (!bankAccount.isVerified) {
      throw new BadRequestException(
        'Bank account must be verified before receiving payouts',
      );
    }

    const netNgnAmount = Number(
      transaction.netNgnAmount ?? transaction.ngnAmount,
    );
    if (!netNgnAmount || netNgnAmount <= 0) {
      throw new BadRequestException(
        'Invalid payout amount. Transaction may not have been fully processed.',
      );
    }

    // ── FEE BREAKDOWN ──────────────────────────────────────────────────────────
    // 1. Platform fixed payout fee — ₦50 charged to system wallet revenue
    const PLATFORM_PAYOUT_FEE_NGN = await this.getPayoutFeeNgn();

    // 2. Flutterwave transfer fee — fetched live, passed to Flutterwave
    const flwFee = await this.getTransferFee(netNgnAmount);

    // 3. Total deductions from user's NGN amount
    const totalFeeNgn = PLATFORM_PAYOUT_FEE_NGN + flwFee;

    // 4. What the user actually receives in their bank
    const finalNetAmount = netNgnAmount - totalFeeNgn;

    if (finalNetAmount <= 0) {
      throw new BadRequestException(
        `Payout amount too small after fees. Net: ₦${netNgnAmount}, Platform fee: ₦${PLATFORM_PAYOUT_FEE_NGN}, Flutterwave fee: ₦${flwFee}, Total fee: ₦${totalFeeNgn}`,
      );
    }

    this.logger.log(
      `Payout fee breakdown: net_ngn=₦${netNgnAmount} platform_fee=₦${PLATFORM_PAYOUT_FEE_NGN} flw_fee=₦${flwFee} total_fee=₦${totalFeeNgn} user_receives=₦${finalNetAmount}`,
    );

    const flwReference = `CPAY-${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`;

    const narration =
      dto.narration ??
      `CryptoPay NG payout - Invoice ${(transaction.invoice as any)?.invoiceNumber ?? transaction.invoiceId}`;

    // Create payout record — store both fees separately for transparency
    const payout = await this.payoutRepo.save(
      this.payoutRepo.create({
        transactionId: dto.transactionId,
        userId,
        bankAccountId: dto.bankAccountId,
        amountNgn: netNgnAmount, // gross amount before any fees
        feeNgn: totalFeeNgn, // total fee (platform + flw)
        netAmountNgn: finalNetAmount, // what user receives
        status: PayoutStatus.PROCESSING,
        flwReference,
        narration,
        retryCount: 0,
        metadata: {
          platformPayoutFeeNgn: PLATFORM_PAYOUT_FEE_NGN,
          flutterwaveFeeNgn: flwFee,
          totalFeeNgn,
        } as any,
      }),
    );

    // ── CREDIT PLATFORM PAYOUT FEE TO SYSTEM WALLET ────────────────────────────
    // This is separate from the crypto transaction fee — it's a fixed NGN fee
    // credited as a PAYOUT_RESERVE entry to track platform payout revenue
    try {
      await this.creditPayoutFeeToSystemWallet(
        PLATFORM_PAYOUT_FEE_NGN,
        payout.id,
        transaction.id,
        (transaction.invoice as any)?.invoiceNumber ?? transaction.invoiceId,
      );
    } catch (err) {
      // Non-blocking — don't fail the payout if fee credit fails
      this.logger.error(
        `Failed to credit payout fee to system wallet: ${err.message}`,
      );
    }

    // Execute transfer
    try {
      const transfer = await this.executeTransfer({
        accountNumber: bankAccount.accountNumber,
        bankCode: bankAccount.bankCode,
        amount: finalNetAmount,
        narration,
        reference: flwReference,
        currency: 'NGN',
      });

      await this.payoutRepo.update(payout.id, {
        flwTransferId: String(transfer.id),
        flwStatus: transfer.status,
        status:
          transfer.status === 'SUCCESSFUL'
            ? PayoutStatus.SUCCESS
            : PayoutStatus.PROCESSING,
        ...(transfer.status === 'SUCCESSFUL' && { completedAt: new Date() }),
      });

      // Deduct full gross NGN amount from reserve
      await this.systemWalletService.deductPayoutReserve(
        netNgnAmount,
        payout.id,
        `NGN reserve deduction for payout ${payout.id} — user receives ₦${finalNetAmount}`,
      );

      await this.saveAudit(
        userId,
        AuditActorType.SYSTEM,
        'payout.initiated',
        'payouts',
        payout.id,
        null,
        {
          grossAmount: netNgnAmount,
          platformFee: PLATFORM_PAYOUT_FEE_NGN,
          flwFee,
          userReceives: finalNetAmount,
          bankAccount: bankAccount.accountNumber,
          flwReference,
          transferId: transfer.id,
        },
      );

      this.logger.log(
        `Payout initiated: payoutId=${payout.id} user_receives=₦${finalNetAmount} ref=${flwReference}`,
      );

      if (transfer.status === 'SUCCESSFUL') {
        await this.sendNotification(
          userId,
          NotificationType.PAYOUT_SENT,
          'Payout Sent ✅',
          `₦${finalNetAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} has been sent to your ${bankAccount.bankName} account ending in ${bankAccount.accountNumber.slice(-4)}. (Fee charged: ₦${totalFeeNgn})`,
          {
            payoutId: payout.id,
            grossAmount: netNgnAmount,
            platformFee: PLATFORM_PAYOUT_FEE_NGN,
            flwFee,
            amountReceived: finalNetAmount,
            bankName: bankAccount.bankName,
            accountNumber: bankAccount.accountNumber,
          },
        );
      } else {
        await this.sendNotification(
          userId,
          NotificationType.PAYOUT_SENT,
          'Payout Processing 🔄',
          `Your payout of ₦${finalNetAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} is being processed. You will be notified once completed.`,
          { payoutId: payout.id, amount: finalNetAmount },
        );
      }

      return (await this.payoutRepo.findOne({
        where: { id: payout.id },
      })) as Payout;
    } catch (err) {
      await this.payoutRepo.update(payout.id, {
        status: PayoutStatus.FAILED,
        failureReason: err.message,
      });

      await this.sendNotification(
        userId,
        NotificationType.PAYOUT_FAILED,
        'Payout Failed ❌',
        `Your payout of ₦${finalNetAmount.toLocaleString('en-NG')} failed. Reason: ${err.message}. Please contact support.`,
        { payoutId: payout.id, error: err.message },
      );

      this.logger.error(
        `Payout failed: payoutId=${payout.id} error=${err.message}`,
      );

      throw new InternalServerErrorException(`Payout failed: ${err.message}`);
    }
  }

  // ── INITIATE DIRECT PAYOUT (from user wallet withdrawal) ─────────────────────
  async initiateDirectPayout(params: {
    userId: string;
    amountNgn: number;
    bankAccountId: string;
    narration: string;
    reference: string;
  }): Promise<Payout> {
    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: params.bankAccountId, userId: params.userId },
    });

    if (!bankAccount) throw new NotFoundException('Bank account not found');
    if (!bankAccount.isVerified) {
      throw new BadRequestException('Bank account is not verified');
    }

    // Platform fee + Flutterwave fee
    const platformFee = await this.getPayoutFeeNgn();
    const flwFee = await this.getTransferFee(params.amountNgn);
    const totalFee = platformFee + flwFee;
    const netAmount = params.amountNgn - totalFee;

    if (netAmount <= 0) {
      throw new BadRequestException(
        `Amount too small after fees. Amount: ₦${params.amountNgn}, Fees: ₦${totalFee}`,
      );
    }

    const flwReference = `CPAY-WDR-${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;

    const payout = await this.payoutRepo.save(
      this.payoutRepo.create({
        // No transactionId — this is a direct wallet withdrawal
        transactionId: null,
        userId: params.userId,
        bankAccountId: params.bankAccountId,
        amountNgn: params.amountNgn,
        feeNgn: totalFee,
        netAmountNgn: netAmount,
        status: PayoutStatus.PROCESSING,
        flwReference,
        narration: params.narration,
        retryCount: 0,
        metadata: {
          source: 'wallet_withdrawal',
          walletReference: params.reference,
          platformFee,
          flwFee,
        } as any,
      }),
    );

    // Credit platform fee to system wallet
    try {
      await this.creditPayoutFeeToSystemWallet(
        platformFee,
        payout.id,
        null,
        `wallet-withdrawal-${params.reference}`,
      );
    } catch (err) {
      this.logger.error(`Failed to credit payout fee: ${err.message}`);
    }

    try {
      const transfer = await this.executeTransfer({
        accountNumber: bankAccount.accountNumber,
        bankCode: bankAccount.bankCode,
        amount: netAmount,
        narration: params.narration,
        reference: flwReference,
        currency: 'NGN',
      });

      await this.payoutRepo.update(payout.id, {
        flwTransferId: String(transfer.id),
        flwStatus: transfer.status,
        status:
          transfer.status === 'SUCCESSFUL'
            ? PayoutStatus.SUCCESS
            : PayoutStatus.PROCESSING,
        ...(transfer.status === 'SUCCESSFUL' && { completedAt: new Date() }),
      });

      // Deduct from NGN reserve
      await this.systemWalletService.deductPayoutReserve(
        params.amountNgn,
        payout.id,
        `Wallet withdrawal payout ${payout.id}`,
      );

      await this.sendNotification(
        params.userId,
        NotificationType.PAYOUT_SENT,
        'Withdrawal Processing 🔄',
        `₦${netAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} is being sent to your ${bankAccount.bankName} account ending in ${bankAccount.accountNumber.slice(-4)}.`,
        {
          payoutId: payout.id,
          grossAmount: params.amountNgn,
          platformFee,
          flwFee,
          amountReceived: netAmount,
        },
      );

      return (await this.payoutRepo.findOne({
        where: { id: payout.id },
      })) as Payout;
    } catch (err) {
      await this.payoutRepo.update(payout.id, {
        status: PayoutStatus.FAILED,
        failureReason: err.message,
      });
      throw new InternalServerErrorException(
        `Withdrawal payout failed: ${err.message}`,
      );
    }
  }

  // ── RETRY PAYOUT ──────────────────────────────────────────────────────────────
  async retryPayout(payoutId: string, userId: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({
      where: { id: payoutId, userId },
      relations: ['bankAccount'],
    });

    if (!payout) throw new NotFoundException('Payout not found');

    if (payout.status === PayoutStatus.SUCCESS) {
      throw new ConflictException('Payout already completed');
    }

    if (payout.status === PayoutStatus.PROCESSING) {
      throw new ConflictException('Payout already processing');
    }

    if (payout.retryCount >= this.MAX_RETRIES) {
      throw new BadRequestException(
        `Maximum retry attempts (${this.MAX_RETRIES}) reached. Please contact support.`,
      );
    }

    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: payout.bankAccountId },
    });

    if (!bankAccount) throw new NotFoundException('Bank account not found');

    // Generate new reference for retry
    const newReference = `CPAY-RETRY-${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;

    await this.payoutRepo.update(payoutId, {
      status: PayoutStatus.PROCESSING,
      flwReference: newReference,
      retryCount: payout.retryCount + 1,
      lastRetryAt: new Date(),
      failureReason: null,
    });

    try {
      const transfer = await this.executeTransfer({
        accountNumber: bankAccount.accountNumber,
        bankCode: bankAccount.bankCode,
        amount: Number(payout.netAmountNgn),
        narration: payout.narration ?? 'CryptoPay NG payout retry',
        reference: newReference,
        currency: 'NGN',
      });

      await this.payoutRepo.update(payoutId, {
        flwTransferId: String(transfer.id),
        flwStatus: transfer.status,
        status:
          transfer.status === 'SUCCESSFUL'
            ? PayoutStatus.SUCCESS
            : PayoutStatus.PROCESSING,
        ...(transfer.status === 'SUCCESSFUL' && { completedAt: new Date() }),
      });

      this.logger.log(
        `Payout retry ${payout.retryCount + 1}: payoutId=${payoutId} ref=${newReference}`,
      );

      return (await this.payoutRepo.findOne({
        where: { id: payoutId },
      })) as Payout;
    } catch (err) {
      await this.payoutRepo.update(payoutId, {
        status: PayoutStatus.FAILED,
        failureReason: err.message,
      });
      throw new InternalServerErrorException(`Retry failed: ${err.message}`);
    }
  }

  // ── PROCESS FLUTTERWAVE WEBHOOK ───────────────────────────────────────────────
  async processWebhook(
    rawPayload: string,
    signature: string,
    dto: FlutterwaveWebhookDto,
  ): Promise<{ received: boolean }> {
    // Verify webhook signature
    const isValid = this.verifyWebhookSignature(rawPayload, signature);
    if (!isValid) {
      this.logger.warn(
        `Invalid Flutterwave webhook signature for event=${dto.event}`,
      );
    }

    const idempotencyKey = `flw-${dto.data?.id}-${dto.event}-${dto.data?.status}`;

    const existingEvent = await this.webhookRepo.findOne({
      where: { idempotencyKey },
    });

    if (existingEvent?.processed) {
      this.logger.log(
        `Duplicate Flutterwave webhook ignored: ${idempotencyKey}`,
      );
      return { received: true };
    }

    // Save webhook event
    const webhookEvent = await this.webhookRepo.save(
      this.webhookRepo.create({
        source: WebhookSource.FLUTTERWAVE,
        eventType: dto.event,
        externalRef: String(dto.data?.id),
        payload: JSON.parse(rawPayload),
        signatureValid: isValid,
        processed: false,
        idempotencyKey,
      }),
    );

    try {
      await this.handleTransferEvent(dto);

      await this.webhookRepo.update(webhookEvent.id, {
        processed: true,
        processedAt: new Date(),
      });

      this.logger.log(
        `Flutterwave webhook processed: event=${dto.event} transferId=${dto.data?.id}`,
      );
    } catch (err) {
      this.logger.error(
        `Flutterwave webhook processing failed: ${err.message}`,
        err.stack,
      );
      await this.webhookRepo.update(webhookEvent.id, {
        processingError: err.message,
      });
    }

    return { received: true };
  }

  // ── HANDLE TRANSFER EVENT ─────────────────────────────────────────────────────
  private async handleTransferEvent(dto: FlutterwaveWebhookDto): Promise<void> {
    if (!dto.event.startsWith('transfer.')) {
      this.logger.log(`Ignoring non-transfer event: ${dto.event}`);
      return;
    }

    const transferId = String(dto.data?.id);
    const reference = dto.data?.reference;
    const status = dto.data?.status;

    // Find payout by Flutterwave transfer ID or reference
    let payout = await this.payoutRepo.findOne({
      where: { flwTransferId: transferId },
      relations: ['user', 'bankAccount', 'transaction'],
    });

    if (!payout && reference) {
      payout = await this.payoutRepo.findOne({
        where: { flwReference: reference },
        relations: ['user', 'bankAccount', 'transaction'],
      });
    }

    if (!payout) {
      this.logger.warn(
        `Payout not found for transferId=${transferId} ref=${reference}`,
      );
      return;
    }

    const flwStatus = status?.toUpperCase();

    switch (flwStatus) {
      case 'SUCCESSFUL':
        await this.onTransferSuccessful(payout, dto);
        break;

      case 'FAILED':
        await this.onTransferFailed(payout, dto);
        break;

      case 'REVERSED':
        await this.onTransferReversed(payout, dto);
        break;

      default:
        this.logger.log(`Unhandled transfer status: ${status}`);
    }
  }

  // ── TRANSFER SUCCESS ──────────────────────────────────────────────────────────
  private async onTransferSuccessful(
    payout: Payout,
    dto: FlutterwaveWebhookDto,
  ): Promise<void> {
    if (payout.status === PayoutStatus.SUCCESS) {
      this.logger.log(`Payout ${payout.id} already marked successful`);
      return;
    }

    await this.payoutRepo.update(payout.id, {
      status: PayoutStatus.SUCCESS,
      flwStatus: 'SUCCESSFUL',
      completedAt: new Date(),
      metadata: dto.data as any,
    });

    await this.saveAudit(
      payout.userId,
      AuditActorType.WEBHOOK,
      'payout.completed',
      'payouts',
      payout.id,
      { status: payout.status },
      { status: PayoutStatus.SUCCESS, completedAt: new Date() },
    );

    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: payout.bankAccountId },
    });

    await this.sendNotification(
      payout.userId,
      NotificationType.PAYOUT_SENT,
      'Payout Successful ✅',
      `₦${Number(payout.netAmountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })} has been successfully sent to your ${bankAccount?.bankName ?? 'bank'} account ending in ${bankAccount?.accountNumber?.slice(-4) ?? '****'}.`,
      {
        payoutId: payout.id,
        amount: payout.netAmountNgn,
        bankName: bankAccount?.bankName,
        transferCode: dto.data?.transfer_code,
      },
    );

    this.logger.log(
      `Payout successful: payoutId=${payout.id} amount=₦${payout.netAmountNgn}`,
    );
  }

  // ── TRANSFER FAILED ───────────────────────────────────────────────────────────
  private async onTransferFailed(
    payout: Payout,
    dto: FlutterwaveWebhookDto,
  ): Promise<void> {
    await this.payoutRepo.update(payout.id, {
      status: PayoutStatus.FAILED,
      flwStatus: 'FAILED',
      failureReason: dto.data?.complete_message ?? 'Transfer failed',
      metadata: dto.data as any,
    });

    await this.saveAudit(
      payout.userId,
      AuditActorType.WEBHOOK,
      'payout.failed',
      'payouts',
      payout.id,
      { status: payout.status },
      {
        status: PayoutStatus.FAILED,
        reason: dto.data?.complete_message,
      },
    );

    await this.sendNotification(
      payout.userId,
      NotificationType.PAYOUT_FAILED,
      'Payout Failed ❌',
      `Your payout of ₦${Number(payout.netAmountNgn).toLocaleString('en-NG')} failed. Reason: ${dto.data?.complete_message ?? 'Unknown error'}. We will retry automatically or please contact support.`,
      {
        payoutId: payout.id,
        amount: payout.netAmountNgn,
        reason: dto.data?.complete_message,
      },
    );

    // Auto-retry if under max retries
    if (payout.retryCount < this.MAX_RETRIES) {
      this.logger.log(
        `Auto-retrying payout ${payout.id} (attempt ${payout.retryCount + 1}/${this.MAX_RETRIES})`,
      );
      try {
        await this.retryPayout(payout.id, payout.userId);
      } catch (err) {
        this.logger.error(`Auto-retry failed: ${err.message}`);
      }
    } else {
      this.logger.warn(
        `Payout ${payout.id} exhausted all ${this.MAX_RETRIES} retries`,
      );
    }
  }

  // ── TRANSFER REVERSED ─────────────────────────────────────────────────────────
  private async onTransferReversed(
    payout: Payout,
    dto: FlutterwaveWebhookDto,
  ): Promise<void> {
    await this.payoutRepo.update(payout.id, {
      status: PayoutStatus.REVERSED,
      flwStatus: 'REVERSED',
      failureReason: dto.data?.complete_message ?? 'Transfer reversed by bank',
      metadata: dto.data as any,
    });

    await this.saveAudit(
      payout.userId,
      AuditActorType.WEBHOOK,
      'payout.reversed',
      'payouts',
      payout.id,
      { status: payout.status },
      { status: PayoutStatus.REVERSED },
    );

    await this.sendNotification(
      payout.userId,
      NotificationType.PAYOUT_FAILED,
      'Payout Reversed ↩️',
      `Your payout of ₦${Number(payout.netAmountNgn).toLocaleString('en-NG')} was reversed by the bank. Reason: ${dto.data?.complete_message ?? 'Bank reversal'}. Please verify your bank account details and contact support.`,
      {
        payoutId: payout.id,
        amount: payout.netAmountNgn,
        reason: dto.data?.complete_message,
      },
    );

    this.logger.warn(
      `Payout reversed: payoutId=${payout.id} amount=₦${payout.netAmountNgn}`,
    );
  }

  // ── VERIFY PAYOUT STATUS (poll Flutterwave directly) ─────────────────────────
  async verifyPayoutStatus(payoutId: string, userId: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({
      where: { id: payoutId, userId },
    });

    if (!payout) throw new NotFoundException('Payout not found');

    if (!payout.flwTransferId) {
      throw new BadRequestException(
        'Payout has no Flutterwave transfer ID yet',
      );
    }

    try {
      const res = await this.client.get(`/transfers/${payout.flwTransferId}`);

      const flwData = res.data.data;
      const flwStatus = flwData?.status?.toUpperCase();

      // Sync status if changed
      if (
        flwStatus === 'SUCCESSFUL' &&
        payout.status !== PayoutStatus.SUCCESS
      ) {
        await this.payoutRepo.update(payout.id, {
          status: PayoutStatus.SUCCESS,
          flwStatus: 'SUCCESSFUL',
          completedAt: new Date(),
        });
      } else if (
        flwStatus === 'FAILED' &&
        payout.status !== PayoutStatus.FAILED
      ) {
        await this.payoutRepo.update(payout.id, {
          status: PayoutStatus.FAILED,
          flwStatus: 'FAILED',
          failureReason: flwData?.complete_message,
        });
      }

      return (await this.payoutRepo.findOne({
        where: { id: payoutId },
      })) as Payout;
    } catch (err) {
      this.logger.error(`Failed to verify payout status: ${err.message}`);
      throw new InternalServerErrorException('Failed to verify payout status');
    }
  }

  // ── GET USER PAYOUTS ──────────────────────────────────────────────────────────
  async getUserPayouts(userId: string, query: PayoutQueryDto) {
    const qb = this.payoutRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.bankAccount', 'ba')
      .leftJoinAndSelect('p.transaction', 'tx')
      .where('p.user_id = :userId', { userId })
      .orderBy('p.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }

    const [payouts, total] = await qb.getManyAndCount();

    return {
      data: payouts,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  // ── GET SINGLE PAYOUT ─────────────────────────────────────────────────────────
  async getPayout(payoutId: string, userId: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({
      where: { id: payoutId, userId },
      relations: ['bankAccount', 'transaction'],
    });

    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  // ── ADMIN: GET ALL PAYOUTS ────────────────────────────────────────────────────
  async adminGetAllPayouts(query: PayoutQueryDto) {
    const qb = this.payoutRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'u')
      .leftJoinAndSelect('p.bankAccount', 'ba')
      .leftJoinAndSelect('p.transaction', 'tx')
      .orderBy('p.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }

    if (query.userId) {
      qb.andWhere('p.user_id = :userId', { userId: query.userId });
    }

    const [payouts, total] = await qb.getManyAndCount();

    return {
      data: payouts,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  // ── ADMIN: MANUAL PAYOUT TRIGGER ─────────────────────────────────────────────
  async adminTriggerPayout(
    transactionId: string,
    adminId: string,
  ): Promise<Payout> {
    const transaction = await this.txRepo.findOne({
      where: { id: transactionId },
    });

    if (!transaction) throw new NotFoundException('Transaction not found');

    // Get user's default bank account
    const bankAccount = await this.bankAccountRepo.findOne({
      where: { userId: transaction.userId, isDefault: true, isVerified: true },
    });

    if (!bankAccount) {
      throw new BadRequestException(
        'User has no verified default bank account',
      );
    }

    await this.saveAudit(
      adminId,
      AuditActorType.ADMIN,
      'payout.manual_trigger',
      'transactions',
      transactionId,
      null,
      { triggeredBy: adminId },
    );

    return this.initiatePayout(
      {
        transactionId,
        bankAccountId: bankAccount.id,
        narration: 'Manual payout trigger by admin',
      },
      transaction.userId,
    );
  }

  // ── GET PAYOUT STATS ──────────────────────────────────────────────────────────
  async getPayoutStats() {
    const stats = await this.payoutRepo
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(p.net_amount_ngn)', 'totalNgn')
      .groupBy('p.status')
      .getRawMany();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayStats = await this.payoutRepo
      .createQueryBuilder('p')
      .select('COUNT(*)', 'count')
      .addSelect('SUM(p.net_amount_ngn)', 'totalNgn')
      .where('p.created_at >= :today', { today })
      .andWhere('p.status = :status', { status: PayoutStatus.SUCCESS })
      .getRawOne();

    return {
      byStatus: stats,
      today: {
        count: todayStats?.count ?? 0,
        totalNgn: todayStats?.totalNgn ?? 0,
      },
    };
  }

  // ── PRIVATE: EXECUTE TRANSFER ─────────────────────────────────────────────────
  private async executeTransfer(params: {
    accountNumber: string;
    bankCode: string;
    amount: number;
    narration: string;
    reference: string;
    currency: string;
  }): Promise<{ id: number; status: string; reference: string }> {
    try {
      const res = await this.client.post('/transfers', {
        account_bank: params.bankCode,
        account_number: params.accountNumber,
        amount: params.amount,
        narration: params.narration,
        currency: params.currency,
        reference: params.reference,
        callback_url: `${this.config.get('APP_URL')}/api/v1/payouts/webhook/flutterwave`,
        debit_currency: 'NGN',
      });

      if (res.data.status !== 'success') {
        throw new Error(
          res.data.message ?? 'Flutterwave transfer initiation failed',
        );
      }

      return {
        id: res.data.data.id,
        status: res.data.data.status,
        reference: res.data.data.reference,
      };
    } catch (err) {
      const message =
        err.response?.data?.message ?? err.message ?? 'Transfer failed';
      this.logger.error(`executeTransfer failed: ${message}`);
      throw new Error(message);
    }
  }

  // ── PRIVATE: GET TRANSFER FEE ─────────────────────────────────────────────────
  private async getTransferFee(amount: number): Promise<number> {
    try {
      const res = await this.client.get(
        `/transfers/fee?amount=${amount}&currency=NGN`,
      );
      const fee = res.data.data?.[0]?.fee ?? 0;
      return Number(fee);
    } catch (err) {
      this.logger.warn(
        `Failed to fetch transfer fee, using flat ₦50: ${err.message}`,
      );
      return 50; // fallback flat fee
    }
  }

  // ── VERIFY WEBHOOK SIGNATURE ──────────────────────────────────────────────────
  verifyWebhookSignature(payload: string, receivedHash: string): boolean {
    try {
      const expectedHash = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');
      return expectedHash === receivedHash;
    } catch {
      return false;
    }
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────
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
        channel: NotificationChannel.EMAIL,
        title,
        body,
        data: data ?? null,
      }),
      this.notifRepo.create({
        userId,
        type,
        channel: NotificationChannel.IN_APP,
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

  // ── PRIVATE: CREDIT PLATFORM PAYOUT FEE TO SYSTEM WALLET ─────────────────────
  // Records the ₦50 fixed payout fee as revenue in the NGN reserve wallet
  private async creditPayoutFeeToSystemWallet(
    feeNgn: number,
    payoutId: string,
    transactionId: string | null,
    invoiceRef: string,
  ): Promise<void> {
    const mainWallet = await this.systemWalletService.getMainWallet();

    await this.systemWalletService.recordNgnTransaction(mainWallet.id, {
      type: SystemWalletTransactionType.FEE_CREDIT,
      amountNgn: feeNgn,
      description: `Fixed payout fee ₦${feeNgn} — ${invoiceRef}`,
      reference: `PAYOUT-FEE-${payoutId}-${Date.now()}`,
      relatedPayoutId: payoutId,
      relatedTransactionId: transactionId,
    });

    this.logger.log(`Payout fee credited: ₦${feeNgn} for payout ${payoutId}`);
  }

  private async getPayoutFeeNgn(): Promise<number> {
    try {
      const setting = await this.dataSource
        .getRepository('platform_settings')
        .findOne({ where: { key: 'payout_fee_ngn' } });

      if (setting?.value) {
        const fee = Number(setting.value);
        if (!isNaN(fee) && fee >= 0) return fee;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to read payout fee from settings: ${err.message}`,
      );
    }
    return 50; // safe fallback
  }
}
