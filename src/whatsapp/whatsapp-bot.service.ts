import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import Redis from 'ioredis';

import { GupshupService } from './gupshup.service';
import { WhatsappSessionService, BotState } from './whatsapp-session.service';
import { WhatsappOtpService } from './whatsapp-otp.service';
import { WalletService } from '../wallet/wallet.service';
import { InvoiceService } from '../invoice/invoice.service';
import { EmailService } from '../email/email.service';
import { REDIS_CLIENT } from '../redis/redis.module';

import { User } from '../entities/user.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { Notification } from '../entities/notification.entity';
import {
  NotificationType,
  NotificationChannel,
  KycStatus,
} from '../entities/enums';

@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  constructor(
    private gupshup: GupshupService,
    private session: WhatsappSessionService,
    private walletSvc: WalletService,
    private invoiceSvc: InvoiceService,
    private emailSvc: EmailService,
    private waOtpService: WhatsappOtpService,
    private dataSource: DataSource,

    @Inject(REDIS_CLIENT)
    private redis: Redis,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(BankAccount)
    private bankRepo: Repository<BankAccount>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,
  ) {}

  // ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────
  async handleIncomingMessage(params: {
    phone: string;
    message: string;
    type: string;
    name?: string;
  }): Promise<void> {
    const { phone, message, type, name } = params;
    const text = message.trim();

    this.logger.log(`WhatsApp from ${phone}: "${text}"`);

    const s = (await this.session.get(phone)) ?? {
      phone,
      state: BotState.IDLE,
      data: {},
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const user = await this.userRepo.findOne({
      where: { phone: this.normalizePhone(phone) },
    });

    if (await this.handleGlobalCommands(phone, text, user, s)) return;

    switch (s.state) {
      case BotState.IDLE:
        if (!user) {
          await this.showUnregisteredMenu(phone, name);
        } else {
          await this.showMainMenu(phone, user);
        }
        break;

      case BotState.AWAITING_OTP:
        await this.handleOtpInput(phone, text, s);
        break;

      case BotState.AWAITING_PIN:
        await this.handlePinInput(phone, text, user!, s);
        break;

      case BotState.AWAITING_TRANSFER_TAG:
        await this.handleTransferTag(phone, text, user!, s);
        break;

      case BotState.AWAITING_TRANSFER_AMOUNT:
        await this.handleTransferAmount(phone, text, user!, s);
        break;

      case BotState.AWAITING_TRANSFER_CONFIRM:
        await this.handleTransferConfirm(phone, text, user!, s);
        break;

      case BotState.AWAITING_WITHDRAW_AMOUNT:
        await this.handleWithdrawAmount(phone, text, user!, s);
        break;

      case BotState.AWAITING_WITHDRAW_BANK:
        await this.handleWithdrawBank(phone, text, user!, s);
        break;

      case BotState.AWAITING_WITHDRAW_CONFIRM:
        await this.handleWithdrawConfirm(phone, text, user!, s);
        break;

      case BotState.AWAITING_INVOICE_AMOUNT:
        await this.handleInvoiceAmount(phone, text, user!, s);
        break;

      case BotState.AWAITING_INVOICE_TITLE:
        await this.handleInvoiceTitle(phone, text, user!, s);
        break;

      case BotState.AWAITING_INVOICE_CONFIRM:
        await this.handleInvoiceConfirm(phone, text, user!, s);
        break;

      default:
        await this.showMainMenu(phone, user!);
    }
  }

  // ── GLOBAL COMMANDS ───────────────────────────────────────────────────────────
  private async handleGlobalCommands(
    phone: string,
    text: string,
    user: User | null,
    s: any,
  ): Promise<boolean> {
    const lower = text.toLowerCase();

    if (['menu', 'start', 'hi', 'hello', 'hey', '0'].includes(lower)) {
      await this.session.clear(phone);
      if (!user) {
        await this.showUnregisteredMenu(phone);
      } else {
        await this.showMainMenu(phone, user);
      }
      return true;
    }

    if (lower === 'cancel' || lower === 'back') {
      await this.session.clear(phone);
      await this.gupshup.sendText(
        phone,
        '❌ Operation cancelled.\n\nSend *menu* to return to the main menu.',
      );
      return true;
    }

    if (lower === 'help') {
      await this.sendHelp(phone);
      return true;
    }

    if (lower === 'balance' && user) {
      await this.sendBalance(phone, user);
      return true;
    }

    if (lower === 'rates') {
      await this.sendRates(phone);
      return true;
    }

    return false;
  }

  // ── FIX 1: MISSING handleOtpInput ────────────────────────────────────────────
  // Called when user is in AWAITING_OTP state (phone verification during signup)
  private async handleOtpInput(
    phone: string,
    text: string,
    s: any,
  ): Promise<void> {
    const otp = text.trim();

    if (!/^\d{6}$/.test(otp)) {
      await this.gupshup.sendText(
        phone,
        `❌ Invalid OTP format. Please enter the 6-digit code sent to your WhatsApp.\n\n` +
          `Send *cancel* to abort.`,
      );
      return;
    }

    const result = await this.waOtpService.verifyOtp(phone, otp);

    if (!result.valid) {
      const attempts = await this.session.incrementAttempts(phone);

      if (attempts >= 3) {
        await this.session.clear(phone);
        await this.gupshup.sendText(
          phone,
          `🔒 Too many incorrect attempts. Session ended.\n\n` +
            `Please request a new OTP from the app.`,
        );
        return;
      }

      await this.gupshup.sendText(phone, `❌ ${result.reason}`);
      return;
    }

    // OTP verified — update user phone verification status
    const normalizedPhone = this.normalizePhone(phone);
    await this.userRepo.update(
      { phone: normalizedPhone },
      { isPhoneVerified: true },
    );

    await this.session.clear(phone);

    await this.gupshup.sendText(
      phone,
      `✅ *Phone number verified successfully!*\n\n` +
        `Your WhatsApp is now linked to your CryptoPay NG account.\n\n` +
        `Send *menu* to see what you can do.`,
    );

    this.logger.log(`Phone verified via WhatsApp OTP: ${phone}`);
  }

  // ── UNREGISTERED MENU ─────────────────────────────────────────────────────────
  private async showUnregisteredMenu(
    phone: string,
    name?: string,
  ): Promise<void> {
    const greeting = name ? `Hi *${name}*! 👋` : 'Hello! 👋';
    await this.gupshup.sendText(
      phone,
      `${greeting}\n\n` +
        `Welcome to *CryptoPay NG* 🚀\n` +
        `_Receive crypto, get paid in Naira_\n\n` +
        `It looks like you don't have an account linked to this number.\n\n` +
        `📱 Sign up at:\n${process.env.FRONTEND_URL}\n\n` +
        `Already have an account? Link your WhatsApp from *Settings* in the app.`,
    );
  }

  // ── MAIN MENU ─────────────────────────────────────────────────────────────────
  private async showMainMenu(phone: string, user: User): Promise<void> {
    const walletData = await this.walletSvc.getMyWallet(user.id);
    const summary = await this.walletSvc.getWalletSummary(user.id);
    const balance = Number(summary.availableBalance).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
    });

    // FIX 2: use 'to' not 'phone'
    await this.gupshup.sendList({
      to: phone,
      header: `💰 CryptoPay NG`,
      body:
        `Hello *${user.firstName}*! 👋\n\n` +
        `💳 *Wallet Tag:* @${walletData.tag}\n` +
        `💵 *Balance:* ₦${balance}\n\n` +
        `What would you like to do?`,
      footer: 'CryptoPay NG Bot',
      buttonText: 'Select Option',
      sections: [
        {
          title: '💸 Transactions',
          rows: [
            {
              id: 'BALANCE',
              title: '💰 Check Balance',
              description: 'View your wallet balance',
            },
            {
              id: 'TRANSFER',
              title: '↗️ Send Money',
              description: 'Transfer to another user',
            },
            {
              id: 'WITHDRAW',
              title: '🏦 Withdraw',
              description: 'Send to your bank account',
            },
          ],
        },
        {
          title: '📄 Invoices',
          rows: [
            {
              id: 'INVOICE_CREATE',
              title: '➕ Create Invoice',
              description: 'Create a payment link',
            },
            {
              id: 'INVOICE_LIST',
              title: '📋 My Invoices',
              description: 'View recent invoices',
            },
          ],
        },
        {
          title: '📊 Account',
          rows: [
            {
              id: 'RATES',
              title: '📈 Exchange Rates',
              description: 'Current crypto rates',
            },
            {
              id: 'HISTORY',
              title: '📜 Transactions',
              description: 'Recent transaction history',
            },
            { id: 'HELP', title: '❓ Help', description: 'Get assistance' },
          ],
        },
      ],
    });
  }

  // ── MENU OPTION ROUTER ────────────────────────────────────────────────────────
  async handleMenuOption(
    phone: string,
    option: string,
    user: User,
  ): Promise<void> {
    switch (option) {
      case 'BALANCE':
        await this.sendBalance(phone, user);
        break;
      case 'TRANSFER':
        await this.startTransfer(phone, user);
        break;
      case 'WITHDRAW':
        await this.startWithdraw(phone, user);
        break;
      case 'INVOICE_CREATE':
        await this.startInvoiceCreate(phone, user);
        break;
      case 'INVOICE_LIST':
        await this.sendInvoiceList(phone, user);
        break;
      case 'RATES':
        await this.sendRates(phone);
        break;
      case 'HISTORY':
        await this.sendTransactionHistory(phone, user);
        break;
      case 'HELP':
        await this.sendHelp(phone);
        break;
      default:
        await this.showMainMenu(phone, user);
    }
  }

  // ── BALANCE ───────────────────────────────────────────────────────────────────
  private async sendBalance(phone: string, user: User): Promise<void> {
    const summary = await this.walletSvc.getWalletSummary(user.id);

    await this.gupshup.sendText(
      phone,
      `💰 *Wallet Balance*\n\n` +
        `Available:      *₦${Number(summary.availableBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
        `Total Received: ₦${Number(summary.totalReceivedNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}\n` +
        `Total Sent:     ₦${Number(summary.totalSentNgn).toLocaleString('en-NG', { minimumFractionDigits: 2 })}\n\n` +
        `🏷 Tag: *@${summary.tag}*\n\n` +
        `Send *menu* for more options.`,
    );
  }

  // ── TRANSFER FLOW ─────────────────────────────────────────────────────────────
  private async startTransfer(phone: string, user: User): Promise<void> {
    if (!user.isPinSet) {
      await this.gupshup.sendText(
        phone,
        `⚠️ You need to set a transaction PIN first.\n\nPlease set your PIN in the CryptoPay NG app.`,
      );
      return;
    }

    await this.session.setState(phone, BotState.AWAITING_TRANSFER_TAG);
    await this.gupshup.sendText(
      phone,
      `↗️ *Send Money*\n\n` +
        `Enter the recipient's wallet tag:\n_(e.g. @JOHN1234 or JOHN1234)_\n\n` +
        `Send *cancel* to abort.`,
    );
  }

  private async handleTransferTag(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    const tag = text.replace('@', '').toUpperCase().trim();

    if (tag.length < 4) {
      await this.gupshup.sendText(
        phone,
        `❌ Invalid tag. Please enter a valid wallet tag.`,
      );
      return;
    }

    try {
      const recipient = await this.walletSvc.getWalletByTag(tag);
      await this.session.setState(phone, BotState.AWAITING_TRANSFER_AMOUNT, {
        recipientTag: recipient.tag,
        recipientName: recipient.ownerName,
      });

      await this.gupshup.sendText(
        phone,
        `✅ Recipient found:\n` +
          `Name: *${recipient.ownerName}*\n` +
          `Tag:  *@${recipient.tag}*\n\n` +
          `How much do you want to send? (₦)\n_(Minimum: ₦100)_\n\n` +
          `Send *cancel* to abort.`,
      );
    } catch {
      await this.gupshup.sendText(
        phone,
        `❌ No wallet found for *@${tag}*.\n\nPlease check the tag and try again.`,
      );
    }
  }

  private async handleTransferAmount(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    const amount = parseFloat(text.replace(/,/g, '').replace(/₦/g, '').trim());

    if (isNaN(amount) || amount < 100) {
      await this.gupshup.sendText(
        phone,
        `❌ Invalid amount. Minimum transfer is ₦100.`,
      );
      return;
    }

    const summary = await this.walletSvc.getWalletSummary(user.id);

    if (amount > Number(summary.availableBalance)) {
      await this.gupshup.sendText(
        phone,
        `❌ Insufficient balance.\n\n` +
          `Available: ₦${Number(summary.availableBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}\n` +
          `Requested: ₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
      );
      return;
    }

    await this.session.setState(phone, BotState.AWAITING_PIN, {
      ...s.data,
      amount,
      pendingAction: 'TRANSFER',
    });

    await this.gupshup.sendText(
      phone,
      `↗️ *Confirm Transfer*\n\n` +
        `To:     *@${s.data.recipientTag}* (${s.data.recipientName})\n` +
        `Amount: *₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
        `Fee:    *Free ✅*\n\n` +
        `*Enter your 4-digit PIN to confirm:*\n\n` +
        `Send *cancel* to abort.`,
    );
  }

  private async handleTransferConfirm(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    await this.handlePinInput(phone, text, user, s);
  }

  // ── WITHDRAW FLOW ─────────────────────────────────────────────────────────────
  private async startWithdraw(phone: string, user: User): Promise<void> {
    if (!user.isPinSet) {
      await this.gupshup.sendText(
        phone,
        `⚠️ You need to set a transaction PIN first.\n\nPlease set your PIN in the app.`,
      );
      return;
    }

    const banks = await this.bankRepo.find({
      where: { userId: user.id, isVerified: true },
    });

    if (banks.length === 0) {
      await this.gupshup.sendText(
        phone,
        `⚠️ No verified bank account found.\n\nPlease add and verify a bank account in the app first.`,
      );
      return;
    }

    await this.session.setState(phone, BotState.AWAITING_WITHDRAW_AMOUNT, {
      banks: banks.map((b) => ({
        id: b.id,
        bankName: b.bankName,
        accountLastFour: b.accountNumber.slice(-4),
        isDefault: b.isDefault,
      })),
    });

    await this.gupshup.sendText(
      phone,
      `🏦 *Withdraw to Bank*\n\n` +
        `How much do you want to withdraw? (₦)\n_(Minimum: ₦500)_\n\n` +
        `Send *cancel* to abort.`,
    );
  }

  private async handleWithdrawAmount(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    const amount = parseFloat(text.replace(/,/g, '').replace(/₦/g, '').trim());

    if (isNaN(amount) || amount < 500) {
      await this.gupshup.sendText(
        phone,
        `❌ Invalid amount. Minimum withdrawal is ₦500.`,
      );
      return;
    }

    const summary = await this.walletSvc.getWalletSummary(user.id);

    if (amount > Number(summary.availableBalance)) {
      await this.gupshup.sendText(
        phone,
        `❌ Insufficient balance.\n\nAvailable: ₦${Number(summary.availableBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`,
      );
      return;
    }

    const banks = s.data.banks;

    if (banks.length === 1) {
      await this.session.setState(phone, BotState.AWAITING_PIN, {
        amount,
        bankAccountId: banks[0].id,
        bankName: banks[0].bankName,
        accountLastFour: banks[0].accountLastFour,
        pendingAction: 'WITHDRAW',
      });

      await this.gupshup.sendText(
        phone,
        `🏦 *Confirm Withdrawal*\n\n` +
          `Amount: *₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
          `To:     *${banks[0].bankName} ****${banks[0].accountLastFour}*\n\n` +
          `*Enter your 4-digit PIN to confirm:*\n\n` +
          `Send *cancel* to abort.`,
      );
    } else {
      const bankList = banks
        .map(
          (b: any, i: number) =>
            `${i + 1}. ${b.bankName} ****${b.accountLastFour}${b.isDefault ? ' ✅' : ''}`,
        )
        .join('\n');

      await this.session.setState(phone, BotState.AWAITING_WITHDRAW_BANK, {
        amount,
        banks,
      });

      await this.gupshup.sendText(
        phone,
        `🏦 Select bank account:\n\n${bankList}\n\n` +
          `Reply with the number (e.g. *1*).\n\nSend *cancel* to abort.`,
      );
    }
  }

  private async handleWithdrawBank(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    const idx = parseInt(text.trim()) - 1;
    const banks = s.data.banks;

    if (isNaN(idx) || idx < 0 || idx >= banks.length) {
      await this.gupshup.sendText(
        phone,
        `❌ Invalid selection. Please enter a number between 1 and ${banks.length}.`,
      );
      return;
    }

    const selected = banks[idx];

    await this.session.setState(phone, BotState.AWAITING_PIN, {
      ...s.data,
      bankAccountId: selected.id,
      bankName: selected.bankName,
      accountLastFour: selected.accountLastFour,
      pendingAction: 'WITHDRAW',
    });

    await this.gupshup.sendText(
      phone,
      `🏦 *Confirm Withdrawal*\n\n` +
        `Amount: *₦${Number(s.data.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
        `To:     *${selected.bankName} ****${selected.accountLastFour}*\n\n` +
        `*Enter your 4-digit PIN to confirm:*\n\nSend *cancel* to abort.`,
    );
  }

  private async handleWithdrawConfirm(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    await this.handlePinInput(phone, text, user, s);
  }

  // ── PIN HANDLER ───────────────────────────────────────────────────────────────
  private async handlePinInput(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    if (text.toLowerCase() === 'cancel') {
      await this.session.clear(phone);
      await this.gupshup.sendText(
        phone,
        `❌ Cancelled. Send *menu* to continue.`,
      );
      return;
    }

    if (!/^\d{4}$/.test(text.trim())) {
      await this.gupshup.sendText(
        phone,
        `❌ PIN must be exactly 4 digits. Try again:`,
      );
      return;
    }

    if (!user.pinHash || !user.isPinSet) {
      await this.gupshup.sendText(
        phone,
        `❌ No PIN set. Please set your PIN in the CryptoPay NG app first.`,
      );
      await this.session.clear(phone);
      return;
    }

    const pinValid = await argon2.verify(user.pinHash, text.trim());

    if (!pinValid) {
      const attempts = await this.session.incrementAttempts(phone);

      if (attempts >= 3) {
        await this.session.clear(phone);
        await this.gupshup.sendText(
          phone,
          `🔒 Too many incorrect PIN attempts. Session ended for security.\n\nSend *menu* to start again.`,
        );
        return;
      }

      await this.gupshup.sendText(
        phone,
        `❌ Incorrect PIN. ${3 - attempts} attempt(s) remaining.\n\nTry again:`,
      );
      return;
    }

    const action = s.data?.pendingAction;
    await this.session.clear(phone);

    switch (action) {
      case 'TRANSFER':
        await this.executeTransfer(phone, user, s.data);
        break;
      case 'WITHDRAW':
        await this.executeWithdraw(phone, user, s.data);
        break;
      default:
        await this.gupshup.sendText(
          phone,
          `✅ PIN verified. Send *menu* to continue.`,
        );
    }
  }

  // ── EXECUTE TRANSFER ──────────────────────────────────────────────────────────
  private async executeTransfer(
    phone: string,
    user: User,
    data: any,
  ): Promise<void> {
    try {
      await this.gupshup.sendText(phone, `⏳ Processing transfer...`);

      const result = await this.walletSvc.transferToUser(user.id, {
        recipientTag: data.recipientTag,
        amount: data.amount,
        note: 'Sent via WhatsApp',
        pin: '____',
      });

      await this.gupshup.sendText(
        phone,
        `✅ *Transfer Successful!*\n\n` +
          `Sent:      *₦${Number(data.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
          `To:        *@${result.recipientTag}* (${result.recipientName})\n` +
          `Fee:       *Free ✅*\n` +
          `Balance:   *₦${Number(result.senderNewBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
          `Reference: \`${result.reference}\`\n\n` +
          `Send *menu* for more options.`,
      );
    } catch (err) {
      await this.gupshup.sendText(
        phone,
        `❌ Transfer failed: ${err.message}\n\nSend *menu* to try again.`,
      );
    }
  }

  // ── EXECUTE WITHDRAW ──────────────────────────────────────────────────────────
  private async executeWithdraw(
    phone: string,
    user: User,
    data: any,
  ): Promise<void> {
    try {
      await this.gupshup.sendText(phone, `⏳ Processing withdrawal...`);

      const result = await this.walletSvc.withdrawToBank(user.id, {
        amount: data.amount,
        bankAccountId: data.bankAccountId,
        narration: 'Withdrawal via WhatsApp',
        pin: '____',
      });

      await this.gupshup.sendText(
        phone,
        `✅ *Withdrawal Initiated!*\n\n` +
          `Amount: *₦${Number(data.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
          `To:     *${data.bankName} ****${data.accountLastFour}*\n\n` +
          `💸 Funds will arrive shortly. You'll be notified here when done.\n\n` +
          `Send *menu* for more options.`,
      );
    } catch (err) {
      await this.gupshup.sendText(
        phone,
        `❌ Withdrawal failed: ${err.message}\n\nSend *menu* to try again.`,
      );
    }
  }

  // ── INVOICE FLOW ──────────────────────────────────────────────────────────────
  private async startInvoiceCreate(phone: string, user: User): Promise<void> {
    if (user.kycStatus !== KycStatus.VERIFIED) {
      await this.gupshup.sendText(
        phone,
        `⚠️ KYC verification required to create invoices.\n\nPlease complete your KYC in the app first.`,
      );
      return;
    }

    await this.session.setState(phone, BotState.AWAITING_INVOICE_AMOUNT);
    await this.gupshup.sendText(
      phone,
      `📄 *Create Invoice*\n\n` +
        `Enter the invoice amount in USD:\n_(e.g. 50 or 100.50)_\n\n` +
        `Send *cancel* to abort.`,
    );
  }

  private async handleInvoiceAmount(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    const amount = parseFloat(text.replace(/[$,]/g, '').trim());

    if (isNaN(amount) || amount < 1) {
      await this.gupshup.sendText(
        phone,
        `❌ Invalid amount. Minimum invoice is $1.`,
      );
      return;
    }

    await this.session.setState(phone, BotState.AWAITING_INVOICE_TITLE, {
      amountUsd: amount,
    });
    await this.gupshup.sendText(
      phone,
      `💵 Amount: *$${amount}*\n\n` +
        `Now enter a title for this invoice:\n` +
        `_(e.g. "Web design services")_`,
    );
  }

  private async handleInvoiceTitle(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    if (text.length < 3 || text.length > 255) {
      await this.gupshup.sendText(
        phone,
        `❌ Title must be between 3 and 255 characters.`,
      );
      return;
    }

    await this.session.setState(phone, BotState.AWAITING_INVOICE_CONFIRM, {
      ...s.data,
      title: text,
    });

    // FIX 3: use 'to' not 'phone'
    await this.gupshup.sendQuickReply({
      to: phone,
      header: '📄 Confirm Invoice',
      body:
        `*Amount:* $${s.data.amountUsd}\n` +
        `*Title:*  ${text}\n\n` +
        `Create this invoice?`,
      buttons: [
        { id: 'CONFIRM', title: '✅ Create Invoice' },
        { id: 'CANCEL', title: '❌ Cancel' },
      ],
    });
  }

  private async handleInvoiceConfirm(
    phone: string,
    text: string,
    user: User,
    s: any,
  ): Promise<void> {
    const input = text.toUpperCase().trim();

    if (input === 'CANCEL' || input === '❌ CANCEL') {
      await this.session.clear(phone);
      await this.gupshup.sendText(
        phone,
        `❌ Invoice creation cancelled. Send *menu* to continue.`,
      );
      return;
    }

    if (input !== 'CONFIRM' && input !== '✅ CREATE INVOICE') {
      await this.gupshup.sendText(
        phone,
        `Please reply *Confirm* to create or *Cancel* to abort.`,
      );
      return;
    }

    try {
      await this.gupshup.sendText(phone, `⏳ Creating invoice...`);

      const invoice = await this.invoiceSvc.create(user.id, {
        title: s.data.title,
        amountUsd: s.data.amountUsd,
      });

      await this.session.clear(phone);

      const paymentLink = `${process.env.FRONTEND_URL}/pay/${invoice.id}`;

      await this.gupshup.sendText(
        phone,
        `✅ *Invoice Created!*\n\n` +
          `📄 Invoice: *${invoice.invoiceNumber}*\n` +
          `💵 Amount:  *$${s.data.amountUsd}*\n` +
          `📝 Title:   ${s.data.title}\n\n` +
          `🔗 *Payment Link:*\n${paymentLink}\n\n` +
          `Share this with your client to receive payment.\n\nSend *menu* for more options.`,
      );
    } catch (err) {
      await this.gupshup.sendText(
        phone,
        `❌ Failed to create invoice: ${err.message}\n\nSend *menu* to try again.`,
      );
    }
  }

  // ── INVOICE LIST ──────────────────────────────────────────────────────────────
  private async sendInvoiceList(phone: string, user: User): Promise<void> {
    const result = await this.invoiceSvc.findAll(user.id, {
      page: 1,
      limit: 5,
    });

    if (result.data.length === 0) {
      await this.gupshup.sendText(
        phone,
        `📋 *My Invoices*\n\nYou have no invoices yet.\n\nSend *menu* to create one.`,
      );
      return;
    }

    const list = result.data
      .map(
        (inv, i) =>
          `${i + 1}. *${inv.invoiceNumber}* — $${inv.amountUsd} — _${inv.status}_`,
      )
      .join('\n');

    await this.gupshup.sendText(
      phone,
      `📋 *Recent Invoices* (last 5)\n\n${list}\n\n` +
        `View full details in the app.\n\nSend *menu* for more options.`,
    );
  }

  // ── RATES ─────────────────────────────────────────────────────────────────────
  private async sendRates(phone: string): Promise<void> {
    try {
      const rates = await this.dataSource.query(`
        SELECT DISTINCT ON (coin) coin, coin_usd_price, effective_usd_ngn, fetched_at
        FROM exchange_rates
        ORDER BY coin, fetched_at DESC
      `);

      const rateLines = rates
        .map(
          (r: any) =>
            `• *${r.coin.toUpperCase()}*: $${Number(r.coin_usd_price).toLocaleString()} ≈ ₦${Number(r.effective_usd_ngn).toFixed(2)}`,
        )
        .join('\n');

      await this.gupshup.sendText(
        phone,
        `📈 *Current Exchange Rates*\n\n${rateLines}\n\n` +
          `_Rates update every 10 minutes_\n\nSend *menu* for more options.`,
      );
    } catch {
      await this.gupshup.sendText(
        phone,
        `❌ Failed to fetch rates. Please try again.`,
      );
    }
  }

  // ── TRANSACTION HISTORY ───────────────────────────────────────────────────────
  private async sendTransactionHistory(
    phone: string,
    user: User,
  ): Promise<void> {
    const result = await this.walletSvc.getTransactions(user.id, {
      page: 1,
      limit: 5,
    });

    if (result.data.length === 0) {
      await this.gupshup.sendText(
        phone,
        `📜 *Transaction History*\n\nNo transactions yet.\n\nSend *menu* to start.`,
      );
      return;
    }

    const list = result.data
      .map((tx: any) => {
        const sign = ['credit', 'transfer_in'].includes(tx.type) ? '➕' : '➖';
        const amount = Number(tx.amount).toLocaleString('en-NG', {
          minimumFractionDigits: 2,
        });
        const date = new Date(tx.createdAt).toLocaleDateString('en-NG');
        return `${sign} *₦${amount}* — ${String(tx.description).substring(0, 30)} (${date})`;
      })
      .join('\n');

    await this.gupshup.sendText(
      phone,
      `📜 *Recent Transactions*\n\n${list}\n\n` +
        `View full history in the app.\n\nSend *menu* for more options.`,
    );
  }

  // ── HELP ──────────────────────────────────────────────────────────────────────
  private async sendHelp(phone: string): Promise<void> {
    await this.gupshup.sendText(
      phone,
      `❓ *CryptoPay NG Bot Help*\n\n` +
        `*Commands:*\n` +
        `• *menu* — Show main menu\n` +
        `• *balance* — Check wallet balance\n` +
        `• *rates* — Exchange rates\n` +
        `• *cancel* — Cancel current action\n` +
        `• *help* — Show this help\n\n` +
        `📱 *Need more help?*\n` +
        `Visit: ${process.env.FRONTEND_URL}/support`,
    );
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────────
  private normalizePhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('234') && cleaned.length === 13) {
      return `0${cleaned.substring(3)}`;
    }
    return cleaned;
  }
}
