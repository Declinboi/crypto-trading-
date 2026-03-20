import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── ENUM Types ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "user_role" AS ENUM ('user', 'admin', 'super_admin')
    `);
    await queryRunner.query(`
      CREATE TYPE "kyc_status" AS ENUM ('pending', 'submitted', 'verified', 'rejected')
    `);
    await queryRunner.query(`
      CREATE TYPE "invoice_status" AS ENUM ('draft', 'pending', 'paid', 'expired', 'cancelled')
    `);
    await queryRunner.query(`
      CREATE TYPE "coin_type" AS ENUM ('btc', 'eth', 'sol', 'usdt_trc20', 'usdt_erc20')
    `);
    await queryRunner.query(`
      CREATE TYPE "network_type" AS ENUM ('bitcoin', 'ethereum', 'solana', 'tron')
    `);
    await queryRunner.query(`
      CREATE TYPE "transaction_status" AS ENUM ('waiting', 'confirming', 'confirmed', 'failed', 'expired', 'refunded')
    `);
    await queryRunner.query(`
      CREATE TYPE "payout_status" AS ENUM ('pending', 'processing', 'success', 'failed', 'reversed')
    `);
    await queryRunner.query(`
      CREATE TYPE "notification_type" AS ENUM (
        'invoice_paid', 'payout_sent', 'kyc_approved', 'kyc_rejected',
        'payment_waiting', 'payment_confirming', 'payout_failed', 'invoice_expired'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "notification_channel" AS ENUM ('email', 'sms', 'in_app', 'push')
    `);
    await queryRunner.query(`
      CREATE TYPE "webhook_source" AS ENUM ('nowpayments', 'flutterwave')
    `);
    await queryRunner.query(`
      CREATE TYPE "audit_actor_type" AS ENUM ('user', 'admin', 'system', 'webhook')
    `);
    await queryRunner.query(`
      CREATE TYPE "rate_source" AS ENUM ('nowpayments', 'coingecko', 'manual')
    `);
    await queryRunner.query(`
      CREATE TYPE "referral_status" AS ENUM ('pending', 'qualified', 'rewarded', 'expired')
    `);
    await queryRunner.query(`
      CREATE TYPE "system_wallet_status" AS ENUM ('active', 'inactive', 'maintenance')
    `);
    await queryRunner.query(`
      CREATE TYPE "system_wallet_tx_type" AS ENUM (
        'deposit', 'withdrawal', 'fee_credit', 'payout_reserve', 'reconciliation'
      )
    `);

    // ── users ─────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
        "email"               VARCHAR(255) NOT NULL,
        "phone"               VARCHAR(20),
        "password_hash"       VARCHAR(255) NOT NULL,
        "first_name"          VARCHAR(100) NOT NULL,
        "last_name"           VARCHAR(100) NOT NULL,
        "business_name"       VARCHAR(200),
        "avatar_url"          TEXT,
        "role"                "user_role"  NOT NULL DEFAULT 'user',
        "kyc_status"          "kyc_status" NOT NULL DEFAULT 'pending',
        "is_active"           BOOLEAN     NOT NULL DEFAULT TRUE,
        "is_email_verified"   BOOLEAN     NOT NULL DEFAULT FALSE,
        "is_phone_verified"   BOOLEAN     NOT NULL DEFAULT FALSE,
        "two_fa_enabled"      BOOLEAN     NOT NULL DEFAULT FALSE,
        "two_fa_secret"       VARCHAR(100),
        "referral_code"       VARCHAR(20)  NOT NULL,
        "referred_by_id"      UUID,
        "last_login_at"       TIMESTAMPTZ,
        "deleted_at"          TIMESTAMPTZ,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "UQ_users_referral_code" UNIQUE ("referral_code"),
        CONSTRAINT "FK_users_referred_by" FOREIGN KEY ("referred_by_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // ── kyc_records ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "kyc_records" (
        "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"           UUID        NOT NULL,
        "document_type"     VARCHAR(50) NOT NULL,
        "document_number"   VARCHAR(100) NOT NULL,
        "document_front_url" TEXT,
        "document_back_url" TEXT,
        "selfie_url"        TEXT,
        "bvn_hash"          VARCHAR(255),
        "nin_hash"          VARCHAR(255),
        "status"            "kyc_status" NOT NULL DEFAULT 'pending',
        "rejection_reason"  TEXT,
        "reviewed_by_id"    UUID,
        "reviewed_at"       TIMESTAMPTZ,
        "provider"          VARCHAR(50),
        "provider_ref"      VARCHAR(255),
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_kyc_records" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kyc_records_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kyc_records_reviewer" FOREIGN KEY ("reviewed_by_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // ── bank_accounts ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "bank_accounts" (
        "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          UUID         NOT NULL,
        "account_name"     VARCHAR(200) NOT NULL,
        "account_number"   VARCHAR(20)  NOT NULL,
        "bank_code"        VARCHAR(10)  NOT NULL,
        "bank_name"        VARCHAR(100) NOT NULL,
        "currency"         CHAR(3)      NOT NULL DEFAULT 'NGN',
        "is_default"       BOOLEAN      NOT NULL DEFAULT FALSE,
        "is_verified"      BOOLEAN      NOT NULL DEFAULT FALSE,
        "flw_recipient_id" VARCHAR(100),
        "deleted_at"       TIMESTAMPTZ,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_bank_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_bank_accounts_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // ── exchange_rates ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "exchange_rates" (
        "id"                 UUID        NOT NULL DEFAULT gen_random_uuid(),
        "coin"               "coin_type" NOT NULL,
        "coin_usd_price"     NUMERIC(18,4) NOT NULL,
        "usd_ngn_rate"       NUMERIC(18,4) NOT NULL,
        "spread_percent"     NUMERIC(5,2)  NOT NULL DEFAULT 1.5,
        "effective_usd_ngn"  NUMERIC(18,4) NOT NULL,
        "source"             "rate_source" NOT NULL DEFAULT 'nowpayments',
        "fetched_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "expires_at"         TIMESTAMPTZ  NOT NULL,
        "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_exchange_rates" PRIMARY KEY ("id")
      )
    `);

    // ── invoices ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id"                       UUID             NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                  UUID             NOT NULL,
        "invoice_number"           VARCHAR(30)      NOT NULL,
        "title"                    VARCHAR(255)     NOT NULL,
        "client_name"              VARCHAR(200),
        "client_email"             VARCHAR(255),
        "amount_usd"               NUMERIC(18,2)    NOT NULL,
        "amount_ngn"               NUMERIC(18,2),
        "status"                   "invoice_status" NOT NULL DEFAULT 'draft',
        "selected_coin"            "coin_type",
        "crypto_amount"            NUMERIC(28,10),
        "nowpayments_invoice_id"   VARCHAR(100),
        "payment_url"              TEXT,
        "payment_address"          VARCHAR(255),
        "qr_code_url"              TEXT,
        "rate_lock_id"             UUID,
        "expires_at"               TIMESTAMPTZ,
        "paid_at"                  TIMESTAMPTZ,
        "notes"                    TEXT,
        "metadata"                 JSONB,
        "deleted_at"               TIMESTAMPTZ,
        "created_at"               TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        "updated_at"               TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_invoices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_invoices_number" UNIQUE ("invoice_number"),
        CONSTRAINT "FK_invoices_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // ── rate_locks ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "rate_locks" (
        "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id"           UUID        NOT NULL,
        "exchange_rate_id"     UUID        NOT NULL,
        "coin"                 "coin_type" NOT NULL,
        "locked_usd_ngn_rate"  NUMERIC(18,4) NOT NULL,
        "locked_coin_usd_price" NUMERIC(18,4) NOT NULL,
        "crypto_amount_locked" NUMERIC(28,10) NOT NULL,
        "locked_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "expires_at"           TIMESTAMPTZ NOT NULL,
        "is_expired"           BOOLEAN     NOT NULL DEFAULT FALSE,
        "used_at"              TIMESTAMPTZ,
        CONSTRAINT "PK_rate_locks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_rate_locks_invoice" UNIQUE ("invoice_id"),
        CONSTRAINT "FK_rate_locks_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_rate_locks_exchange_rate" FOREIGN KEY ("exchange_rate_id")
          REFERENCES "exchange_rates"("id") ON DELETE RESTRICT
      )
    `);

    // Add FK from invoices to rate_locks now that rate_locks exists
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD CONSTRAINT "FK_invoices_rate_lock"
        FOREIGN KEY ("rate_lock_id") REFERENCES "rate_locks"("id") ON DELETE SET NULL
    `);

    // ── invoice_items ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "invoice_items" (
        "id"             UUID          NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id"     UUID          NOT NULL,
        "description"    VARCHAR(500)  NOT NULL,
        "quantity"       NUMERIC(10,2) NOT NULL DEFAULT 1,
        "unit_price_usd" NUMERIC(18,2) NOT NULL,
        "total_usd"      NUMERIC(18,2) NOT NULL,
        "sort_order"     INTEGER       NOT NULL DEFAULT 0,
        "created_at"     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_invoice_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invoice_items_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices"("id") ON DELETE CASCADE
      )
    `);

    // ── wallet_addresses ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "wallet_addresses" (
        "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          UUID           NOT NULL,
        "invoice_id"       UUID,
        "coin"             "coin_type"    NOT NULL,
        "network"          "network_type" NOT NULL,
        "address"          VARCHAR(255)   NOT NULL,
        "derivation_path"  VARCHAR(100),
        "is_used"          BOOLEAN        NOT NULL DEFAULT FALSE,
        "nowpayments_ref"  VARCHAR(100),
        "created_at"       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_wallet_addresses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_wallet_addresses_address" UNIQUE ("address"),
        CONSTRAINT "FK_wallet_addresses_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_wallet_addresses_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices"("id") ON DELETE SET NULL
      )
    `);

    // ── transactions ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id"                       UUID                 NOT NULL DEFAULT gen_random_uuid(),
        "invoice_id"               UUID                 NOT NULL,
        "user_id"                  UUID                 NOT NULL,
        "nowpayments_payment_id"   VARCHAR(100),
        "tx_hash"                  VARCHAR(255),
        "coin"                     "coin_type"          NOT NULL,
        "network"                  "network_type"       NOT NULL,
        "crypto_amount_expected"   NUMERIC(28,10)       NOT NULL,
        "crypto_amount_received"   NUMERIC(28,10),
        "usd_amount"               NUMERIC(18,2)        NOT NULL,
        "ngn_amount"               NUMERIC(18,2),
        "exchange_rate_id"         UUID,
        "usd_to_ngn_rate"          NUMERIC(18,4),
        "platform_fee_usd"         NUMERIC(18,4),
        "platform_fee_ngn"         NUMERIC(18,2),
        "net_ngn_amount"           NUMERIC(18,2),
        "status"                   "transaction_status" NOT NULL DEFAULT 'waiting',
        "confirmations"            INTEGER              NOT NULL DEFAULT 0,
        "required_confirmations"   INTEGER              NOT NULL DEFAULT 1,
        "confirmed_at"             TIMESTAMPTZ,
        "nowpayments_status"       VARCHAR(50),
        "metadata"                 JSONB,
        "created_at"               TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
        "updated_at"               TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transactions_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transactions_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transactions_exchange_rate" FOREIGN KEY ("exchange_rate_id")
          REFERENCES "exchange_rates"("id") ON DELETE SET NULL
      )
    `);

    // ── payouts ───────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "payouts" (
        "id"               UUID            NOT NULL DEFAULT gen_random_uuid(),
        "transaction_id"   UUID            NOT NULL,
        "user_id"          UUID            NOT NULL,
        "bank_account_id"  UUID            NOT NULL,
        "amount_ngn"       NUMERIC(18,2)   NOT NULL,
        "fee_ngn"          NUMERIC(18,2)   NOT NULL DEFAULT 0,
        "net_amount_ngn"   NUMERIC(18,2)   NOT NULL,
        "status"           "payout_status" NOT NULL DEFAULT 'pending',
        "flw_transfer_id"  VARCHAR(100),
        "flw_reference"    VARCHAR(100),
        "flw_status"       VARCHAR(50),
        "narration"        VARCHAR(255),
        "retry_count"      INTEGER         NOT NULL DEFAULT 0,
        "last_retry_at"    TIMESTAMPTZ,
        "completed_at"     TIMESTAMPTZ,
        "failure_reason"   TEXT,
        "metadata"         JSONB,
        "created_at"       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
        "updated_at"       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_payouts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payouts_transaction" UNIQUE ("transaction_id"),
        CONSTRAINT "FK_payouts_transaction" FOREIGN KEY ("transaction_id")
          REFERENCES "transactions"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_bank_account" FOREIGN KEY ("bank_account_id")
          REFERENCES "bank_accounts"("id") ON DELETE RESTRICT
      )
    `);

    // ── webhook_events ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "webhook_events" (
        "id"               UUID             NOT NULL DEFAULT gen_random_uuid(),
        "source"           "webhook_source" NOT NULL,
        "event_type"       VARCHAR(100)     NOT NULL,
        "external_ref"     VARCHAR(255),
        "payload"          JSONB            NOT NULL,
        "signature_valid"  BOOLEAN          NOT NULL DEFAULT FALSE,
        "processed"        BOOLEAN          NOT NULL DEFAULT FALSE,
        "processed_at"     TIMESTAMPTZ,
        "processing_error" TEXT,
        "idempotency_key"  VARCHAR(255)     NOT NULL,
        "created_at"       TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_webhook_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webhook_events_idempotency" UNIQUE ("idempotency_key")
      )
    `);

    // ── notifications ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"           UUID                   NOT NULL DEFAULT gen_random_uuid(),
        "user_id"      UUID                   NOT NULL,
        "type"         "notification_type"    NOT NULL,
        "channel"      "notification_channel" NOT NULL,
        "title"        VARCHAR(255)           NOT NULL,
        "body"         TEXT                   NOT NULL,
        "data"         JSONB,
        "is_read"      BOOLEAN                NOT NULL DEFAULT FALSE,
        "sent"         BOOLEAN                NOT NULL DEFAULT FALSE,
        "sent_at"      TIMESTAMPTZ,
        "provider_ref" VARCHAR(255),
        "created_at"   TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // ── audit_logs ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          UUID               NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     UUID,
        "actor_type"  "audit_actor_type" NOT NULL,
        "action"      VARCHAR(100)       NOT NULL,
        "entity_type" VARCHAR(50),
        "entity_id"   UUID,
        "old_values"  JSONB,
        "new_values"  JSONB,
        "ip_address"  INET,
        "user_agent"  TEXT,
        "created_at"  TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_audit_logs_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // ── referrals ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "referrals" (
        "id"                UUID              NOT NULL DEFAULT gen_random_uuid(),
        "referrer_id"       UUID              NOT NULL,
        "referred_id"       UUID              NOT NULL,
        "referral_code"     VARCHAR(20)       NOT NULL,
        "status"            "referral_status" NOT NULL DEFAULT 'pending',
        "reward_amount_ngn" NUMERIC(18,2),
        "rewarded_at"       TIMESTAMPTZ,
        "qualified_at"      TIMESTAMPTZ,
        "created_at"        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_referrals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_referrals_referred" UNIQUE ("referred_id"),
        CONSTRAINT "FK_referrals_referrer" FOREIGN KEY ("referrer_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_referrals_referred" FOREIGN KEY ("referred_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // ── platform_settings ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "platform_settings" (
        "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
        "key"            VARCHAR(100) NOT NULL,
        "value"          TEXT         NOT NULL,
        "value_type"     VARCHAR(20)  NOT NULL DEFAULT 'string',
        "description"    TEXT,
        "is_public"      BOOLEAN      NOT NULL DEFAULT FALSE,
        "updated_by_id"  UUID,
        "updated_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_platform_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_platform_settings_key" UNIQUE ("key"),
        CONSTRAINT "FK_platform_settings_updated_by" FOREIGN KEY ("updated_by_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // ── system_wallets ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "system_wallets" (
        "id"                        UUID                   NOT NULL DEFAULT gen_random_uuid(),
        "label"                     VARCHAR(100)           NOT NULL,
        "coin"                      "coin_type",
        "network"                   "network_type",
        "address"                   VARCHAR(255),
        "address_encrypted"         VARCHAR(255),
        "is_hot_wallet"             BOOLEAN                NOT NULL DEFAULT TRUE,
        "balance_crypto"            NUMERIC(28,10)         NOT NULL DEFAULT 0,
        "balance_usd_equiv"         NUMERIC(18,2)          NOT NULL DEFAULT 0,
        "balance_ngn_reserve"       NUMERIC(18,2)          NOT NULL DEFAULT 0,
        "total_fees_collected"      NUMERIC(28,10)         NOT NULL DEFAULT 0,
        "total_fees_collected_usd"  NUMERIC(18,2)          NOT NULL DEFAULT 0,
        "min_balance_alert_usd"     NUMERIC(18,2),
        "nowpayments_wallet_id"     VARCHAR(100),
        "status"                    "system_wallet_status" NOT NULL DEFAULT 'active',
        "notes"                     TEXT,
        "last_synced_at"            TIMESTAMPTZ,
        "created_at"                TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        "updated_at"                TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_system_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_system_wallets_address" UNIQUE ("address")
      )
    `);

    // ── system_wallet_transactions ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "system_wallet_transactions" (
        "id"                  UUID                   NOT NULL DEFAULT gen_random_uuid(),
        "system_wallet_id"    UUID                   NOT NULL,
        "type"                "system_wallet_tx_type" NOT NULL,
        "coin"                "coin_type",
        "amount_crypto"       NUMERIC(28,10)         NOT NULL DEFAULT 0,
        "amount_usd"          NUMERIC(18,2)          NOT NULL DEFAULT 0,
        "amount_ngn"          NUMERIC(18,2)          NOT NULL DEFAULT 0,
        "balance_before"      NUMERIC(28,10),
        "balance_after"       NUMERIC(28,10),
        "tx_hash"             VARCHAR(255),
        "transaction_id"      UUID,
        "payout_id"           UUID,
        "usd_rate_snapshot"   NUMERIC(18,4),
        "description"         TEXT,
        "reference"           VARCHAR(100),
        "metadata"            JSONB,
        "created_at"          TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_system_wallet_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_swt_system_wallet" FOREIGN KEY ("system_wallet_id")
          REFERENCES "system_wallets"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_swt_transaction" FOREIGN KEY ("transaction_id")
          REFERENCES "transactions"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_swt_payout" FOREIGN KEY ("payout_id")
          REFERENCES "payouts"("id") ON DELETE SET NULL
      )
    `);

    // ── Indexes ───────────────────────────────────────────────────────────────
    await queryRunner.query(`CREATE INDEX "IDX_kyc_records_user_id" ON "kyc_records" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_bank_accounts_user_id" ON "bank_accounts" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_invoices_user_status" ON "invoices" ("user_id", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_invoices_nowpayments" ON "invoices" ("nowpayments_invoice_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_addresses_user" ON "wallet_addresses" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_addresses_invoice" ON "wallet_addresses" ("invoice_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_exchange_rates_coin_date" ON "exchange_rates" ("coin", "fetched_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_rate_locks_expires" ON "rate_locks" ("expires_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_invoice" ON "transactions" ("invoice_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_user" ON "transactions" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_tx_hash" ON "transactions" ("tx_hash")`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_nowpayments" ON "transactions" ("nowpayments_payment_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_transactions_status" ON "transactions" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_payouts_user" ON "payouts" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_payouts_status" ON "payouts" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_payouts_flw_transfer" ON "payouts" ("flw_transfer_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_webhook_events_external_ref" ON "webhook_events" ("external_ref")`);
    await queryRunner.query(`CREATE INDEX "IDX_webhook_events_processed" ON "webhook_events" ("processed")`);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_user_read" ON "notifications" ("user_id", "is_read")`);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_user_date" ON "notifications" ("user_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_user" ON "audit_logs" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_referrals_referrer" ON "referrals" ("referrer_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_system_wallets_coin_network" ON "system_wallets" ("coin", "network", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_swt_wallet_date" ON "system_wallet_transactions" ("system_wallet_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_swt_type" ON "system_wallet_transactions" ("type")`);
    await queryRunner.query(`CREATE INDEX "IDX_swt_tx_hash" ON "system_wallet_transactions" ("tx_hash")`);

    // ── Seed default platform settings ────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "platform_settings" ("key", "value", "value_type", "description", "is_public") VALUES
        ('fx_spread_percent',    '1.5',                 'number',  'FX spread applied on top of USD/NGN rate', TRUE),
        ('rate_lock_minutes',    '10',                  'number',  'Minutes a rate lock stays valid',           TRUE),
        ('min_invoice_usd',      '1',                   'number',  'Minimum invoice amount in USD',             TRUE),
        ('max_invoice_usd',      '50000',               'number',  'Maximum invoice amount in USD',             TRUE),
        ('supported_coins',      '["usdt_trc20"]',      'json',    'Active coins (Phase 1 = USDT only)',        TRUE),
        ('withdrawal_fee_ngn',   '50',                  'number',  'Flat NGN fee per payout',                   FALSE),
        ('maintenance_mode',     'false',               'boolean', 'Put platform in read-only maintenance',     TRUE),
        ('kyc_required_above_usd','500',                'number',  'KYC required for invoices above this USD',  FALSE),
        ('referral_reward_ngn',  '1000',                'number',  'NGN bonus for a qualified referral',        TRUE)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "system_wallet_transactions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "system_wallets" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_settings" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "referrals" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_events" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payouts" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transactions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_addresses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_items" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rate_locks" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoices" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "exchange_rates" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_accounts" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_records" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);

    await queryRunner.query(`DROP TYPE IF EXISTS "system_wallet_tx_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "system_wallet_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "referral_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "rate_source"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "audit_actor_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "webhook_source"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_channel"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payout_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "transaction_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "network_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "coin_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "invoice_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "kyc_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role"`);
  }
}
