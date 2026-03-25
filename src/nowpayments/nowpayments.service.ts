import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

import { Invoice } from '../entities/invoice.entity';
import { Transaction } from '../entities/transaction.entity';
import { WalletAddress } from '../entities/wallet-address.entity';
import { ExchangeRate } from '../entities/exchange-rate.entity';
import { RateLock } from '../entities/rate-lock.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { SystemWalletService } from '../system-wallet/system-wallet.service';
import {
  CoinType,
  NetworkType,
  InvoiceStatus,
  TransactionStatus,
  WebhookSource,
  AuditActorType,
  NotificationType,
  NotificationChannel,
  RateSource,
} from '../entities/enums';
import { NowpaymentsWebhookDto } from './dto/nowpayments.dto';
import { WalletService } from 'src/wallet/wallet.service';

import { QuidaxService } from 'src/quidax/quidax.service';

import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { QUEUE_PAYMENT, JOB_PROCESS_PAYMENT } from '../queue/queue.constants';
import { KafkaService } from '../kafka/kafka.service';
import { KafkaTopic } from '../kafka/kafka.constants';
import { FlutterwaveService } from 'src/flutterwave/flutterwave.service';

// NowPayments coin → our CoinType mapping
const COIN_MAP: Record<string, CoinType> = {
  usdttrc20: CoinType.USDT_TRC20,
  usdterc20: CoinType.USDT_ERC20,
  btc: CoinType.BTC,
  eth: CoinType.ETH,
  sol: CoinType.SOL,
  ltc: CoinType.LTC, // ← add
  trx: CoinType.TRX,
};

// CoinType → NowPayments currency string
const COIN_TO_NP: Record<CoinType, string> = {
  [CoinType.USDT_TRC20]: 'usdttrc20',
  [CoinType.USDT_ERC20]: 'usdterc20',
  [CoinType.BTC]: 'btc',
  [CoinType.ETH]: 'eth',
  [CoinType.SOL]: 'sol',
  [CoinType.LTC]: 'ltc',
  [CoinType.TRX]: 'trx',
};

// CoinType → NetworkType
const COIN_NETWORK_MAP: Record<CoinType, NetworkType> = {
  [CoinType.USDT_TRC20]: NetworkType.TRON,
  [CoinType.USDT_ERC20]: NetworkType.ETHEREUM,
  [CoinType.BTC]: NetworkType.BITCOIN,
  [CoinType.ETH]: NetworkType.ETHEREUM,
  [CoinType.SOL]: NetworkType.SOLANA,
  [CoinType.LTC]: NetworkType.LITECOIN,
  [CoinType.TRX]: NetworkType.TRON,
};

