export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

export enum KycStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PAID = 'paid',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum CoinType {
  BTC = 'btc',
  ETH = 'eth',
  SOL = 'sol',
  USDT_TRC20 = 'usdt_trc20',
  USDT_ERC20 = 'usdt_erc20',
}

export enum NetworkType {
  BITCOIN = 'bitcoin',
  ETHEREUM = 'ethereum',
  SOLANA = 'solana',
  TRON = 'tron',
}

export enum TransactionStatus {
  WAITING = 'waiting',
  CONFIRMING = 'confirming',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

export enum PayoutStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

export enum NotificationType {
  INVOICE_PAID = 'invoice_paid',
  PAYOUT_SENT = 'payout_sent',
  KYC_APPROVED = 'kyc_approved',
  KYC_REJECTED = 'kyc_rejected',
  PAYMENT_WAITING = 'payment_waiting',
  PAYMENT_CONFIRMING = 'payment_confirming',
  PAYOUT_FAILED = 'payout_failed',
  INVOICE_EXPIRED = 'invoice_expired',
}

export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  IN_APP = 'in_app',
  PUSH = 'push',
}

export enum WebhookSource {
  NOWPAYMENTS = 'nowpayments',
  FLUTTERWAVE = 'flutterwave',
}

export enum AuditActorType {
  USER = 'user',
  ADMIN = 'admin',
  SYSTEM = 'system',
  WEBHOOK = 'webhook',
}

export enum RateSource {
  NOWPAYMENTS = 'nowpayments',
  COINGECKO = 'coingecko',
  MANUAL = 'manual',
}

export enum ReferralStatus {
  PENDING = 'pending',
  QUALIFIED = 'qualified',
  REWARDED = 'rewarded',
  EXPIRED = 'expired',
}

export enum SystemWalletStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance',
}

export enum SystemWalletTransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  FEE_CREDIT = 'fee_credit',
  PAYOUT_RESERVE = 'payout_reserve',
  RECONCILIATION = 'reconciliation',
}
