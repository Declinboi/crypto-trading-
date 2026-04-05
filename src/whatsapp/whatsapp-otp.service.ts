import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { GupshupService } from './gupshup.service';

const OTP_PREFIX = 'wa:otp:';
const RATE_PREFIX = 'wa:otp:ratelimit:';
const OTP_TTL = 10 * 60; // 10 minutes
const RATE_LIMIT_TTL = 60; // 60 seconds between sends
const MAX_ATTEMPTS = 3;

@Injectable()
export class WhatsappOtpService {
  private readonly logger = new Logger(WhatsappOtpService.name);

  constructor(
    private gupshup: GupshupService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  // ── NORMALISE ─────────────────────────────────────────────────────────────────
  // Always convert to international format (e.g. 2348012345678) before building
  // any Redis key.  This is the single place that decides the canonical form.
  // ─────────────────────────────────────────────────────────────────────────────
  normalizePhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      return `234${cleaned.substring(1)}`;
    }
    if (cleaned.startsWith('234') && cleaned.length === 13) return cleaned;
    if (cleaned.length === 10) return `234${cleaned}`;
    return cleaned;
  }

  private otpKey(phone: string) {
    return `${OTP_PREFIX}${this.normalizePhone(phone)}`;
  }
  private rateKey(phone: string) {
    return `${RATE_PREFIX}${this.normalizePhone(phone)}`;
  }

  // ── SEND OTP ──────────────────────────────────────────────────────────────────
  // Rate-limited here (single source of truth) — any caller is protected.
  // Pass throwOnRateLimit=false when you want a soft check (e.g. on registration)
  // so the parallel task doesn't abort the whole registration.
  // ─────────────────────────────────────────────────────────────────────────────
  async sendOtp(
    phone: string,
    firstName: string,
    throwOnRateLimit = true,
  ): Promise<void> {
    const rateTTL = await this.redis.ttl(this.rateKey(phone));

    if (rateTTL > 0) {
      if (throwOnRateLimit) {
        throw new BadRequestException(
          `Please wait ${rateTTL}s before requesting another OTP`,
        );
      }
      // Soft path (registration): silently skip — a valid OTP already exists
      this.logger.warn(`OTP rate-limited for ${phone}, skipping silent send`);
      return;
    }

    const otp = Math.floor(100_000 + Math.random() * 900_000).toString();

    // Store OTP + attempts atomically
    await this.redis.setex(
      this.otpKey(phone),
      OTP_TTL,
      JSON.stringify({ otp, attempts: 0, createdAt: Date.now() }),
    );

    // Stamp rate-limit key (pure TTL — existence = blocked)
    await this.redis.setex(this.rateKey(phone), RATE_LIMIT_TTL, '1');

    await this.gupshup.sendOtp(phone, otp, firstName);
    this.logger.log(`WhatsApp OTP sent to ${this.normalizePhone(phone)}`);
  }

  // ── VERIFY OTP ────────────────────────────────────────────────────────────────
  // Single source of truth for attempt tracking.
  // ─────────────────────────────────────────────────────────────────────────────
  async verifyOtp(
    phone: string,
    inputOtp: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const raw = await this.redis.get(this.otpKey(phone));

    if (!raw) {
      return {
        valid: false,
        reason: 'OTP expired or not found. Please request a new one.',
      };
    }

    const stored = JSON.parse(raw) as {
      otp: string;
      attempts: number;
      createdAt: number;
    };

    if (stored.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(this.otpKey(phone));
      return {
        valid: false,
        reason: 'Too many failed attempts. Please request a new OTP.',
      };
    }

    if (stored.otp !== inputOtp.trim()) {
      stored.attempts += 1;

      // Preserve remaining TTL so the OTP doesn't silently get a fresh window
      const remaining = await this.redis.ttl(this.otpKey(phone));
      await this.redis.setex(
        this.otpKey(phone),
        remaining > 0 ? remaining : OTP_TTL,
        JSON.stringify(stored),
      );

      return {
        valid: false,
        reason: `Incorrect OTP. ${MAX_ATTEMPTS - stored.attempts} attempt(s) remaining.`,
      };
    }

    // Valid — delete OTP (consumed); leave rate-limit key to block immediate resend
    await this.redis.del(this.otpKey(phone));
    return { valid: true };
  }

  // ── RESEND OTP ────────────────────────────────────────────────────────────────
  // Now just calls sendOtp with throwOnRateLimit=true so the rate-limit is
  // enforced.  No need to manually delete first — sendOtp overwrites the key.
  // ─────────────────────────────────────────────────────────────────────────────
  async resendOtp(phone: string, firstName: string): Promise<void> {
    await this.sendOtp(phone, firstName, true);
  }
}
