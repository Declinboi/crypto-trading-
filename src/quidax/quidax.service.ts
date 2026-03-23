import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';

import { Transaction } from '../entities/transaction.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';
import {
  CoinType,
  TransactionStatus,
  AuditActorType,
  NotificationType,
  NotificationChannel,
} from '../entities/enums';
import { User } from 'src/entities';

// Quidax coin/network → our CoinType mapping
const QUIDAX_CURRENCY_MAP: Record<string, CoinType> = {
  usdt_trc20: CoinType.USDT_TRC20,
  usdt_erc20: CoinType.USDT_ERC20,
  eth: CoinType.ETH,
  btc: CoinType.BTC,
  sol: CoinType.SOL,
  ltc: CoinType.LTC, // ← add
  trx: CoinType.TRX,
};

// Minimum confirmations required per coin before we trust it
const MIN_CONFIRMATIONS: Record<CoinType, number> = {
  [CoinType.USDT_TRC20]: 20, // Tron — ~1 min per block
  [CoinType.USDT_ERC20]: 12, // Ethereum — ~12 secs per block
  [CoinType.ETH]: 12,
  [CoinType.BTC]: 2, // Bitcoin — ~10 min per block
  [CoinType.SOL]: 1, // Solana — very fast
  [CoinType.LTC]: 6, // ← add
  [CoinType.TRX]: 20,
};

export interface QuidaxDeposit {
  id: string;
  currency: string;
  amount: string;
  fee: string;
  txid: string;
  confirmations: number;
  state: string; // 'submitted' | 'accepted' | 'checked' | 'warning'
  created_at: string;
  completed_at: string | null;
  blockchain_url: string;
}

export interface VerificationResult {
  verified: boolean;
  reason: string;
  deposit: QuidaxDeposit | null;
  confirmations: number;
  requiredConfirmations: number;
  amountMatches: boolean;
  isFlash: boolean;
}

@Injectable()
export class QuidaxService {
  private readonly logger = new Logger(QuidaxService.name);
  private readonly client: AxiosInstance;

