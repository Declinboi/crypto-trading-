import { Module, Global } from '@nestjs/common';
import { EncryptionService }     from './encryption.service';
// import { EncryptionInitializer } from './encryption.initializer';

@Global()
@Module({
  providers: [EncryptionService /*, EncryptionInitializer */],
  exports:   [EncryptionService],
})
export class EncryptionModule {}