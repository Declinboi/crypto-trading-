import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { Payout } from '../entities/payout.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { User } from '../entities/user.entity';
import { SystemWallet } from '../entities/system-wallet.entity';
import { SystemWalletService } from '../system-wallet/system-wallet.service';
import {
  PayoutStatus,
  WebhookSource,
  AuditActorType,
  NotificationType,
  NotificationChannel,
  SystemWalletTransactionType,
} from '../entities/enums';
import {
  InitiatePayoutDto,
  VerifyBankAccountDto,
  MonnifyWebhookDto,
  PayoutQueryDto,
} from './dto/monnify.dto';
import { SystemWalletTransaction, Transaction } from 'src/entities';

@Injectable()
export class MonnifyService implements OnModuleInit {
  private readonly logger = new Logger(MonnifyService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly contractCode: string;
  private readonly baseUrl: string;
  private readonly MAX_RETRIES = 3;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    private config: ConfigService,

    @InjectRepository(Payout)
    private payoutRepo: Repository<Payout>,

    @InjectRepository(BankAccount)
    private bankAccountRepo: Repository<BankAccount>,

    @InjectRepository(WebhookEvent)
    private webhookRepo: Repository<WebhookEvent>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(SystemWallet)
    private systemWalletRepo: Repository<SystemWallet>,

    @InjectRepository(SystemWalletTransaction)
    private systemWalletTxRepo: Repository<SystemWalletTransaction>,

    private systemWalletService: SystemWalletService,
    private dataSource: DataSource,
  ) {
    this.apiKey = config.get<string>('MONNIFY_API_KEY') as string;
    this.secretKey = config.get<string>('MONNIFY_SECRET_KEY') as string;
    this.contractCode = config.get<string>('MONNIFY_CONTRACT_CODE') as string;
    this.baseUrl = config.get<string>('MONNIFY_BASE_URL') as string;
    // sandbox: https://sandbox.monnify.com
    // production: https://api.monnify.com

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Attach auth token to every request
    this.client.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  async onModuleInit() {
    // Pre-warm token on startup
    try {
      await this.getAccessToken();
      this.logger.log('Monnify auth token acquired on startup');
    } catch (err) {
      this.logger.warn(`Monnify token pre-warm failed: ${err.message}`);
    }
  }

  // ── AUTH TOKEN ────────────────────────────────────────────────────────────────
  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      new Date() < this.tokenExpiresAt
    ) {
      return this.accessToken;
    }

    const credentials = Buffer.from(
      `${this.apiKey}:${this.secretKey}`,
    ).toString('base64');

    const res = await axios.post(
      `${this.baseUrl}/api/v1/auth/login`,
      {},
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!res.data.requestSuccessful) {
      throw new InternalServerErrorException('Monnify authentication failed');
    }

