import { EncryptionService } from './encryption.service';

// ── What gets encrypted vs hashed ─────────────────────────────────────────────
//
// ENCRYPT (AES-256-GCM, reversible):
//   User:        phone, verifiedName, twoFaSecret
//   BankAccount: accountName, accountNumber, flwRecipientId
//   KycRecord:   documentNumber, documentFrontUrl, documentBackUrl,
//                selfieUrl, providerRef
//   WalletTx:    description
//
// HMAC HASH (one-way, searchable):
//   User:        phoneHash     ← lookup by phone number
//   BankAccount: accountNumberHash ← dedup check
//   KycRecord:   bvnHash, ninHash ← dedup check
//
// ARGON2ID (password hashing — already in place):
//   User: passwordHash, pinHash
//
// PLAINTEXT (non-sensitive):
//   All UUIDs, enums, booleans, timestamps, amounts, bank codes,
//   bank names, invoice numbers, referral codes, wallet tags
// ─────────────────────────────────────────────────────────────────────────────

export class EncryptionHelper {
  constructor(private enc: EncryptionService) {}

  // ── User ──────────────────────────────────────────────────────────────────────
  prepareUser(data: {
    phone?: string | null;
    verifiedName?: string | null;
    twoFaSecret?: string | null;
  }) {
    const result: Record<string, any> = {};

    if (data.phone !== undefined) {
      result.phone = this.enc.encryptNullable(data.phone);
      result.phoneHash = data.phone ? this.enc.hash(data.phone) : null;
    }
    if (data.verifiedName !== undefined) {
      result.verifiedName = this.enc.encryptNullable(data.verifiedName);
    }
    if (data.twoFaSecret !== undefined) {
      result.twoFaSecret = this.enc.encryptNullable(data.twoFaSecret);
    }

    return result;
  }

  decryptUser(user: any) {
    if (!user) return user;
    return {
      ...user,
      phone: this.enc.decryptNullable(user.phone),
      verifiedName: this.enc.decryptNullable(user.verifiedName),
      twoFaSecret: this.enc.decryptNullable(user.twoFaSecret),
    };
  }

  // ── BankAccount ───────────────────────────────────────────────────────────────
  prepareBankAccount(data: {
    accountName?: string;
    accountNumber?: string;
    flwRecipientId?: string | null;
  }) {
    const result: Record<string, any> = {};

    if (data.accountName !== undefined) {
      result.accountName = this.enc.encrypt(data.accountName);
    }
    if (data.accountNumber !== undefined) {
      result.accountNumber = this.enc.encrypt(data.accountNumber);
      result.accountNumberHash = this.enc.hash(data.accountNumber);
    }
    if (data.flwRecipientId !== undefined) {
      result.flwRecipientId = this.enc.encryptNullable(data.flwRecipientId);
    }

    return result;
  }

  decryptBankAccount(account: any) {
    if (!account) return account;
    return {
      ...account,
      accountName: this.enc.decrypt(account.accountName),
      accountNumber: this.enc.decrypt(account.accountNumber),
      // Return masked version for display — decrypted only when needed
      accountNumberMasked: this.enc.mask(
        this.enc.decrypt(account.accountNumber),
      ),
      flwRecipientId: this.enc.decryptNullable(account.flwRecipientId),
    };
  }

  // ── KycRecord ─────────────────────────────────────────────────────────────────
  prepareKycRecord(data: {
    documentNumber?: string;
    // documentFrontUrl?: string | null;
    // documentBackUrl?: string | null;
    selfieUrl?: string | null;
    bvn?: string | null;
    nin?: string | null;
    providerRef?: string | null;
  }) {
    const result: Record<string, any> = {};

    if (data.documentNumber !== undefined) {
      result.documentNumber = this.enc.encrypt(data.documentNumber);
    }
    // if (data.documentFrontUrl !== undefined) {
    //   result.documentFrontUrl = this.enc.encryptNullable(data.documentFrontUrl);
    // }
    // if (data.documentBackUrl !== undefined) {
    //   result.documentBackUrl = this.enc.encryptNullable(data.documentBackUrl);
    // }
    if (data.selfieUrl !== undefined) {
      result.selfieUrl = this.enc.encryptNullable(data.selfieUrl);
    }
    if (data.bvn !== undefined) {
      result.bvnHash = data.bvn ? this.enc.hash(data.bvn) : null;
    }
    if (data.nin !== undefined) {
      result.ninHash = data.nin ? this.enc.hash(data.nin) : null;
    }
    if (data.providerRef !== undefined) {
      result.providerRef = this.enc.encryptNullable(data.providerRef);
    }

    return result;
  }

  decryptKycRecord(record: any) {
    if (!record) return record;
    return {
      ...record,
      documentNumber: this.enc.decrypt(record.documentNumber),
    //   documentFrontUrl: this.enc.decryptNullable(record.documentFrontUrl),
    //   documentBackUrl: this.enc.decryptNullable(record.documentBackUrl),
      selfieUrl: this.enc.decryptNullable(record.selfieUrl),
      providerRef: this.enc.decryptNullable(record.providerRef),
      // bvnHash and ninHash are one-way — never decrypted
    };
  }

  // ── WalletTransaction ─────────────────────────────────────────────────────────
  prepareWalletTransaction(data: { description?: string }) {
    const result: Record<string, any> = {};
    if (data.description !== undefined) {
      result.description = this.enc.encrypt(data.description);
    }
    return result;
  }

  decryptWalletTransaction(tx: any) {
    if (!tx) return tx;
    return {
      ...tx,
      description: this.enc.decrypt(tx.description),
    };
  }
}
