import { EncryptionService } from './encryption.service';

// Used as: @Column({ transformer: encryptedTransformer(encryptionService) })
// Encryption happens automatically on save, decryption on load

export const encryptedTransformer = (enc: EncryptionService) => ({
  to: (value: string | null) => enc.encryptNullable(value),
  from: (value: string | null) => enc.decryptNullable(value),
});