    this.accessToken = res.data.responseBody.accessToken;
    this.tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000); // 55 min (token lasts 1hr)
    return this.accessToken!;
  }

  // ── VERIFY BANK ACCOUNT ───────────────────────────────────────────────────────
  async verifyBankAccount(dto: VerifyBankAccountDto): Promise<{
    accountName: string;
    accountNumber: string;
    bankCode: string;
  }> {
    try {
      const res = await this.client.get(
        `/api/v1/disbursements/account/validate?accountNumber=${dto.accountNumber}&bankCode=${dto.bankCode}`,
      );

      if (!res.data.requestSuccessful) {
        throw new BadRequestException('Bank account verification failed');
      }

      return {
        accountName: res.data.responseBody.accountName,
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Bank verification failed: ${err.message}`);
      throw new BadRequestException(
        err.response?.data?.responseMessage ?? 'Unable to verify bank account',
      );
    }
  }

  // ── GET NIGERIAN BANKS ────────────────────────────────────────────────────────
  async getBanks(): Promise<{ name: string; code: string }[]> {
    try {
      const res = await this.client.get('/api/v1/sdk/transactions/banks');
      return (res.data.responseBody ?? []).map((bank: any) => ({
        name: bank.name,
        code: bank.code,
      }));
    } catch (err) {
      this.logger.error(`Failed to fetch banks: ${err.message}`);
      throw new InternalServerErrorException('Failed to fetch bank list');
    }
  }

  // ── INITIATE PAYOUT (single transfer) ────────────────────────────────────────
  async initiatePayout(
    dto: InitiatePayoutDto,
    userId: string,
  ): Promise<Payout> {
    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: dto.bankAccountId, userId },
    });

    if (!bankAccount) throw new NotFoundException('Bank account not found');
    if (!bankAccount.isVerified) {
      throw new BadRequestException(
        'Bank account must be verified before receiving payouts',
      );
    }

    const platformFee = await this.getPayoutFeeNgn();
    const monnifyFee = await this.getTransferFee(dto.amountNgn);
    const totalFee = platformFee + monnifyFee;
    const netAmount = dto.amountNgn - totalFee;

    if (netAmount <= 0) {
      throw new BadRequestException(
        `Amount too small after fees. Amount: ₦${dto.amountNgn}, Fees: ₦${totalFee}`,
      );
    }

    const reference = `CPAY-${uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase()}`;
    const narration = dto.narration ?? `CryptoPay NG payout`;

    const payout = await this.payoutRepo.save(
      this.payoutRepo.create({
        transactionId: null,
        userId,
        bankAccountId: dto.bankAccountId,
        amountNgn: dto.amountNgn,
        feeNgn: totalFee,
        netAmountNgn: netAmount,
        status: PayoutStatus.PROCESSING,
        flwReference: reference, // reuse field for Monnify reference
        narration,
        retryCount: 0,
        metadata: {
          provider: 'monnify',
          platformFee,
          monnifyFee,
          totalFee,
        } as any,
      }),
    );

    // Credit platform fee to system wallet
    try {
      await this.systemWalletService.creditFee(
        platformFee,
        `Fixed payout fee ₦${platformFee} — payout ${payout.id}`,
        undefined,
      );
    } catch (err) {
      this.logger.error(`Failed to credit payout fee: ${err.message}`);
    }

    try {
      const transfer = await this.executeSingleTransfer({
        accountNumber: bankAccount.accountNumber,
        bankCode: bankAccount.bankCode,
        amount: netAmount,
        narration,
        reference,
        accountName: bankAccount.accountName,
      });

      await this.payoutRepo.update(payout.id, {
        flwTransferId: transfer.reference,
        flwStatus: transfer.status,
        status:
          transfer.status === 'SUCCESS'
            ? PayoutStatus.SUCCESS
            : PayoutStatus.PROCESSING,
        ...(transfer.status === 'SUCCESS' && { completedAt: new Date() }),
      });

      // Deduct from system wallet reserve
      await this.systemWalletService.deductPayoutReserve(
        dto.amountNgn,
        payout.id,
        `Monnify payout ${payout.id}`,
      );

      await this.saveAudit(
        userId,
        AuditActorType.SYSTEM,
        'payout.initiated',
        'payouts',
        payout.id,
        null,
        {
          grossAmount: dto.amountNgn,
          platformFee,
          monnifyFee,
          netAmount,
          bankAccount: bankAccount.accountNumber,
          reference,
        },
      );

      this.logger.log(
        `Payout initiated: payoutId=${payout.id} amount=₦${netAmount} ref=${reference}`,
      );

      if (transfer.status === 'SUCCESS') {
        await this.sendNotification(
          userId,
          NotificationType.PAYOUT_SENT,
          'Payout Sent ✅',
          `₦${netAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} sent to your ${bankAccount.bankName} account ****${bankAccount.accountNumber.slice(-4)}.`,
          {
            payoutId: payout.id,
            amount: netAmount,
            bankName: bankAccount.bankName,
          },
        );
      } else {
        await this.sendNotification(
          userId,
          NotificationType.PAYOUT_SENT,
          'Payout Processing 🔄',
          `Your payout of ₦${netAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} is being processed.`,
          { payoutId: payout.id, amount: netAmount },
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
        `Your payout of ₦${netAmount.toLocaleString('en-NG')} failed. Reason: ${err.message}.`,
        { payoutId: payout.id, error: err.message },
      );
      throw new InternalServerErrorException(`Payout failed: ${err.message}`);
    }
  }

  // ── INITIATE DIRECT PAYOUT (wallet withdrawal — no transactionId) ─────────────
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
    if (!bankAccount.isVerified)
      throw new BadRequestException('Bank account is not verified');

    const platformFee = await this.getPayoutFeeNgn();
    const monnifyFee = await this.getTransferFee(params.amountNgn);
    const totalFee = platformFee + monnifyFee;
    const netAmount = params.amountNgn - totalFee;

    if (netAmount <= 0) {
      throw new BadRequestException(
        `Amount too small after fees. Amount: ₦${params.amountNgn}, Fees: ₦${totalFee}`,
      );
    }

    const monnifyRef = `CPAY-WDR-${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;

    const payout = await this.payoutRepo.save(
      this.payoutRepo.create({
        transactionId: null,
        userId: params.userId,
        bankAccountId: params.bankAccountId,
        amountNgn: params.amountNgn,
        feeNgn: totalFee,
        netAmountNgn: netAmount,
        status: PayoutStatus.PROCESSING,
        flwReference: monnifyRef,
        narration: params.narration,
        retryCount: 0,
        metadata: {
          source: 'wallet_withdrawal',
          walletReference: params.reference,
          provider: 'monnify',
          platformFee,
          monnifyFee,
        } as any,
      }),
    );

    try {
      await this.systemWalletService.creditFee(
        platformFee,
        `Fixed payout fee ₦${platformFee} — wallet withdrawal ${payout.id}`,
      );
    } catch (err) {
      this.logger.error(`Failed to credit payout fee: ${err.message}`);
    }

    try {
      const transfer = await this.executeSingleTransfer({
        accountNumber: bankAccount.accountNumber,
        bankCode: bankAccount.bankCode,
        amount: netAmount,
        narration: params.narration,
        reference: monnifyRef,
        accountName: bankAccount.accountName,
      });

      await this.payoutRepo.update(payout.id, {
        flwTransferId: transfer.reference,
        flwStatus: transfer.status,
        status:
          transfer.status === 'SUCCESS'
            ? PayoutStatus.SUCCESS
            : PayoutStatus.PROCESSING,
        ...(transfer.status === 'SUCCESS' && { completedAt: new Date() }),
      });

      await this.systemWalletService.deductPayoutReserve(
        params.amountNgn,
        payout.id,
        `Wallet withdrawal payout ${payout.id}`,
      );

      await this.sendNotification(
        params.userId,
        NotificationType.PAYOUT_SENT,
        'Withdrawal Processing 🔄',
        `₦${netAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} is being sent to your ${bankAccount.bankName} account ****${bankAccount.accountNumber.slice(-4)}.`,
        {
          payoutId: payout.id,
          grossAmount: params.amountNgn,
          platformFee,
          monnifyFee,
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
    });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status === PayoutStatus.SUCCESS)
      throw new ConflictException('Payout already completed');
    if (payout.status === PayoutStatus.PROCESSING)
      throw new ConflictException('Payout already processing');
    if (payout.retryCount >= this.MAX_RETRIES)
      throw new BadRequestException(
        `Maximum retries (${this.MAX_RETRIES}) reached`,
      );

    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: payout.bankAccountId },
    });
    if (!bankAccount) throw new NotFoundException('Bank account not found');

    const newReference = `CPAY-RETRY-${uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()}`;

    await this.payoutRepo.update(payoutId, {
      status: PayoutStatus.PROCESSING,
      flwReference: newReference,
      retryCount: payout.retryCount + 1,
      lastRetryAt: new Date(),
      failureReason: null,
    });

    try {
      const transfer = await this.executeSingleTransfer({
        accountNumber: bankAccount.accountNumber,
        bankCode: bankAccount.bankCode,
        amount: Number(payout.netAmountNgn),
        narration: payout.narration ?? 'CryptoPay NG payout retry',
        reference: newReference,
        accountName: bankAccount.accountName,
      });

      await this.payoutRepo.update(payoutId, {
        flwTransferId: transfer.reference,
        flwStatus: transfer.status,
        status:
          transfer.status === 'SUCCESS'
            ? PayoutStatus.SUCCESS
            : PayoutStatus.PROCESSING,
        ...(transfer.status === 'SUCCESS' && { completedAt: new Date() }),
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

  // ── CREATE VIRTUAL ACCOUNT (for system wallet top-up) ─────────────────────────
  async createSystemWalletVirtualAccount(): Promise<{
    accountNumber: string;
    accountName: string;
    bankName: string;
    bankCode: string;
    reference: string;
  }> {
    const reference = `SYS-WALLET-${Date.now()}`;

    try {
      const res = await this.client.post(
        '/api/v1/bank-transfer/reserved-accounts',
        {
          accountReference: reference,
          accountName: 'CryptoPay NG System Reserve',
          currencyCode: 'NGN',
          contractCode: this.contractCode,
          customerEmail: this.config.get('ADMIN_EMAIL'),
          customerName: 'CryptoPay NG Admin',
          getAllAvailableBanks: false,
          preferredBanks: ['035'], // Wema Bank (ALAT) — change as needed
        },
      );

      if (!res.data.requestSuccessful) {
        throw new Error(
          res.data.responseMessage ?? 'Virtual account creation failed',
        );
      }

      const account = res.data.responseBody.accounts?.[0];

      // Save virtual account details to the main system wallet
      const mainWallet = await this.systemWalletService.getMainWallet();
      await this.systemWalletRepo.update(mainWallet.id, {
        notes: JSON.stringify({
          ...JSON.parse(mainWallet.notes ?? '{}'),
          virtualAccount: {
            accountNumber: account.accountNumber,
            accountName: account.accountName,
            bankName: account.bankName,
            bankCode: account.bankCode,
            reference,
            createdAt: new Date(),
          },
        }),
      });

      this.logger.log(
        `System wallet virtual account created: ${account.accountNumber} (${account.bankName})`,
      );

      return {
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        bankName: account.bankName,
        bankCode: account.bankCode,
        reference,
      };
    } catch (err) {
      this.logger.error(`Virtual account creation failed: ${err.message}`);
      throw new InternalServerErrorException(
        'Failed to create virtual account',
      );
    }
  }

  // ── GET SYSTEM WALLET VIRTUAL ACCOUNT ─────────────────────────────────────────
  async getSystemWalletVirtualAccount(): Promise<any> {
    const mainWallet = await this.systemWalletService.getMainWallet();
    const notes = JSON.parse(mainWallet.notes ?? '{}');

    if (!notes.virtualAccount) {
      // Auto-create if not exists
      return this.createSystemWalletVirtualAccount();
    }

    return notes.virtualAccount;
  }

  // ── PROCESS MONNIFY WEBHOOK ───────────────────────────────────────────────────
  async processWebhook(
    rawPayload: string,
    signature: string,
    dto: MonnifyWebhookDto,
  ): Promise<{ received: boolean }> {
    const isValid = this.verifyWebhookSignature(rawPayload, signature);
    if (!isValid) {
      this.logger.warn(
        `Invalid Monnify webhook signature for event=${dto.eventType}`,
      );
    }

    const idempotencyKey = `monnify-${dto.eventData?.transactionReference}-${dto.eventType}`;

    const existingEvent = await this.webhookRepo.findOne({
      where: { idempotencyKey },
    });
    if (existingEvent?.processed) {
      this.logger.log(`Duplicate Monnify webhook ignored: ${idempotencyKey}`);
      return { received: true };
    }

    const webhookEvent = await this.webhookRepo.save(
      this.webhookRepo.create({
        source: WebhookSource.MONNIFY,
        eventType: dto.eventType,
        externalRef: dto.eventData?.transactionReference,
        payload: JSON.parse(rawPayload),
        signatureValid: isValid,
        processed: false,
        idempotencyKey,
      }),
    );

    try {
      await this.handleMonnifyEvent(dto);

      await this.webhookRepo.update(webhookEvent.id, {
        processed: true,
        processedAt: new Date(),
      });

      this.logger.log(
        `Monnify webhook processed: ${dto.eventType} ref=${dto.eventData?.transactionReference}`,
      );
    } catch (err) {
      this.logger.error(`Monnify webhook failed: ${err.message}`, err.stack);
      await this.webhookRepo.update(webhookEvent.id, {
        processingError: err.message,
      });
    }

    return { received: true };
  }

  // ── HANDLE MONNIFY EVENTS ─────────────────────────────────────────────────────
  private async handleMonnifyEvent(dto: MonnifyWebhookDto): Promise<void> {
    switch (dto.eventType) {
      // ── Successful transfer to bank ──────────────────────────────────────────
      case 'SUCCESSFUL_DISBURSEMENT':
        await this.onDisbursementSuccessful(dto);
        break;

      // ── Failed transfer ──────────────────────────────────────────────────────
      case 'FAILED_DISBURSEMENT':
        await this.onDisbursementFailed(dto);
        break;

      // ── Reversed transfer ────────────────────────────────────────────────────
      case 'REVERSED_DISBURSEMENT':
        await this.onDisbursementReversed(dto);
        break;

      // ── System wallet virtual account top-up received ────────────────────────
      case 'SUCCESSFUL_TRANSACTION':
        await this.onVirtualAccountPaymentReceived(dto);
        break;

      default:
        this.logger.log(`Unhandled Monnify event: ${dto.eventType}`);
    }
  }

  private async onDisbursementSuccessful(
    dto: MonnifyWebhookDto,
  ): Promise<void> {
    const reference = dto.eventData?.transactionReference;
    const payout =
      (await this.payoutRepo.findOne({ where: { flwReference: reference } })) ??
      (await this.payoutRepo.findOne({ where: { flwTransferId: reference } }));

    if (!payout) {
      this.logger.warn(`Payout not found for ref=${reference}`);
      return;
    }

    if (payout.status === PayoutStatus.SUCCESS) return;

    await this.payoutRepo.update(payout.id, {
      status: PayoutStatus.SUCCESS,
      flwStatus: 'SUCCESS',
      completedAt: new Date(),
      metadata: { ...(payout.metadata as any), monnifyEvent: dto.eventData },
    });

    await this.saveAudit(
      payout.userId,
      AuditActorType.WEBHOOK,
      'payout.completed',
      'payouts',
      payout.id,
      { status: payout.status },
      { status: PayoutStatus.SUCCESS },
    );

    const bankAccount = await this.bankAccountRepo.findOne({
      where: { id: payout.bankAccountId },
    });

    await this.sendNotification(
      payout.userId,
      NotificationType.PAYOUT_SENT,
      'Payout Successful ✅',
      `₦${Number(payout.netAmountNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })} successfully sent to your ${bankAccount?.bankName ?? 'bank'} account ****${bankAccount?.accountNumber?.slice(-4) ?? '****'}.`,
      { payoutId: payout.id, amount: payout.netAmountNgn },
    );

    this.logger.log(`Payout successful: ${payout.id} ₦${payout.netAmountNgn}`);
  }

  private async onDisbursementFailed(dto: MonnifyWebhookDto): Promise<void> {
    const reference = dto.eventData?.transactionReference;
    const payout = await this.payoutRepo.findOne({
      where: { flwReference: reference },
    });

    if (!payout) return;

    await this.payoutRepo.update(payout.id, {
      status: PayoutStatus.FAILED,
      flwStatus: 'FAILED',
      failureReason: dto.eventData?.paymentDescription ?? 'Transfer failed',
      metadata: { ...(payout.metadata as any), monnifyEvent: dto.eventData },
    });

    await this.sendNotification(
      payout.userId,
      NotificationType.PAYOUT_FAILED,
      'Payout Failed ❌',
      `Your payout of ₦${Number(payout.netAmountNgn).toLocaleString('en-NG')} failed. ${dto.eventData?.paymentDescription ?? 'Please retry or contact support.'}`,
      { payoutId: payout.id, reason: dto.eventData?.paymentDescription },
    );

    // Auto-retry
    if (payout.retryCount < this.MAX_RETRIES) {
      try {
        await this.retryPayout(payout.id, payout.userId);
      } catch (err) {
        this.logger.error(`Auto-retry failed: ${err.message}`);
      }
    }
  }

  private async onDisbursementReversed(dto: MonnifyWebhookDto): Promise<void> {
    const reference = dto.eventData?.transactionReference;
    const payout = await this.payoutRepo.findOne({
      where: { flwReference: reference },
    });

    if (!payout) return;

    await this.payoutRepo.update(payout.id, {
      status: PayoutStatus.REVERSED,
      flwStatus: 'REVERSED',
      failureReason: 'Transfer reversed by bank',
      metadata: { ...(payout.metadata as any), monnifyEvent: dto.eventData },
    });

    await this.sendNotification(
      payout.userId,
      NotificationType.PAYOUT_FAILED,
      'Payout Reversed ↩️',
      `Your payout of ₦${Number(payout.netAmountNgn).toLocaleString('en-NG')} was reversed. Please verify your bank details and contact support.`,
      { payoutId: payout.id },
    );
  }

  // ── VIRTUAL ACCOUNT PAYMENT RECEIVED (system wallet top-up) ──────────────────
  private async onVirtualAccountPaymentReceived(
    dto: MonnifyWebhookDto,
  ): Promise<void> {
    const amountPaid = dto.eventData?.amountPaid;
    const reference = dto.eventData?.transactionReference;
    const description = dto.eventData?.paymentDescription ?? '';
    const customerName = dto.eventData?.customer?.name ?? '';

    if (!amountPaid || amountPaid <= 0) return;

    // Idempotency — don't double-credit
    const alreadyProcessed = await this.systemWalletTxRepo.findOne({
      where: { reference: `MONNIFY-TOPUP-${reference}` },
    });

    if (alreadyProcessed) {
      this.logger.log(
        `Virtual account payment already processed: ${reference}`,
      );
      return;
    }

    // Detect source of the payment for description
    const isNowPaymentsSettlement =
      description.toLowerCase().includes('nowpayments') ||
      customerName.toLowerCase().includes('nowpayments') ||
      description.toLowerCase().includes('settlement') ||
      description.toLowerCase().includes('crypto');

    const creditDescription = isNowPaymentsSettlement
      ? `NowPayments auto-settlement ₦${amountPaid.toLocaleString('en-NG')} — ref: ${reference}`
      : `Virtual account top-up ₦${amountPaid.toLocaleString('en-NG')} — ref: ${reference}`;

    // Credit the system wallet DB to stay in sync with Monnify wallet
    const mainWallet = await this.systemWalletService.getMainWallet();

    await this.systemWalletService.recordNgnTransaction(mainWallet.id, {
      type: SystemWalletTransactionType.TOP_UP,
      amountNgn: amountPaid,
      description: creditDescription,
      reference: `MONNIFY-TOPUP-${reference}`,
      relatedPayoutId: null,
      relatedTransactionId: null,
    });

    this.logger.log(
      `System wallet auto-credited: ₦${amountPaid.toLocaleString('en-NG')} ` +
        `source=${isNowPaymentsSettlement ? 'NowPayments settlement' : 'bank transfer'} ` +
        `ref=${reference}`,
    );

    // Notify admins
    const admins = await this.userRepo.find({
      where: [{ role: 'admin' as any }, { role: 'super_admin' as any }],
    });

    for (const admin of admins) {
      await this.sendNotification(
        admin.id,
        NotificationType.INVOICE_PAID,
        isNowPaymentsSettlement
          ? 'NowPayments Settlement Received 💰'
          : 'System Wallet Funded 💰',
        `₦${amountPaid.toLocaleString('en-NG', { minimumFractionDigits: 2 })} ` +
          `received into Monnify disbursement wallet. ` +
          `System wallet balance updated automatically. Ref: ${reference}`,
        {
          amountNgn: amountPaid,
          reference,
          source: isNowPaymentsSettlement
            ? 'nowpayments_settlement'
            : 'manual_topup',
          newBalance: Number(mainWallet.balanceNgn) + amountPaid,
        },
      );
    }

    // Now retry any failed payouts that were waiting for liquidity
    await this.retryPendingPayouts();
  }

  private async retryPendingPayouts(): Promise<void> {
    try {
      const failedPayouts = await this.payoutRepo.find({
        where: {
          status: PayoutStatus.FAILED,
          retryCount: LessThan(this.MAX_RETRIES),
        },
        order: { createdAt: 'ASC' },
        take: 20, // process up to 20 at a time
      });

      if (failedPayouts.length === 0) return;

      this.logger.log(
        `Settlement received — auto-retrying ${failedPayouts.length} pending payout(s)`,
      );

      for (const payout of failedPayouts) {
        // Only retry payouts that failed due to insufficient balance
        const isLiquidityFailure =
          payout.failureReason?.toLowerCase().includes('insufficient') ||
          payout.failureReason?.toLowerCase().includes('insufficient funds') ||
          payout.failureReason?.toLowerCase().includes('monnify wallet');

        if (!isLiquidityFailure) continue;

        try {
          await this.retryPayout(payout.id, payout.userId);
          this.logger.log(`Auto-retried payout ${payout.id} after settlement`);
        } catch (err) {
          this.logger.error(
            `Auto-retry failed for payout ${payout.id}: ${err.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`retryPendingPayouts failed: ${err.message}`);
    }
  }

  // ── VERIFY PAYOUT STATUS ──────────────────────────────────────────────────────
  async verifyPayoutStatus(payoutId: string, userId: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({
      where: { id: payoutId, userId },
    });
    if (!payout) throw new NotFoundException('Payout not found');

    if (!payout.flwReference)
      throw new BadRequestException('Payout has no reference');

    try {
      const res = await this.client.get(
        `/api/v1/disbursements/single/summary?reference=${payout.flwReference}`,
      );

      const data = res.data.responseBody;
      const monnifyStatus = data?.status?.toUpperCase();

      if (
        monnifyStatus === 'SUCCESS' &&
        payout.status !== PayoutStatus.SUCCESS
      ) {
        await this.payoutRepo.update(payout.id, {
          status: PayoutStatus.SUCCESS,
          flwStatus: 'SUCCESS',
          completedAt: new Date(),
        });
      } else if (
        monnifyStatus === 'FAILED' &&
        payout.status !== PayoutStatus.FAILED
      ) {
        await this.payoutRepo.update(payout.id, {
          status: PayoutStatus.FAILED,
          flwStatus: 'FAILED',
          failureReason: data?.responseMessage,
        });
      }

      return (await this.payoutRepo.findOne({
        where: { id: payoutId },
      })) as Payout;
    } catch (err) {
      this.logger.error(`Failed to verify payout: ${err.message}`);
      throw new InternalServerErrorException('Failed to verify payout status');
    }
  }

  // ── GET USER PAYOUTS ──────────────────────────────────────────────────────────
  async getUserPayouts(userId: string, query: PayoutQueryDto) {
    const qb = this.payoutRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.bankAccount', 'ba')
      .where('p.user_id = :userId', { userId })
      .orderBy('p.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.status)
      qb.andWhere('p.status = :status', { status: query.status });

    const [payouts, total] = await qb.getManyAndCount();
    return {
      data: payouts,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  async getPayout(payoutId: string, userId: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({
      where: { id: payoutId, userId },
      relations: ['bankAccount'],
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  async adminGetAllPayouts(query: PayoutQueryDto) {
    const qb = this.payoutRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'u')
      .leftJoinAndSelect('p.bankAccount', 'ba')
      .orderBy('p.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.status)
      qb.andWhere('p.status = :status', { status: query.status });
    if (query.userId)
      qb.andWhere('p.user_id = :userId', { userId: query.userId });

    const [payouts, total] = await qb.getManyAndCount();
    return {
      data: payouts,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  async adminTriggerPayout(
    transactionId: string,
    adminId: string,
  ): Promise<Payout> {
    const txRepo = this.dataSource.getRepository(Transaction);
    const transaction = await txRepo.findOne({ where: { id: transactionId } });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const bankAccount = await this.bankAccountRepo.findOne({
      where: { userId: transaction.userId, isDefault: true, isVerified: true },
    });
    if (!bankAccount)
      throw new BadRequestException(
        'User has no verified default bank account',
      );

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
        bankAccountId: bankAccount.id,
        amountNgn: Number(transaction.netNgnAmount),
      },
      transaction.userId,
    );
  }

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

  // ── PRIVATE: EXECUTE SINGLE TRANSFER ─────────────────────────────────────────
  private async executeSingleTransfer(params: {
    accountNumber: string;
    bankCode: string;
    amount: number;
    narration: string;
    reference: string;
    accountName: string;
  }): Promise<{ reference: string; status: string }> {
    const sourceAccountNumber = this.config.get<string>(
      'MONNIFY_WALLET_ACCOUNT_NUMBER',
    );

    if (!sourceAccountNumber) {
      throw new Error('MONNIFY_WALLET_ACCOUNT_NUMBER is not configured.');
    }

    // ── Liquidity check before attempting disbursement ────────────────────────
    const monnifyBalance = await this.getMonnifyWalletBalance();

    if (monnifyBalance < params.amount) {
      this.logger.warn(
        `Insufficient Monnify wallet balance. ` +
          `Required: ₦${params.amount}, Available: ₦${monnifyBalance}. ` +
          `Payout queued — admin must fund Monnify wallet.`,
      );

      // Alert admins to fund the Monnify wallet
      await this.alertAdminsLowMonnifyBalance(monnifyBalance, params.amount);

      // Throw so payout is marked FAILED and can be retried later
      throw new Error(
        `Monnify wallet has insufficient funds. ` +
          `Available: ₦${monnifyBalance.toLocaleString('en-NG')}, ` +
          `Required: ₦${params.amount.toLocaleString('en-NG')}. ` +
          `Admin has been notified to fund the disbursement wallet.`,
      );
    }

    try {
      const res = await this.client.post('/api/v2/disbursements/single', {
        amount: params.amount,
        reference: params.reference,
        narration: params.narration,
        destinationBankCode: params.bankCode,
        destinationAccountNumber: params.accountNumber,
        destinationAccountName: params.accountName,
        destinationNarration: params.narration,
        sourceAccountNumber,
        async: true,
        currency: 'NGN',
      });

      if (!res.data.requestSuccessful) {
        throw new Error(res.data.responseMessage ?? 'Monnify transfer failed');
      }

      return {
        reference: res.data.responseBody.reference,
        status: res.data.responseBody.status,
      };
    } catch (err) {
      const message =
        err.response?.data?.responseMessage ?? err.message ?? 'Transfer failed';
      this.logger.error(`executeSingleTransfer failed: ${message}`);
      throw new Error(message);
    }
  }

  private async alertAdminsLowMonnifyBalance(
    available: number,
    required: number,
  ): Promise<void> {
    const admins = await this.userRepo.find({
      where: [{ role: 'admin' as any }, { role: 'super_admin' as any }],
    });

    for (const admin of admins) {
      await this.notifRepo.save(
        this.notifRepo.create({
          userId: admin.id,
          type: NotificationType.PAYOUT_FAILED,
          channel: NotificationChannel.IN_APP,
          title: '🚨 Monnify Wallet Needs Funding',
          body:
            `A payout of ₦${required.toLocaleString('en-NG')} failed because ` +
            `the Monnify disbursement wallet only has ₦${available.toLocaleString('en-NG')}. ` +
            `Please fund the Monnify wallet immediately to process pending payouts.`,
          data: { available, required, action: 'fund_monnify_wallet' },
        }),
      );
    }
  }

  // ── CHECK MONNIFY WALLET BALANCE BEFORE DISBURSING ────────────────────────────
  private async getMonnifyWalletBalance(): Promise<number> {
    try {
      const sourceAccount = this.config.get<string>(
        'MONNIFY_WALLET_ACCOUNT_NUMBER',
      );
      const res = await this.client.get(
        `/api/v1/disbursements/wallet/balance?accountNumber=${sourceAccount}`,
      );
      return Number(res.data.responseBody?.availableBalance ?? 0);
    } catch (err) {
      this.logger.error(
        `Failed to fetch Monnify wallet balance: ${err.message}`,
      );
      return 0;
    }
  }

  // ── PRIVATE: GET TRANSFER FEE ─────────────────────────────────────────────────
  private async getTransferFee(amount: number): Promise<number> {
    try {
      const res = await this.client.get(
        `/api/v1/disbursements/single/summary?amount=${amount}&bankCode=000`,
      );
      return Number(res.data.responseBody?.fee ?? 0);
    } catch {
      return 26.88; // Monnify flat fee fallback
    }
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
    } catch {}
    return 50;
  }

  // ── VERIFY WEBHOOK SIGNATURE ──────────────────────────────────────────────────
  verifyWebhookSignature(payload: string, receivedHash: string): boolean {
    try {
      const hash = crypto
        .createHmac('sha512', this.secretKey)
        .update(payload)
        .digest('hex');
      return hash === receivedHash;
    } catch {
      return false;
    }
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────────
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