  constructor(
    private config: ConfigService,

    @InjectRepository(Transaction)
    private txRepo: Repository<Transaction>,

    @InjectRepository(WebhookEvent)
    private webhookRepo: Repository<WebhookEvent>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
  ) {
    this.client = axios.create({
      baseURL: 'https://www.quidax.com/api/v1',
      headers: {
        Authorization: `Bearer ${config.get<string>('QUIDAX_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  // ── VERIFY A SPECIFIC DEPOSIT BY TX HASH ─────────────────────────────────────
  // This is the main method called after NowPayments confirms a payment
  // It cross-checks the deposit actually arrived at Quidax
  async verifyDepositByTxHash(
    txHash: string,
    coin: CoinType,
    expectedAmountCrypto: number,
  ): Promise<VerificationResult> {
    this.logger.log(
      `Verifying deposit: txHash=${txHash} coin=${coin} expected=${expectedAmountCrypto}`,
    );

    try {
      // Get all deposits for this currency
      const deposits = await this.getDeposits(coin);

      // Find the deposit matching this tx hash
      const deposit = deposits.find(
        (d) => d.txid?.toLowerCase() === txHash.toLowerCase(),
      );

      if (!deposit) {
        this.logger.warn(
          `Deposit NOT found on Quidax: txHash=${txHash} coin=${coin}`,
        );
        return {
          verified: false,
          reason: `Transaction ${txHash} not found on Quidax. Possible flash/fake deposit.`,
          deposit: null,
          confirmations: 0,
          requiredConfirmations: MIN_CONFIRMATIONS[coin],
          amountMatches: false,
          isFlash: true,
        };
      }

      const requiredConfirmations = MIN_CONFIRMATIONS[coin];
      const actualConfirmations = deposit.confirmations ?? 0;
      const receivedAmount = Number(deposit.amount) - Number(deposit.fee);
      const tolerance = 0.00001; // tiny tolerance for float precision
      const amountMatches =
        Math.abs(receivedAmount - expectedAmountCrypto) <= tolerance;

      // ── Flash deposit detection ─────────────────────────────────────────────
      // A flash deposit appears briefly with 0 confirmations then disappears
      // Real deposits stay and accumulate confirmations
      const isFlash =
        deposit.state === 'warning' ||
        (actualConfirmations === 0 && deposit.state !== 'accepted');

      if (isFlash) {
        this.logger.warn(
          `FLASH DEPOSIT DETECTED: txHash=${txHash} state=${deposit.state} confirmations=${actualConfirmations}`,
        );
        await this.alertAdminsFlashDeposit(txHash, coin, deposit);
        return {
          verified: false,
          reason: `Flash/fake deposit detected. State: ${deposit.state}, Confirmations: ${actualConfirmations}`,
          deposit,
          confirmations: actualConfirmations,
          requiredConfirmations,
          amountMatches,
          isFlash: true,
        };
      }

      // ── Confirmation check ──────────────────────────────────────────────────
      if (actualConfirmations < requiredConfirmations) {
        this.logger.log(
          `Deposit found but under-confirmed: ${actualConfirmations}/${requiredConfirmations} confirmations`,
        );
        return {
          verified: false,
          reason: `Insufficient confirmations. Have: ${actualConfirmations}, Need: ${requiredConfirmations}`,
          deposit,
          confirmations: actualConfirmations,
          requiredConfirmations,
          amountMatches,
          isFlash: false,
        };
      }

      // ── State check ─────────────────────────────────────────────────────────
      // Quidax marks deposits as 'accepted' or 'checked' when fully confirmed
      const validStates = ['accepted', 'checked'];
      if (!validStates.includes(deposit.state)) {
        return {
          verified: false,
          reason: `Deposit in invalid state: ${deposit.state}. Expected: accepted or checked.`,
          deposit,
          confirmations: actualConfirmations,
          requiredConfirmations,
          amountMatches,
          isFlash: false,
        };
      }

      // ── Amount check ────────────────────────────────────────────────────────
      if (!amountMatches) {
        this.logger.warn(
          `Amount mismatch: expected=${expectedAmountCrypto} received=${receivedAmount} coin=${coin}`,
        );
        return {
          verified: false,
          reason: `Amount mismatch. Expected: ${expectedAmountCrypto} ${coin}, Received: ${receivedAmount} ${coin}`,
          deposit,
          confirmations: actualConfirmations,
          requiredConfirmations,
          amountMatches: false,
          isFlash: false,
        };
      }

      // ── All checks passed ───────────────────────────────────────────────────
      this.logger.log(
        `Deposit VERIFIED: txHash=${txHash} amount=${receivedAmount} ${coin} confirmations=${actualConfirmations}`,
      );

      return {
        verified: true,
        reason: 'Deposit verified on Quidax blockchain',
        deposit,
        confirmations: actualConfirmations,
        requiredConfirmations,
        amountMatches: true,
        isFlash: false,
      };
    } catch (err) {
      this.logger.error(`Quidax verification failed: ${err.message}`);
      // Don't throw — return unverified so payment is held pending
      return {
        verified: false,
        reason: `Quidax API error: ${err.message}`,
        deposit: null,
        confirmations: 0,
        requiredConfirmations: MIN_CONFIRMATIONS[coin],
        amountMatches: false,
        isFlash: false,
      };
    }
  }

  // ── GET ALL DEPOSITS FOR A COIN ───────────────────────────────────────────────
  async getDeposits(coin: CoinType, limit = 50): Promise<QuidaxDeposit[]> {
    try {
      const currency = this.coinToQuidaxCurrency(coin);
      const res = await this.client.get(
        `/users/me/deposits?currency=${currency}&limit=${limit}&order=desc`,
      );

      if (res.data.status !== 'success') {
        throw new Error(res.data.message ?? 'Failed to fetch deposits');
      }

      return res.data.data ?? [];
    } catch (err) {
      this.logger.error(
        `Failed to fetch Quidax deposits for ${coin}: ${err.message}`,
      );
      return [];
    }
  }

  // ── GET SINGLE DEPOSIT BY ID ──────────────────────────────────────────────────
  async getDepositById(depositId: string): Promise<QuidaxDeposit | null> {
    try {
      const res = await this.client.get(`/users/me/deposits/${depositId}`);
      if (res.data.status !== 'success') return null;
      return res.data.data;
    } catch {
      return null;
    }
  }

  // ── GET WALLET BALANCES (confirm what Quidax actually holds) ─────────────────
  async getWalletBalances(): Promise<
    Record<
      string,
      {
        balance: number;
        lockedBalance: number;
        currency: string;
      }
    >
  > {
    try {
      const res = await this.client.get('/users/me/wallets');

      if (res.data.status !== 'success') {
        throw new Error('Failed to fetch Quidax wallet balances');
      }

      const balances: Record<string, any> = {};

      for (const wallet of res.data.data ?? []) {
        balances[wallet.currency] = {
          balance: Number(wallet.balance),
          lockedBalance: Number(wallet.locked),
          currency: wallet.currency,
        };
      }

      return balances;
    } catch (err) {
      this.logger.error(`Failed to fetch Quidax balances: ${err.message}`);
      throw new InternalServerErrorException(
        'Failed to fetch Quidax wallet balances',
      );
    }
  }

  // ── GET SPECIFIC COIN BALANCE ─────────────────────────────────────────────────
  async getCoinBalance(coin: CoinType): Promise<{
    balance: number;
    lockedBalance: number;
    currency: string;
  }> {
    const currency = this.coinToQuidaxCurrency(coin);
    try {
      const res = await this.client.get(`/users/me/wallets/${currency}`);
      if (res.data.status !== 'success') {
        throw new Error(`Failed to fetch ${coin} balance`);
      }
      return {
        balance: Number(res.data.data.balance),
        lockedBalance: Number(res.data.data.locked),
        currency,
      };
    } catch (err) {
      this.logger.error(`Failed to fetch ${coin} balance: ${err.message}`);
      throw new InternalServerErrorException(`Failed to fetch ${coin} balance`);
    }
  }

  // ── VERIFY TRANSACTION EXISTS ON BLOCKCHAIN VIA QUIDAX ───────────────────────
  // Double-check using Quidax's blockchain explorer integration
  async verifyOnBlockchain(
    txHash: string,
    coin: CoinType,
  ): Promise<{
    exists: boolean;
    confirmations: number;
    amount: number | null;
  }> {
    try {
      // Quidax blockchain verification endpoint
      const currency = this.coinToQuidaxCurrency(coin);
      const res = await this.client.get(
        `/blockchain/transaction?txid=${txHash}&currency=${currency}`,
      );

      if (res.data.status !== 'success') {
        return { exists: false, confirmations: 0, amount: null };
      }

      return {
        exists: true,
        confirmations: res.data.data?.confirmations ?? 0,
        amount: Number(res.data.data?.amount ?? 0),
      };
    } catch {
      return { exists: false, confirmations: 0, amount: null };
    }
  }

  // ── FULL VERIFICATION PIPELINE ────────────────────────────────────────────────
  // Called from NowPayments webhook after payment confirmed
  // This is the MAIN method that protects against flash deposits
  async runFullVerification(
    txHash: string,
    coin: CoinType,
    expectedAmountCrypto: number,
    nowpaymentsPaymentId: string,
  ): Promise<{
    passed: boolean;
    result: VerificationResult;
    blockchainCheck: {
      exists: boolean;
      confirmations: number;
      amount: number | null;
    };
  }> {
    this.logger.log(
      `Running full verification: txHash=${txHash} coin=${coin} ` +
        `expected=${expectedAmountCrypto} npPaymentId=${nowpaymentsPaymentId}`,
    );

    // Run Quidax deposit check and blockchain check in parallel
    const [quidaxResult, blockchainCheck] = await Promise.all([
      this.verifyDepositByTxHash(txHash, coin, expectedAmountCrypto),
      this.verifyOnBlockchain(txHash, coin),
    ]);

    // If Quidax says it's a flash deposit, blockchain must also confirm it exists
    if (!quidaxResult.verified) {
      this.logger.warn(
        `Verification FAILED: txHash=${txHash} reason="${quidaxResult.reason}" ` +
          `blockchainExists=${blockchainCheck.exists}`,
      );

      // Save audit of failed verification
      await this.auditRepo.save(
        this.auditRepo.create({
          userId: null,
          actorType: AuditActorType.SYSTEM,
          action: 'payment.verification_failed',
          entityType: 'transactions',
          entityId: nowpaymentsPaymentId,
          oldValues: null,
          newValues: {
            txHash,
            coin,
            expectedAmount: expectedAmountCrypto,
            quidaxResult,
            blockchainCheck,
            isFlash: quidaxResult.isFlash,
          },
        }),
      );

      return { passed: false, result: quidaxResult, blockchainCheck };
    }

    // Additional cross-check — blockchain and Quidax amounts should match
    if (
      blockchainCheck.exists &&
      blockchainCheck.amount !== null &&
      blockchainCheck.amount > 0
    ) {
      const tolerance = 0.00001;
      const blockchainMatch =
        Math.abs(blockchainCheck.amount - expectedAmountCrypto) <= tolerance;

      if (!blockchainMatch) {
        this.logger.warn(
          `Blockchain amount mismatch: ` +
            `blockchain=${blockchainCheck.amount} expected=${expectedAmountCrypto}`,
        );
      }
    }

    this.logger.log(
      `Full verification PASSED: txHash=${txHash} coin=${coin} ` +
        `confirmations=${quidaxResult.confirmations}`,
    );

    return { passed: true, result: quidaxResult, blockchainCheck };
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────────
  private coinToQuidaxCurrency(coin: CoinType): string {
    const map: Record<CoinType, string> = {
      [CoinType.USDT_TRC20]: 'usdt',
      [CoinType.USDT_ERC20]: 'usdt',
      [CoinType.ETH]: 'eth',
      [CoinType.BTC]: 'btc',
      [CoinType.SOL]: 'sol',
      [CoinType.LTC]: 'ltc', // ← add
      [CoinType.TRX]: 'trx',
    };
    return map[coin] ?? coin;
  }

  private async alertAdminsFlashDeposit(
    txHash: string,
    coin: CoinType,
    deposit: QuidaxDeposit,
  ): Promise<void> {
    this.logger.error(
      `🚨 FLASH DEPOSIT ALERT: txHash=${txHash} coin=${coin} ` +
        `state=${deposit.state} confirmations=${deposit.confirmations}`,
    );

    // Get all admins

    const userRepo = this.txRepo.manager.getRepository(User);
    const admins = await userRepo.find({
      where: [{ role: 'admin' as any }, { role: 'super_admin' as any }],
    });

    for (const admin of admins) {
      await this.notifRepo.save(
        this.notifRepo.create({
          userId: admin.id,
          type: NotificationType.PAYOUT_FAILED,
          channel: NotificationChannel.IN_APP,
          title: '🚨 Flash/Fake Deposit Detected',
          body:
            `A suspicious deposit was detected and BLOCKED. ` +
            `TxHash: ${txHash.substring(0, 20)}... ` +
            `Coin: ${coin} State: ${deposit.state} ` +
            `Confirmations: ${deposit.confirmations}. ` +
            `Payment has been held for manual review.`,
          data: {
            txHash,
            coin,
            depositState: deposit.state,
            confirmations: deposit.confirmations,
            amount: deposit.amount,
            requiresManualReview: true,
          },
        }),
      );
    }
  }
}
