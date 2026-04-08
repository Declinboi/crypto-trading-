import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // AES block size
const TAG_LENGTH = 16; // GCM auth tag
const KEY_LENGTH = 32; // AES-256

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;
  private readonly hmacKey: Buffer;

  constructor(private config: ConfigService) {
    const rawKey = config.get<string>('ENCRYPTION_KEY');
    const rawHmacKey = config.get<string>('ENCRYPTION_HMAC_KEY');

    if (!rawKey || !rawHmacKey) {
      throw new Error(
        'ENCRYPTION_KEY and ENCRYPTION_HMAC_KEY must be set in .env. ' +
          "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }

    // Keys must be exactly 64 hex chars (32 bytes)
    this.key = Buffer.from(rawKey, 'hex');
    this.hmacKey = Buffer.from(rawHmacKey, 'hex');

    if (this.key.length !== KEY_LENGTH) {
      throw new Error(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got ${this.key.length} bytes.`,
      );
    }
    if (this.hmacKey.length !== KEY_LENGTH) {
      throw new Error(
        `ENCRYPTION_HMAC_KEY must be 64 hex characters (32 bytes). Got ${this.hmacKey.length} bytes.`,
      );
    }
  }

  // ── ENCRYPT ───────────────────────────────────────────────────────────────────
  // Output format: base64(iv[16] + ciphertext + authTag[16])
  // All three components are bundled — no separate storage needed
  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;

    try {
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);

      const tag = cipher.getAuthTag(); // 16-byte GCM auth tag

      // Bundle: iv (16) + ciphertext (n) + tag (16)
      const bundle = Buffer.concat([iv, encrypted, tag]);
      return bundle.toString('base64');
    } catch (err) {
      this.logger.error(`Encryption failed: ${err.message}`);
      throw new Error('Encryption failed');
    }
  }

  // ── DECRYPT ───────────────────────────────────────────────────────────────────
  decrypt(ciphertext: string): string {
    if (!ciphertext) return ciphertext;

    try {
      const bundle = Buffer.from(ciphertext, 'base64');

      // Minimum length: IV(16) + at least 1 byte ciphertext + tag(16) = 33
      if (bundle.length < IV_LENGTH + TAG_LENGTH + 1) {
        throw new Error('Invalid ciphertext length');
      }

      const iv = bundle.subarray(0, IV_LENGTH);
      const tag = bundle.subarray(bundle.length - TAG_LENGTH);
      const encryptedData = bundle.subarray(
        IV_LENGTH,
        bundle.length - TAG_LENGTH,
      );

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (err) {
      this.logger.error(`Decryption failed: ${err.message}`);
      throw new Error(
        'Decryption failed — data may be corrupted or key mismatch',
      );
    }
  }

  // ── ENCRYPT NULLABLE ──────────────────────────────────────────────────────────
  encryptNullable(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return this.encrypt(value);
  }

  decryptNullable(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return this.decrypt(value);
  }

  // ── HMAC HASH — for searchable/deduplicated fields ────────────────────────────
  // Used for: BVN dedup, NIN dedup, account number lookup
  // HMAC-SHA256 is one-way — cannot be reversed, but same input = same hash
  hash(value: string): string {
    if (!value) return value;
    return crypto
      .createHmac('sha256', this.hmacKey)
      .update(value.toLowerCase().trim())
      .digest('hex');
  }

  // ── MASK — for display purposes only ─────────────────────────────────────────
  // e.g. accountNumber → "****5678"
  mask(value: string, visibleChars = 4): string {
    if (!value || value.length <= visibleChars) return value;
    return `${'*'.repeat(value.length - visibleChars)}${value.slice(-visibleChars)}`;
  }

  // ── GENERATE SECURE KEY — utility for key generation ─────────────────────────
  static generateKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
  }
}