@Injectable()
export class NowpaymentsService {
  private readonly logger = new Logger(NowpaymentsService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly ipnSecret: string;
  private readonly baseUrl = 'https://api.nowpayments.io/v1';

  constructor(
    private config: ConfigService,
    private walletService: WalletService,
    private flutterwaveService: FlutterwaveService,

    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,

    @InjectRepository(Transaction)
    private txRepo: Repository<Transaction>,

    @InjectRepository(WalletAddress)
    private walletAddressRepo: Repository<WalletAddress>,

    @InjectRepository(ExchangeRate)
    private rateRepo: Repository<ExchangeRate>,

    @InjectRepository(RateLock)
    private rateLockRepo: Repository<RateLock>,

    @InjectRepository(WebhookEvent)
    private webhookRepo: Repository<WebhookEvent>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectQueue(QUEUE_PAYMENT)
    private paymentQueue: Queue,
    private kafkaService: KafkaService,

    private systemWalletService: SystemWalletService,

    private quidaxService: QuidaxService,

    private dataSource: DataSource,
  ) {
    this.apiKey = config.get<string>('NOWPAYMENTS_API_KEY') as string;
    this.ipnSecret = config.get<string>('NOWPAYMENTS_IPN_SECRET') as string;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  // ── GET AVAILABLE CURRENCIES ──────────────────────────────────────────────────
  async getAvailableCurrencies(): Promise<string[]> {
    try {
      const res = await this.client.get('/currencies');
      return res.data.currencies ?? [];
    } catch (err) {
      this.logger.error(`Failed to fetch NP currencies: ${err.message}`);
      throw new InternalServerErrorException(
        'Failed to fetch available currencies',
      );
    }
  }

  // ── GET MINIMUM PAYMENT AMOUNT ────────────────────────────────────────────────
  async getMinimumPaymentAmount(coin: CoinType): Promise<number> {
    try {
      const currency = COIN_TO_NP[coin];
      const res = await this.client.get(
        `/min-amount?currency_from=${currency}&currency_to=${currency}`,
      );
      return res.data.min_amount ?? 0;
    } catch (err) {
      this.logger.error(`Failed to get min amount for ${coin}: ${err.message}`);
      return 0;
    }
  }

  // ── FETCH LIVE RATES ──────────────────────────────────────────────────────────
  async fetchLiveRates(): Promise<ExchangeRate[]> {
    const coins = Object.values(CoinType);
    const savedRates: ExchangeRate[] = [];

    // ── Fetch USD/NGN rate ONCE outside the loop ──────────────────────────────
    // Avoids calling Coinbase/ExchangeRate-API 7 times per cycle
    const usdNgnRate = await this.getUsdNgnRate();
    const spreadPercent = Number(
      this.config.get<string>('FX_SPREAD_PERCENT') ?? '1.5',
    );
    const effectiveUsdNgn = usdNgnRate * (1 + spreadPercent / 100);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min TTL

    this.logger.log(
      `USD/NGN for this cycle: raw=${usdNgnRate} effective=${effectiveUsdNgn} (spread=${spreadPercent}%)`,
    );

    for (const coin of coins) {
      try {
        const currency = COIN_TO_NP[coin];

        const res = await this.client.get(
          `/estimate?amount=1&currency_from=${currency}&currency_to=usd`,
        );
        const coinUsdPrice = Number(res.data.estimated_amount ?? 0);
        if (coinUsdPrice === 0) continue;

        // Reuse the single USD/NGN rate fetched above
        const rate = this.rateRepo.create({
          coin,
          coinUsdPrice,
          usdNgnRate,
          spreadPercent,
          effectiveUsdNgn,
          source: RateSource.NOWPAYMENTS,
          fetchedAt: new Date(),
          expiresAt,
        });

        const saved = await this.rateRepo.save(rate);
        savedRates.push(saved);

        this.logger.debug(
          `Rate saved: ${coin} = $${coinUsdPrice} | USD/NGN = ${effectiveUsdNgn}`,
        );
      } catch (err) {
        this.logger.error(`Failed to fetch rate for ${coin}: ${err.message}`);
      }
    }

    return savedRates;
  }

  // ── GET LATEST RATE FOR COIN ──────────────────────────────────────────────────
  async getLatestRate(coin: CoinType): Promise<ExchangeRate> {
    const rate = await this.rateRepo.findOne({
      where: { coin },
      order: { fetchedAt: 'DESC' },
    });

    if (!rate || rate.expiresAt < new Date()) {
      this.logger.warn(`Rate for ${coin} stale or missing — fetching fresh`);

      // Fetch only the single coin needed, not all 7
      const freshRates = await this.fetchSingleRate(coin);
      if (freshRates) return freshRates;

      // If single fetch fails and we have a stale rate, return it anyway
      if (rate) {
        this.logger.warn(`Using stale rate for ${coin} — all providers failed`);
        return rate;
      }

      throw new NotFoundException(`No exchange rate available for ${coin}`);
    }

    return rate;
  }

  // New targeted single-coin fetch
  private async fetchSingleRate(coin: CoinType): Promise<ExchangeRate | null> {
    try {
      const currency = COIN_TO_NP[coin];
      const res = await this.client.get(
        `/estimate?amount=1&currency_from=${currency}&currency_to=usd`,
      );
      const coinUsdPrice = Number(res.data.estimated_amount ?? 0);
      if (coinUsdPrice === 0) return null;

      const usdNgnRate = await this.getUsdNgnRate(); // single call here is fine
      const spreadPercent = Number(
        this.config.get<string>('FX_SPREAD_PERCENT') ?? '1.5',
      );
      const effectiveUsdNgn = usdNgnRate * (1 + spreadPercent / 100);

      return await this.rateRepo.save(
        this.rateRepo.create({
          coin,
          coinUsdPrice,
          usdNgnRate,
          spreadPercent,
          effectiveUsdNgn,
          source: RateSource.NOWPAYMENTS,
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }),
      );
    } catch (err) {
      this.logger.error(`fetchSingleRate failed for ${coin}: ${err.message}`);
      return null;
    }
  }

  // ── GET ALL LATEST RATES ──────────────────────────────────────────────────────
  async getAllLatestRates(): Promise<Record<string, any>> {
    const coins = Object.values(CoinType);
    const rates: Record<string, any> = {};

    for (const coin of coins) {
      try {
        const rate = await this.rateRepo.findOne({
          where: { coin },
          order: { fetchedAt: 'DESC' },
        });
        if (rate) {
          rates[coin] = {
            coinUsdPrice: rate.coinUsdPrice,
            usdNgnRate: rate.usdNgnRate,
            effectiveUsdNgn: rate.effectiveUsdNgn,
            spreadPercent: rate.spreadPercent,
            fetchedAt: rate.fetchedAt,
            expiresAt: rate.expiresAt,
          };
        }
      } catch {}
    }

    return rates;
  }

  // ── CREATE PAYMENT (NowPayments hosted payment) ───────────────────────────────
  async createPayment(
    invoiceId: string,
    coin: CoinType,
    userId: string,
  ): Promise<{
    paymentId: string;
    payAddress: string;
    payAmount: number;
    qrCodeUrl: string;
    expiresAt: Date;
  }> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, userId },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    if (
      invoice.status !== InvoiceStatus.DRAFT &&
      invoice.status !== InvoiceStatus.PENDING
    ) {
      throw new BadRequestException(
        `Invoice cannot be paid. Current status: ${invoice.status}`,
      );
    }

    // Get rate and calculate crypto amount
    const rate = await this.getLatestRate(coin);
    const cryptoAmount = Number(invoice.amountUsd) / Number(rate.coinUsdPrice);

    const currency = COIN_TO_NP[coin];

    try {
      const res = await this.client.post('/payment', {
        price_amount: invoice.amountUsd,
        price_currency: 'usd',
        pay_currency: currency,
        order_id: invoice.id,
        order_description: invoice.title,
        ipn_callback_url: `${this.config.get('APP_URL')}/api/v1/payments/webhook/nowpayments`,
        is_fixed_rate: false,
        is_fee_paid_by_user: false,
      });

      const paymentData = res.data;
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Create or update rate lock
      const existingLock = await this.rateLockRepo.findOne({
        where: { invoiceId },
      });

      if (existingLock) {
        await this.rateLockRepo.update(existingLock.id, {
          exchangeRateId: rate.id,
          coin,
          lockedUsdNgnRate: rate.effectiveUsdNgn,
          lockedCoinUsdPrice: rate.coinUsdPrice,
          cryptoAmountLocked: cryptoAmount,
          lockedAt: new Date(),
          expiresAt,
          isExpired: false,
          usedAt: null,
        });
      } else {
        const lock = this.rateLockRepo.create({
          invoiceId,
          exchangeRateId: rate.id,
          coin,
          lockedUsdNgnRate: rate.effectiveUsdNgn,
          lockedCoinUsdPrice: rate.coinUsdPrice,
          cryptoAmountLocked: cryptoAmount,
          lockedAt: new Date(),
          expiresAt,
          isExpired: false,
        });
        await this.rateLockRepo.save(lock);
      }

      // Save wallet address
      const existingAddress = await this.walletAddressRepo.findOne({
        where: { invoiceId, coin },
      });

      if (!existingAddress) {
        await this.walletAddressRepo.save(
          this.walletAddressRepo.create({
            userId,
            invoiceId,
            coin,
            network: COIN_NETWORK_MAP[coin],
            address: paymentData.pay_address,
            nowpaymentsRef: paymentData.payment_id,
          }),
        );
      }

      // Update invoice
      await this.invoiceRepo.update(invoiceId, {
        status: InvoiceStatus.PENDING,
        selectedCoin: coin,
        cryptoAmount,
        nowpaymentsInvoiceId: paymentData.payment_id,
        paymentAddress: paymentData.pay_address,
        expiresAt,
      });

      // Create pending transaction record
      const existingTx = await this.txRepo.findOne({
        where: { invoiceId, nowpaymentsPaymentId: paymentData.payment_id },
      });

      if (!existingTx) {
        await this.txRepo.save(
          this.txRepo.create({
            invoiceId,
            userId,
            nowpaymentsPaymentId: paymentData.payment_id,
            coin,
            network: COIN_NETWORK_MAP[coin],
            cryptoAmountExpected: cryptoAmount,
            usdAmount: invoice.amountUsd,
            exchangeRateId: rate.id,
            usdToNgnRate: rate.effectiveUsdNgn,
            status: TransactionStatus.WAITING,
            requiredConfirmations: this.getRequiredConfirmations(coin),
          }),
        );
      }

      this.logger.log(
        `Payment created: invoiceId=${invoiceId} paymentId=${paymentData.payment_id} coin=${coin}`,
      );

      return {
        paymentId: paymentData.payment_id,
        payAddress: paymentData.pay_address,
        payAmount: paymentData.pay_amount,
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${paymentData.pay_address}`,
        expiresAt,
      };
    } catch (err) {
      if (err.response?.data) {
        this.logger.error(
          `NowPayments API error: ${JSON.stringify(err.response.data)}`,
        );
        throw new BadRequestException(
          err.response.data.message ?? 'Payment creation failed',
        );
      }
      throw new InternalServerErrorException('Failed to create payment');
    }
  }

  // ── GET PAYMENT STATUS ────────────────────────────────────────────────────────
  async getPaymentStatus(paymentId: string): Promise<any> {
    try {
      const res = await this.client.get(`/payment/${paymentId}`);
      return res.data;
    } catch (err) {
      this.logger.error(`Failed to get payment status: ${err.message}`);
      throw new NotFoundException('Payment not found');
    }
  }

  // ── LOCK RATE FOR INVOICE ─────────────────────────────────────────────────────
  async lockRate(
    invoiceId: string,
    coin: CoinType,
    amountUsd: number,
  ): Promise<{
    rateLockId: string;
    cryptoAmount: number;
    lockedUsdNgnRate: number;
    lockedCoinUsdPrice: number;
    expiresAt: Date;
    expiresInSeconds: number;
  }> {
    const rate = await this.getLatestRate(coin);
    const cryptoAmount = amountUsd / Number(rate.coinUsdPrice);
    const lockMinutes = Number(
      this.config.get<string>('RATE_LOCK_MINUTES') ?? '10',
    );
    const expiresAt = new Date(Date.now() + lockMinutes * 60 * 1000);

    // Expire any existing lock for this invoice
    const existingLock = await this.rateLockRepo.findOne({
      where: { invoiceId },
    });

    if (existingLock) {
      await this.rateLockRepo.update(existingLock.id, { isExpired: true });
    }

    const lock = await this.rateLockRepo.save(
      this.rateLockRepo.create({
        invoiceId,
        exchangeRateId: rate.id,
        coin,
        lockedUsdNgnRate: rate.effectiveUsdNgn,
        lockedCoinUsdPrice: rate.coinUsdPrice,
        cryptoAmountLocked: cryptoAmount,
        lockedAt: new Date(),
        expiresAt,
        isExpired: false,
      }),
    );

    // Link rate lock to invoice
    await this.invoiceRepo.update(invoiceId, {
      rateLockId: lock.id,
      selectedCoin: coin,
      cryptoAmount,
    });

    this.logger.log(
      `Rate locked: invoice=${invoiceId} coin=${coin} crypto=${cryptoAmount} expires=${expiresAt}`,
    );

    return {
      rateLockId: lock.id,
      cryptoAmount,
      lockedUsdNgnRate: Number(rate.effectiveUsdNgn),
      lockedCoinUsdPrice: Number(rate.coinUsdPrice),
      expiresAt,
      expiresInSeconds: lockMinutes * 60,
    };
  }

  // ── PROCESS WEBHOOK ───────────────────────────────────────────────────────────
  async processWebhook(
    rawPayload: string,
    signature: string,
    dto: NowpaymentsWebhookDto,
  ): Promise<{ received: boolean }> {
    // Verify HMAC signature
    const isValid = this.verifyWebhookSignature(rawPayload, signature);
    if (!isValid) {
      this.logger.warn(
        `Invalid NowPayments webhook signature for payment_id=${dto.payment_id}`,
      );
      // Still save for audit but mark invalid
    }

    // Idempotency key — prevent duplicate processing
    const idempotencyKey = `np-${dto.payment_id}-${dto.payment_status}-${dto.updated_at}`;

    const existingEvent = await this.webhookRepo.findOne({
      where: { idempotencyKey },
    });

    if (existingEvent?.processed) {
      this.logger.log(`Duplicate webhook ignored: ${idempotencyKey}`);
      return { received: true };
    }

    // Save webhook event
    const webhookEvent = await this.webhookRepo.save(
      this.webhookRepo.create({
        source: WebhookSource.NOWPAYMENTS,
        eventType: `payment.${dto.payment_status}`,
        externalRef: dto.payment_id,
        payload: JSON.parse(rawPayload),
        signatureValid: isValid,
        processed: false,
        idempotencyKey,
      }),
    );

    try {
      await this.handlePaymentStatusUpdate(dto);

      // Mark as processed
      await this.webhookRepo.update(webhookEvent.id, {
        processed: true,
        processedAt: new Date(),
      });

      this.logger.log(
        `Webhook processed: payment_id=${dto.payment_id} status=${dto.payment_status}`,
      );
    } catch (err) {
      this.logger.error(`Webhook processing failed: ${err.message}`, err.stack);
      await this.webhookRepo.update(webhookEvent.id, {
        processingError: err.message,
      });
    }

    return { received: true };
  }

  // ── HANDLE PAYMENT STATUS UPDATE ──────────────────────────────────────────────
  private async handlePaymentStatusUpdate(
    dto: NowpaymentsWebhookDto,
  ): Promise<void> {
    const invoiceId = dto.order_id;
    if (!invoiceId) {
      this.logger.warn(
        `Webhook missing order_id: payment_id=${dto.payment_id}`,
      );
      return;
    }

    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId },
    });

    if (!invoice) {
      this.logger.warn(`Invoice not found for order_id=${invoiceId}`);
      return;
    }

    // Find or create transaction
    let transaction = await this.txRepo.findOne({
      where: { nowpaymentsPaymentId: dto.payment_id },
    });

    const coin =
      COIN_MAP[dto.pay_currency?.toLowerCase()] ?? CoinType.USDT_TRC20;
    const newStatus = this.mapNowpaymentsStatus(dto.payment_status);

    if (!transaction) {
      // Create transaction if it doesn't exist (edge case)
      const rate = await this.rateRepo.findOne({
        where: { coin },
        order: { fetchedAt: 'DESC' },
      });

      transaction = await this.txRepo.save(
        this.txRepo.create({
          invoiceId,
          userId: invoice.userId,
          nowpaymentsPaymentId: dto.payment_id,
          coin,
          network: COIN_NETWORK_MAP[coin],
          cryptoAmountExpected: dto.pay_amount,
          cryptoAmountReceived: dto.actually_paid,
          usdAmount: dto.price_amount,
          status: newStatus,
          exchangeRateId: rate?.id ?? null,
          usdToNgnRate: rate?.effectiveUsdNgn ?? null,
          requiredConfirmations: this.getRequiredConfirmations(coin),
          nowpaymentsStatus: dto.payment_status,
          metadata: dto as any,
        }),
      );
    } else {
      // Update existing transaction
      await this.txRepo.update(transaction.id, {
        status: newStatus,
        cryptoAmountReceived:
          dto.actually_paid ?? transaction.cryptoAmountReceived,
        txHash: dto.payin_hash ?? transaction.txHash,
        nowpaymentsStatus: dto.payment_status,
        metadata: dto as any,
        ...(newStatus === TransactionStatus.CONFIRMED && {
          confirmedAt: new Date(),
        }),
      });

      transaction = { ...transaction, status: newStatus };
    }

    // Handle each status
    switch (dto.payment_status) {
      case 'waiting':
        await this.onPaymentWaiting(invoice, transaction);
        break;

      case 'confirming':
        await this.onPaymentConfirming(invoice, transaction);
        break;

      case 'confirmed':
      case 'finished':
        await this.paymentQueue.add(
          JOB_PROCESS_PAYMENT,
          {
            paymentId: dto.payment_id,
            invoiceId: invoice.id,
            userId: invoice.userId,
            coin,
            txHash: dto.payin_hash ?? null,
            cryptoAmountReceived: Number(dto.actually_paid ?? dto.pay_amount),
            paymentStatus: dto.payment_status,
            rawWebhookPayload: dto,
          },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5000 },
            jobId: `payment-${dto.payment_id}`, // idempotent job ID
          },
        );

        // Publish to Kafka immediately for real-time streaming
        await this.kafkaService.publish(KafkaTopic.PAYMENT_RECEIVED, {
          paymentId: dto.payment_id,
          invoiceId: invoice.id,
          userId: invoice.userId,
          coin,
          receivedAt: new Date().toISOString(),
        });
        break;
      // await this.onPaymentConfirmed(invoice, transaction, dto);
      // break;

      case 'failed':
      case 'refunded':
      case 'expired':
        await this.onPaymentFailed(invoice, transaction, dto.payment_status);
        break;

      default:
        this.logger.log(`Unhandled payment status: ${dto.payment_status}`);
    }
  }

  // ── STATUS HANDLERS ───────────────────────────────────────────────────────────
  private async onPaymentWaiting(
    invoice: Invoice,
    transaction: Transaction,
  ): Promise<void> {
    await this.sendNotification(
      invoice.userId,
      NotificationType.PAYMENT_WAITING,
      'Payment Detected 👀',
      `We are waiting for your ${transaction.coin} payment for invoice ${invoice.invoiceNumber}. Please send the exact amount to the provided address.`,
      { invoiceId: invoice.id, transactionId: transaction.id },
    );
  }

  private async onPaymentConfirming(
    invoice: Invoice,
    transaction: Transaction,
  ): Promise<void> {
    await this.sendNotification(
      invoice.userId,
      NotificationType.PAYMENT_CONFIRMING,
      'Payment Confirming ⏳',
      `Your ${transaction.coin} payment for invoice ${invoice.invoiceNumber} is being confirmed on the blockchain.`,
      { invoiceId: invoice.id, transactionId: transaction.id },
    );
  }

  async onPaymentConfirmed(
    invoice: Invoice,
    transaction: Transaction,
    dto: NowpaymentsWebhookDto,
  ): Promise<void> {
    // Skip if invoice is already paid
    if (invoice.status === InvoiceStatus.PAID) {
      this.logger.log(`Invoice ${invoice.id} already paid, skipping`);
      return;
    }

    // ── QUIDAX VERIFICATION — runs before any money moves ─────────────────────
    // Only verify if we have a tx hash — some coins confirm without one initially
    if (dto.payin_hash) {
      const coin =
        COIN_MAP[dto.pay_currency?.toLowerCase()] ?? CoinType.USDT_TRC20;
      const cryptoReceived = Number(dto.actually_paid ?? dto.pay_amount);

      const verification = await this.quidaxService.runFullVerification(
        dto.payin_hash,
        coin,
        cryptoReceived,
        dto.payment_id,
      );

      if (!verification.passed) {
        this.logger.error(
          `Payment BLOCKED — Quidax verification failed: ` +
            `paymentId=${dto.payment_id} txHash=${dto.payin_hash} ` +
            `reason="${verification.result.reason}" ` +
            `isFlash=${verification.result.isFlash}`,
        );

        // Mark transaction as suspicious — do not credit wallet
        await this.txRepo.update(transaction.id, {
          status: TransactionStatus.FAILED,
          metadata: {
            ...(transaction.metadata as any),
            blocked: true,
            blockReason: verification.result.reason,
            isFlashDeposit: verification.result.isFlash,
            verificationData: verification,
          },
        });

        // Notify user payment is under review — don't reveal flash detection
        await this.sendNotification(
          invoice.userId,
          NotificationType.PAYOUT_FAILED,
          'Payment Under Review ⏳',
          `Your payment for invoice ${invoice.invoiceNumber} is being verified. ` +
            `This usually takes a few minutes. You will be notified once confirmed.`,
          { invoiceId: invoice.id, transactionId: transaction.id },
        );

        return; // ← STOP HERE — nothing gets credited
      }

      this.logger.log(
        `Quidax verification PASSED for paymentId=${dto.payment_id} ` +
          `confirmations=${verification.result.confirmations}`,
      );
    } else {
      // No tx hash yet — NowPayments sometimes sends confirmed before hash is available
      // Log it but continue — NowPayments themselves have verified it
      this.logger.warn(
        `No tx hash in webhook for paymentId=${dto.payment_id} — ` +
          `proceeding with NowPayments verification only`,
      );
    }

    // ── Continue with normal payment processing ────────────────────────────────
    const rate = await this.rateRepo.findOne({
      where: { coin: transaction.coin },
      order: { fetchedAt: 'DESC' },
    });

    if (!rate) {
      this.logger.error(
        `No rate found for ${transaction.coin} during confirmation`,
      );
      return;
    }

    const cryptoReceived = Number(dto.actually_paid ?? dto.pay_amount);
    const usdReceived = cryptoReceived * Number(rate.coinUsdPrice);
    const feePercent = await this.getPlatformFeePercent();

    // ── NGN conversion (one-time, final — no more exchange rate after this) ────
    const grossNgnAmount = usdReceived * Number(rate.effectiveUsdNgn);
    const platformFeeNgn = grossNgnAmount * (feePercent / 100);
    const platformFeeUsd = usdReceived * (feePercent / 100);
    const platformFeeCrypto = cryptoReceived * (feePercent / 100);
    const netNgnAmount = grossNgnAmount - platformFeeNgn;

    this.logger.log(
      `Fee breakdown: gross_ngn=₦${grossNgnAmount.toFixed(2)} fee=${feePercent}% fee_ngn=₦${platformFeeNgn.toFixed(2)} net_ngn=₦${netNgnAmount.toFixed(2)}`,
    );

    // ── DB transaction ─────────────────────────────────────────────────────────
    await this.dataSource.transaction(async (manager) => {
      const invoiceRepo = manager.getRepository(Invoice);
      const txRepo = manager.getRepository(Transaction);

      await txRepo.update(transaction.id, {
        status: TransactionStatus.CONFIRMED,
        cryptoAmountReceived: cryptoReceived,
        ngnAmount: grossNgnAmount,
        usdToNgnRate: rate.effectiveUsdNgn,
        platformFeeUsd,
        platformFeeNgn,
        netNgnAmount,
        txHash: dto.payin_hash ?? transaction.txHash,
        confirmedAt: new Date(),
        nowpaymentsStatus: dto.payment_status,
      });

      await invoiceRepo.update(invoice.id, {
        status: InvoiceStatus.PAID,
        amountNgn: grossNgnAmount,
        paidAt: new Date(),
      });

      await manager
        .getRepository(RateLock)
        .update({ invoiceId: invoice.id }, { usedAt: new Date() });
    });

    // ── Credit platform fee to system wallet ──────────────────────────────────
    if (platformFeeCrypto > 0) {
      try {
        await this.systemWalletService.creditFee(
          platformFeeNgn,
          `${feePercent}% platform fee for invoice ${invoice.invoiceNumber} — ₦${platformFeeNgn.toFixed(2)}`,
          transaction.id,
        );
      } catch (err) {
        this.logger.error(
          `Failed to credit fee to system wallet: ${err.message}`,
        );
      }
    }

    // ── AUTO-CASHOUT: send directly to bank without user needing to log in ─────
    if (invoice.autoCashout && invoice.autoCashoutBankAccountId) {
      await this.handleAutoCashout(invoice, transaction, netNgnAmount);
    } else {
      // ── MANUAL: credit NGN to user wallet (user decides when to withdraw) ────
      try {
        await this.walletService.creditWallet(
          invoice.userId,
          netNgnAmount,
          `Payment received for invoice ${invoice.invoiceNumber} — ${cryptoReceived} ${transaction.coin} converted to ₦${netNgnAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
          transaction.id,
          `INVOICE-${invoice.id}-${transaction.id}`,
        );

        this.logger.log(
          `Wallet credited: userId=${invoice.userId} amount=₦${netNgnAmount}`,
        );
      } catch (err) {
        this.logger.error(
          `CRITICAL: Failed to credit wallet userId=${invoice.userId} amount=₦${netNgnAmount}: ${err.message}`,
        );
      }

      await this.sendNotification(
        invoice.userId,
        NotificationType.INVOICE_PAID,
        'Payment Received ✅',
        `₦${netNgnAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} has been added to your CryptoPay wallet. Withdraw anytime.`,
        {
          invoiceId: invoice.id,
          transactionId: transaction.id,
          grossNgnAmount,
          platformFeeNgn,
          netNgnAmount,
          cryptoAmount: cryptoReceived,
          coin: transaction.coin,
          autoCashout: false,
        },
      );
    }

    await this.saveAudit(
      invoice.userId,
      AuditActorType.WEBHOOK,
      'payment.confirmed',
      'transactions',
      transaction.id,
      null,
      {
        cryptoReceived,
        usdReceived,
        grossNgnAmount,
        platformFeePercent: feePercent,
        platformFeeNgn,
        netNgnAmount,
        coin: transaction.coin,
        autoCashout: invoice.autoCashout,
        walletCredited: !invoice.autoCashout,
      },
    );

    this.logger.log(
      `Payment confirmed & wallet credited: invoice=${invoice.id} crypto=${cryptoReceived} net_ngn=₦${netNgnAmount}`,
    );
  }

