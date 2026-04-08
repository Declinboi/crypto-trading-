import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits auth tag
const KEY_LENGTH = 32; // 256 bits

export interface EncryptedPayload {
  iv: string; // hex
  tag: string; // hex — auth tag, detects tampering
  ciphertext: string; // hex
  version: number; // key version for rotation support
}

@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private encryptionKey: Buffer;
  private keyVersion: number;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const rawKey = this.config.get<string>('ENCRYPTION_KEY');
    if (!rawKey) {
      throw new Error(
        'ENCRYPTION_KEY is not set. Generate one with: ' +
          "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }

    // Key must be exactly 64 hex chars (32 bytes = 256 bits)
    if (rawKey.length !== 64) {
      throw new Error(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes). Got ${rawKey.length}.`,
      );
    }

    this.encryptionKey = Buffer.from(rawKey, 'hex');
    this.keyVersion = Number(
      this.config.get<string>('ENCRYPTION_KEY_VERSION') ?? '1',
    );

    this.logger.log(
      `Encryption service ready — algorithm=${ALGORITHM} keyVersion=${this.keyVersion}`,
    );
  }

  // ── ENCRYPT ───────────────────────────────────────────────────────────────────
  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv, {
      authTagLength: TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      version: this.keyVersion,
    };

    // Store as base64-encoded JSON for compact DB storage
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  // ── DECRYPT ───────────────────────────────────────────────────────────────────
  decrypt(encryptedData: string): string {
    if (!encryptedData) return encryptedData;

    // Detect unencrypted legacy data — return as-is
    if (!this.isEncrypted(encryptedData)) {
      this.logger.warn(
        'Attempting to decrypt non-encrypted data — returning as-is',
      );
      return encryptedData;
    }

    try {
      const payload: EncryptedPayload = JSON.parse(
        Buffer.from(encryptedData, 'base64').toString('utf8'),
      );

      // Key rotation: if version differs, load the old key
      const key = this.resolveKey(payload.version);

      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(payload.iv, 'hex'),
        {
          authTagLength: TAG_LENGTH,
        },
      );

      decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'hex')),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (err) {
      this.logger.error(`Decryption failed: ${err.message}`);
      throw new Error('Failed to decrypt data — possible tampering detected');
    }
  }

  // ── ENCRYPT OBJECT (encrypt specific fields) ──────────────────────────────────
  encryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    const result = { ...obj };
    for (const field of fields) {
      if (result[field] && typeof result[field] === 'string') {
        (result as any)[field] = this.encrypt(result[field] as string);
      }
    }
    return result;
  }

  // ── DECRYPT OBJECT ────────────────────────────────────────────────────────────
  decryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    const result = { ...obj };
    for (const field of fields) {
      if (result[field] && typeof result[field] === 'string') {
        try {
          (result as any)[field] = this.decrypt(result[field] as string);
        } catch {
          // Don't crash if a single field fails — log and continue
          this.logger.error(`Failed to decrypt field: ${String(field)}`);
        }
      }
    }
    return result;
  }

  // ── HASH (one-way, for lookups) ───────────────────────────────────────────────
  // Use for: BVN, NIN, account numbers used as lookup keys
  hash(value: string): string {
    return crypto
      .createHmac('sha256', this.encryptionKey)
      .update(value.toLowerCase().trim())
      .digest('hex');
  }

  // ── DETERMINISTIC ENCRYPT (same input → same output, for searchable fields) ───
  // Use for: account numbers you need to search by
  // Less secure than random IV — only use when search is required
  deterministicEncrypt(value: string): string {
    // Derive a deterministic IV from the value + key (not random)
    const iv = crypto
      .createHmac('sha256', this.encryptionKey)
      .update(`det:${value}`)
      .digest()
      .slice(0, IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv, {
      authTagLength: TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    const payload: EncryptedPayload = {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      version: this.keyVersion,
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  // ── MASK (for display) ────────────────────────────────────────────────────────
  mask(value: string, visibleChars = 4): string {
    if (!value || value.length <= visibleChars) return '****';
    return `${'*'.repeat(value.length - visibleChars)}${value.slice(-visibleChars)}`;
  }

  // ── CHECK IF VALUE IS ALREADY ENCRYPTED ───────────────────────────────────────
  isEncrypted(value: string): boolean {
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return !!(parsed.iv && parsed.tag && parsed.ciphertext && parsed.version);
    } catch {
      return false;
    }
  }

  // ── KEY ROTATION SUPPORT ──────────────────────────────────────────────────────
  private resolveKey(version: number): Buffer {
    if (version === this.keyVersion) return this.encryptionKey;

    // Load old key for decryption during rotation period
    const oldKey = this.config.get<string>(`ENCRYPTION_KEY_V${version}`);
    if (!oldKey) {
      throw new Error(
        `Cannot decrypt — old key version ${version} not found. ` +
          `Set ENCRYPTION_KEY_V${version} in .env`,
      );
    }
    return Buffer.from(oldKey, 'hex');
  }
}
