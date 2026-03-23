import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuidaxService } from './quidax.service';
import { Transaction } from '../entities/transaction.entity';
import { WebhookEvent } from '../entities/webhook-event.entity';
import { Notification } from '../entities/notification.entity';
import { AuditLog } from '../entities/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      WebhookEvent,
      Notification,
      AuditLog,
    ]),
  ],
  providers: [QuidaxService],
  exports: [QuidaxService],
})
export class QuidaxModule {}