  // ── AUTO-CASHOUT: convert and send to bank instantly ─────────────────────────
  private async handleAutoCashout(
    invoice: Invoice,
    transaction: Transaction,
    netNgnAmount: number,
  ): Promise<void> {
    this.logger.log(
      `Auto-cashout triggered: invoiceId=${invoice.id} amount=₦${netNgnAmount} bankAccountId=${invoice.autoCashoutBankAccountId}`,
    );

    try {
      // Notify user that auto-cashout is in progress
      await this.sendNotification(
        invoice.userId,
        NotificationType.INVOICE_PAID,
        'Payment Received — Auto-cashout in progress 🚀',
        `₦${netNgnAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} is being sent directly to your bank account. No action needed.`,
        {
          invoiceId: invoice.id,
          transactionId: transaction.id,
          netNgnAmount,
          autoCashout: true,
        },
      );

      // Trigger Flutterwave direct payout — no wallet involved
      const payout = await this.flutterwaveService.initiateDirectPayout({
        userId: invoice.userId,
        amountNgn: netNgnAmount,
        bankAccountId: invoice.autoCashoutBankAccountId!,
        narration: `Auto-cashout for invoice ${invoice.invoiceNumber}`,
        reference: `AUTO-${invoice.id}-${transaction.id}`,
      });

      this.logger.log(
        `Auto-cashout initiated: payoutId=${payout.id} invoiceId=${invoice.id} amount=₦${netNgnAmount}`,
      );

      // Deduct NGN reserve immediately
      await this.systemWalletService.deductPayoutReserve(
        netNgnAmount,
        payout.id,
        `Auto-cashout for invoice ${invoice.invoiceNumber}`,
      );

      await this.saveAudit(
        invoice.userId,
        AuditActorType.WEBHOOK,
        'payment.auto_cashout',
        'payouts',
        payout.id,
        null,
        {
          invoiceId: invoice.id,
          transactionId: transaction.id,
          netNgnAmount,
          bankAccountId: invoice.autoCashoutBankAccountId,
          payoutId: payout.id,
        },
      );
    } catch (err) {
      this.logger.error(
        `Auto-cashout FAILED for invoiceId=${invoice.id}: ${err.message}. Falling back to wallet credit.`,
      );

      // ── FALLBACK: if auto-cashout fails, credit wallet instead ──────────────
      // User loses nothing — money goes to wallet and they can withdraw manually
      try {
        await this.walletService.creditWallet(
          invoice.userId,
          netNgnAmount,
          `Auto-cashout failed — funds added to wallet instead. Invoice ${invoice.invoiceNumber}`,
          transaction.id,
          `AUTO-FALLBACK-${invoice.id}-${transaction.id}`,
        );

        await this.sendNotification(
          invoice.userId,
          NotificationType.PAYOUT_FAILED,
          'Auto-cashout failed — funds in wallet ⚠️',
          `We could not send ₦${netNgnAmount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} directly to your bank. The funds have been added to your wallet instead. Please withdraw manually.`,
          {
            invoiceId: invoice.id,
            netNgnAmount,
            error: err.message,
            fallback: 'wallet',
          },
        );
      } catch (walletErr) {
        // Last resort — both failed, alert admins
        this.logger.error(
          `CRITICAL: Both auto-cashout and wallet fallback failed for invoiceId=${invoice.id}. Manual intervention required. Error: ${walletErr.message}`,
        );

        await this.sendNotification(
          invoice.userId,
          NotificationType.PAYOUT_FAILED,
          'Payment processing issue ⚠️',
          `Your payment was received but we had trouble processing it. Our team has been alerted and will resolve this within 24 hours.`,
          {
            invoiceId: invoice.id,
            netNgnAmount,
            requiresManualIntervention: true,
          },
        );
      }
    }
  }

