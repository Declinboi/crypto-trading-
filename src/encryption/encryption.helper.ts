import { EncryptionService } from './encryption.service';

export class EncryptionHelper {

  // ── BANK ACCOUNT: encrypt + hash + mask before saving ────────────────────────
  static prepareBankAccount(
    enc: EncryptionService,
    accountNumber: string,
  ): {
    accountNumber:       string;   // encrypted (stored in DB)
    accountNumberHash:   string;   // HMAC-SHA256 (for dedup)
    accountNumberMasked: string;   // e.g. ****6789 (for display)
  } {
    return {
      accountNumber:       enc.encrypt(accountNumber),
      accountNumberHash:   enc.hash(accountNumber),
      accountNumberMasked: enc.mask(accountNumber, 4),
    };
  }

  // ── USER PHONE: encrypt + hash before saving ──────────────────────────────────
  static preparePhone(
    enc: EncryptionService,
    phone: string,
  ): {
    phone:     string;   // encrypted
    phoneHash: string;   // HMAC-SHA256 (for unique constraint + lookup)
  } {
    return {
      phone:     enc.encrypt(phone),
      phoneHash: enc.hash(phone),
    };
  }

  // ── KYC DOCUMENT: encrypt + hash ─────────────────────────────────────────────
  static prepareDocument(
    enc: EncryptionService,
    documentNumber: string,
  ): {
    documentNumber:     string;  // encrypted
    documentNumberHash: string;  // HMAC-SHA256 (for dedup)
  } {
    return {
      documentNumber:     enc.encrypt(documentNumber),
      documentNumberHash: enc.hash(documentNumber),
    };
  }
}