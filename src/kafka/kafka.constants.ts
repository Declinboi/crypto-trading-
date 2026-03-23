export enum KafkaTopic {
  // ── Payment events ───────────────────────────────────────────────────────────
  PAYMENT_RECEIVED      = 'payment.received',
  PAYMENT_VERIFIED      = 'payment.verified',
  PAYMENT_CONFIRMED     = 'payment.confirmed',
  PAYMENT_FAILED        = 'payment.failed',
  PAYMENT_FLASH_DETECTED = 'payment.flash_detected',

  // ── Payout events ────────────────────────────────────────────────────────────
  PAYOUT_INITIATED      = 'payout.initiated',
  PAYOUT_COMPLETED      = 'payout.completed',
  PAYOUT_FAILED         = 'payout.failed',
  PAYOUT_RETRIED        = 'payout.retried',
  PAYOUT_REVERSED       = 'payout.reversed',

  // ── Invoice events ───────────────────────────────────────────────────────────
  INVOICE_CREATED       = 'invoice.created',
  INVOICE_PAID          = 'invoice.paid',
  INVOICE_EXPIRED       = 'invoice.expired',

  // ── Wallet events ─────────────────────────────────────────────────────────────
  WALLET_CREDITED       = 'wallet.credited',
  WALLET_DEBITED        = 'wallet.debited',
  WALLET_TRANSFER       = 'wallet.transfer',

  // ── Rate events ──────────────────────────────────────────────────────────────
  RATES_UPDATED         = 'rates.updated',

  // ── System events ────────────────────────────────────────────────────────────
  SYSTEM_WALLET_LOW     = 'system.wallet.low_balance',
  SYSTEM_WALLET_TOPUP   = 'system.wallet.top_up',
  KYC_STATUS_CHANGED    = 'kyc.status_changed',
  USER_REGISTERED       = 'user.registered',
}

export const KAFKA_CLIENT = 'KAFKA_CLIENT';