  private async onPaymentFailed(
    invoice: Invoice,
    transaction: Transaction,
    status: string,
  ): Promise<void> {
    const txStatus =
      status === 'refunded'
        ? TransactionStatus.REFUNDED
        : status === 'expired'
          ? TransactionStatus.EXPIRED
          : TransactionStatus.FAILED;

    await this.txRepo.update(transaction.id, { status: txStatus });

    // Only update invoice to expired if it was pending
    if (invoice.status === InvoiceStatus.PENDING) {
      await this.invoiceRepo.update(invoice.id, {
        status:
          status === 'expired'
            ? InvoiceStatus.EXPIRED
            : InvoiceStatus.CANCELLED,
      });
    }

    await this.sendNotification(
      invoice.userId,
      NotificationType.PAYOUT_FAILED,
      `Payment ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      `Your payment for invoice ${invoice.invoiceNumber} has ${status}. ${
        status === 'expired'
          ? 'Please create a new payment.'
          : status === 'refunded'
            ? 'A refund has been initiated.'
            : 'Please try again.'
      }`,
      { invoiceId: invoice.id, transactionId: transaction.id, status },
    );

    this.logger.log(
      `Payment ${status}: invoice=${invoice.id} transaction=${transaction.id}`,
    );
  }

  // ── EXPIRE RATE LOCKS ─────────────────────────────────────────────────────────
  async expireRateLocks(): Promise<void> {
    const expiredLocks = await this.rateLockRepo
      .createQueryBuilder('rl')
      .where('rl.expires_at < :now', { now: new Date() })
      .andWhere('rl.is_expired = false')
      .andWhere('rl.used_at IS NULL')
      .getMany();

    for (const lock of expiredLocks) {
      await this.rateLockRepo.update(lock.id, { isExpired: true });

      // Also expire the invoice if it's still pending
      const invoice = await this.invoiceRepo.findOne({
        where: { id: lock.invoiceId, status: InvoiceStatus.PENDING },
      });

      if (invoice) {
        await this.invoiceRepo.update(invoice.id, {
          status: InvoiceStatus.EXPIRED,
        });

        await this.sendNotification(
          invoice.userId,
          NotificationType.INVOICE_EXPIRED,
          'Payment Window Expired ⏰',
          `The payment window for invoice ${invoice.invoiceNumber} has expired. Please create a new payment link.`,
          { invoiceId: invoice.id },
        );
      }
    }

    if (expiredLocks.length > 0) {
      this.logger.log(`Expired ${expiredLocks.length} rate locks`);
    }
  }

  // ── VERIFY WEBHOOK SIGNATURE ──────────────────────────────────────────────────
  verifyWebhookSignature(payload: string, receivedSig: string): boolean {
    try {
      const sorted = this.sortObjectKeys(JSON.parse(payload));
      const sortedJson = JSON.stringify(sorted);

      const expectedSig = crypto
        .createHmac('sha512', this.ipnSecret)
        .update(sortedJson)
        .digest('hex');

      return expectedSig === receivedSig;
    } catch {
      return false;
    }
  }

  // ── HELPER: MAP NOWPAYMENTS STATUS → OUR STATUS ───────────────────────────────
  private mapNowpaymentsStatus(npStatus: string): TransactionStatus {
    const map: Record<string, TransactionStatus> = {
      waiting: TransactionStatus.WAITING,
      confirming: TransactionStatus.CONFIRMING,
      confirmed: TransactionStatus.CONFIRMED,
      finished: TransactionStatus.CONFIRMED,
      failed: TransactionStatus.FAILED,
      refunded: TransactionStatus.REFUNDED,
      expired: TransactionStatus.EXPIRED,
    };
    return map[npStatus] ?? TransactionStatus.WAITING;
  }

  // ── HELPER: GET REQUIRED CONFIRMATIONS PER COIN ───────────────────────────────
  private getRequiredConfirmations(coin: CoinType): number {
    const map: Record<CoinType, number> = {
      [CoinType.BTC]: 2,
      [CoinType.ETH]: 12,
      [CoinType.SOL]: 1,
      [CoinType.USDT_TRC20]: 20,
      [CoinType.USDT_ERC20]: 12,
      [CoinType.LTC]: 6, // ← add: Litecoin needs 6 confirmations
      [CoinType.TRX]: 20,
    };
    return map[coin] ?? 1;
  }

  // ── HELPER: GET USD/NGN RATE ──────────────────────────────────────────────────
  private async getUsdNgnRate(): Promise<number> {
    // Try each provider in order — first success wins
    const providers = [
      () => this.getRateFromExchangeRateApi(),
      () => this.getRateFromCoinbase(),
    ];

    for (const provider of providers) {
      try {
        const rate = await provider();
        if (rate && rate > 100) {
          this.logger.log(`USD/NGN rate fetched: ${rate}`);
          return rate;
        }
      } catch (err) {
        this.logger.warn(
          `Rate provider [Coinbase] failed: ${err.message ?? err.code ?? 'unknown error'}`,
        );
      }
    }

    // Last resort — read from latest saved rate in DB (never hardcoded)
    const latest = await this.rateRepo.findOne({
      where: {},
      order: { fetchedAt: 'DESC' },
    });

    if (latest && Number(latest.usdNgnRate) > 100) {
      this.logger.warn('All rate providers failed — using last saved DB rate');
      return Number(latest.usdNgnRate);
    }

    throw new InternalServerErrorException(
      'Unable to fetch USD/NGN rate from any provider. Please try again.',
    );
  }

  // ── Provider 1: Coinbase (no API key needed for spot prices) ──────────────────
  private async getRateFromCoinbase(): Promise<number> {
    try {
      const res = await axios.get(
        'https://api.coinbase.com/v2/exchange-rates?currency=USD',
        { timeout: 8000 },
      );

      const ngnRate = res.data?.data?.rates?.NGN;
      if (!ngnRate) throw new Error('NGN rate not found in Coinbase response');

      const rate = Number(ngnRate);
      this.logger.debug(`Coinbase USD/NGN: ${rate}`);
      return rate;
    } catch (err) {
      // Rethrow with detail so the caller logs it properly
      const reason = err.response?.status
        ? `HTTP ${err.response.status} — ${err.response?.data?.message ?? 'no detail'}`
        : err.code
          ? `Network error: ${err.code}`
          : err.message || 'Unknown error';

      throw new Error(`Coinbase: ${reason}`);
    }
  }

  // ── Provider 2: ExchangeRate-API (free tier, 1500 req/month) ──────────────────
  private async getRateFromExchangeRateApi(): Promise<number> {
    const apiKey = this.config.get<string>('EXCHANGE_RATE_API_KEY');
    const url = apiKey
      ? `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`
      : 'https://open.er-api.com/v6/latest/USD'; // free tier, no key needed

    const res = await axios.get(url, { timeout: 8000 });

    const rate = res.data?.rates?.NGN ?? res.data?.conversion_rates?.NGN;
    if (!rate) throw new Error('NGN rate not in ExchangeRate-API response');

    this.logger.debug(`ExchangeRate-API USD/NGN: ${rate}`);
    return Number(rate);
  }

  // ── HELPER: SORT OBJECT KEYS (for NowPayments signature) ─────────────────────
  private sortObjectKeys(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.sortObjectKeys(item));
    return Object.keys(obj)
      .sort()
      .reduce((sorted: any, key) => {
        sorted[key] = this.sortObjectKeys(obj[key]);
        return sorted;
      }, {});
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

  // ── HELPER: GET PLATFORM FEE PERCENT FROM SETTINGS ───────────────────────────
  private async getPlatformFeePercent(): Promise<number> {
    try {
      const setting = await this.dataSource
        .getRepository('platform_settings')
        .findOne({ where: { key: 'transaction_fee_percent' } });

      if (setting && setting.value) {
        const fee = Number(setting.value);
        if (!isNaN(fee) && fee >= 0 && fee <= 10) return fee;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to read fee from platform_settings: ${err.message}`,
      );
    }

    // Safe fallback — read from env, then default to 1.5%
    const envFee = this.config.get<string>('PLATFORM_FEE_PERCENT');
    return envFee ? Number(envFee) : 1.5;
  }
}
