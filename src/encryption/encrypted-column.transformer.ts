import { EncryptionService } from './encryption.service';

// Singleton reference — set once when EncryptionService is initialized
let _encryptionService: EncryptionService | null = null;

export function setEncryptionService(service: EncryptionService) {
  _encryptionService = service;
}

export function getEncryptionService(): EncryptionService {
  if (!_encryptionService) {
    throw new Error('EncryptionService not initialized yet');
  }
  return _encryptionService;
}

// Use this as a TypeORM column transformer
export const EncryptedColumnTransformer = {
  to(value: string | null): string | null {
    if (!value) return value;
    try {
      return getEncryptionService().encrypt(value);
    } catch {
      return value;
    }
  },
  from(value: string | null): string | null {
    if (!value) return value;
    try {
      return getEncryptionService().decrypt(value);
    } catch {
      return value;
    }
  },
};