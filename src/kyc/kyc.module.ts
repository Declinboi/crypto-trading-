import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { SmileIdentityService } from './smile-identity.service';
import { KycRecord } from '../entities/kyc-record.entity';
import { User } from '../entities/user.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([KycRecord, User, AuditLog, Notification]),
  ],
  controllers: [KycController],
  providers: [KycService, SmileIdentityService],
  exports: [KycService, SmileIdentityService],
})
export class KycModule {}
