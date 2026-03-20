import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { KycRecord } from '../entities/kyc-record.entity';
import { User } from '../entities/user.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';
import {
  KycStatus,
  AuditActorType,
  NotificationType,
  NotificationChannel,
} from '../entities/enums';
import { SumsubService } from './sumsub.service';
import {
  InitiateKycDto,
  SubmitKycDto,
  ReviewKycDto,
  SumsubWebhookDto,
} from './dto/kyc.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @InjectRepository(KycRecord)
    private kycRepo: Repository<KycRecord>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    private sumsubService: SumsubService,
    private config: ConfigService,
  ) {}

  // ── GET KYC STATUS ─────────────────────────────────────────────────────────────
  async getStatus(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const record = await this.kycRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return {
      kycStatus: user.kycStatus,
      record: record ?? null,
    };
  }

  // ── INITIATE KYC (Sumsub SDK flow) ────────────────────────────────────────────
  // Returns a Sumsub SDK token the frontend uses to launch the verification widget
  async initiate(userId: string, dto: InitiateKycDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.kycStatus === KycStatus.VERIFIED) {
      throw new BadRequestException('Your identity has already been verified');
    }

    if (user.kycStatus === KycStatus.SUBMITTED) {
      throw new BadRequestException(
        'KYC is already under review. Please wait for the result.',
      );
    }

    // Check if rejected — allow re-submission
    const existingRecord = await this.kycRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    let applicantId: string;

    if (existingRecord?.providerRef) {
      // Reset existing applicant for re-submission
      try {
        await this.sumsubService.resetApplicant(existingRecord.providerRef);
        applicantId = existingRecord.providerRef;
        this.logger.log(
          `Reset Sumsub applicant ${applicantId} for user ${userId}`,
        );
      } catch (err) {
        this.logger.error(`Failed to reset applicant: ${err.message}`);
        // Create a new applicant if reset fails
        const created = await this.sumsubService.createApplicant(userId);
        applicantId = created.applicantId;
      }
    } else {
      // Create new applicant
      const created = await this.sumsubService.createApplicant(userId);
      applicantId = created.applicantId;
    }

    // Generate SDK access token for frontend widget
    const { token } = await this.sumsubService.generateSdkAccessToken(userId);

    // Create or update KYC record
    if (existingRecord) {
      await this.kycRepo.update(existingRecord.id, {
        documentType: dto.documentType,
        status: KycStatus.PENDING,
        provider: 'sumsub',
        providerRef: applicantId,
        rejectionReason: null,
        reviewedAt: null,
        reviewedById: null,
      });
    } else {
      await this.kycRepo.save(
        this.kycRepo.create({
          userId,
          documentType: dto.documentType,
          documentNumber: 'pending', // filled after Sumsub review
          status: KycStatus.PENDING,
          provider: 'sumsub',
          providerRef: applicantId,
        }),
      );
    }

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'kyc.initiated',
      'kyc_records',
      userId,
    );

    return {
      applicantId,
      sdkToken: token,
      message:
        'KYC initiated. Use the SDK token to launch the verification widget.',
    };
  }

  // ── SUBMIT KYC (manual fallback, no SDK) ─────────────────────────────────────
  async submit(userId: string, dto: SubmitKycDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.kycStatus === KycStatus.VERIFIED) {
      throw new BadRequestException('Your identity has already been verified');
    }

    if (user.kycStatus === KycStatus.SUBMITTED) {
      throw new BadRequestException('KYC already submitted. Awaiting review.');
    }

    // Hash sensitive document numbers
    const documentHash = crypto
      .createHash('sha256')
      .update(dto.documentNumber.toLowerCase().trim())
      .digest('hex');

    // Check for duplicate document (dedup)
    const duplicate = await this.kycRepo
      .createQueryBuilder('kyc')
      .where('kyc.document_number = :hash', { hash: documentHash })
      .andWhere('kyc.status IN (:...statuses)', {
        statuses: [KycStatus.SUBMITTED, KycStatus.VERIFIED],
      })
      .andWhere('kyc.user_id != :userId', { userId })
      .getOne();

    if (duplicate) {
      throw new BadRequestException(
        'This document has already been used for verification',
      );
    }

    const existing = await this.kycRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const kycData = {
      documentType: dto.documentType,
      documentNumber: documentHash,
      documentFrontUrl: dto.documentFrontUrl ?? null,
      documentBackUrl: dto.documentBackUrl ?? null,
      selfieUrl: dto.selfieUrl ?? null,
      status: KycStatus.SUBMITTED,
      provider: 'manual',
    };

    let record: KycRecord;

    if (existing && existing.status !== KycStatus.VERIFIED) {
      await this.kycRepo.update(existing.id, {
        ...kycData,
        rejectionReason: null,
        reviewedAt: null,
        reviewedById: null,
      });
      record = { ...existing, ...kycData } as KycRecord;
    } else {
      record = await this.kycRepo.save(
        this.kycRepo.create({ userId, ...kycData }),
      );
    }

    // Update user kyc status
    await this.userRepo.update(userId, { kycStatus: KycStatus.SUBMITTED });

    // Notify user
    await this.sendNotification(
      userId,
      NotificationType.KYC_APPROVED, // reuse — add KYC_SUBMITTED type later
      'KYC Submitted Successfully',
      'Your identity documents have been submitted and are under review. We will notify you within 24 hours.',
    );

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'kyc.submitted',
      'kyc_records',
      record.id,
    );

    return {
      message: 'KYC documents submitted successfully. Review in progress.',
      recordId: record.id,
      status: KycStatus.SUBMITTED,
    };
  }

  // ── SUMSUB WEBHOOK HANDLER ────────────────────────────────────────────────────
  async handleSumsubWebhook(
    payload: string,
    signature: string,
    dto: SumsubWebhookDto,
  ) {
    // Verify signature
    const isValid = this.sumsubService.verifyWebhookSignature(
      payload,
      signature,
    );
    if (!isValid) {
      this.logger.warn('Invalid Sumsub webhook signature received');
      throw new ForbiddenException('Invalid webhook signature');
    }

    this.logger.log(
      `Sumsub webhook received: type=${dto.type} applicantId=${dto.applicantId} status=${dto.reviewStatus}`,
    );

    // Only process final review events
    if (dto.type !== 'applicantReviewed') {
      this.logger.log(`Ignoring non-review event: ${dto.type}`);
      return { received: true };
    }

    const userId = dto.externalUserId;

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(
        `Sumsub webhook: user not found for externalUserId=${userId}`,
      );
      return { received: true };
    }

    const record = await this.kycRepo.findOne({
      where: { userId, providerRef: dto.applicantId },
      order: { createdAt: 'DESC' },
    });

    const isApproved = dto.reviewResult?.reviewAnswer === 'GREEN';
    const newKycStatus = isApproved ? KycStatus.VERIFIED : KycStatus.REJECTED;

    const rejectionReason = isApproved
      ? null
      : dto.reviewResult?.clientComment ||
        dto.reviewResult?.moderationComment ||
        dto.reviewResult?.rejectLabels?.join(', ') ||
        'Verification failed';

    if (record) {
      await this.kycRepo.update(record.id, {
        status: newKycStatus,
        rejectionReason,
        reviewedAt: new Date(),
        provider: 'sumsub',
        providerRef: dto.applicantId,
      });
    } else {
      // Create record from webhook if it doesn't exist
      await this.kycRepo.save(
        this.kycRepo.create({
          userId,
          documentType: 'passport', // unknown at this point
          documentNumber: 'sumsub-verified',
          status: newKycStatus,
          rejectionReason,
          provider: 'sumsub',
          providerRef: dto.applicantId,
          reviewedAt: new Date(),
        }),
      );
    }

    // Update user KYC status
    await this.userRepo.update(userId, { kycStatus: newKycStatus });

    // Send notification
    if (isApproved) {
      await this.sendNotification(
        userId,
        NotificationType.KYC_APPROVED,
        'Identity Verified ✅',
        'Your identity has been successfully verified. You can now create invoices and receive payouts.',
      );
    } else {
      await this.sendNotification(
        userId,
        NotificationType.KYC_REJECTED,
        'Identity Verification Failed',
        `Your KYC submission was rejected. Reason: ${rejectionReason}. Please re-submit with valid documents.`,
      );
    }

    await this.saveAudit(
      userId,
      AuditActorType.WEBHOOK,
      isApproved ? 'kyc.approved' : 'kyc.rejected',
      'kyc_records',
      record?.id,
      null,
      {
        applicantId: dto.applicantId,
        reviewAnswer: dto.reviewResult?.reviewAnswer,
      },
    );

    this.logger.log(
      `KYC ${isApproved ? 'APPROVED' : 'REJECTED'} for user ${userId}`,
    );

    return { received: true };
  }

  // ── ADMIN: GET ALL KYC RECORDS ────────────────────────────────────────────────
  async adminGetAll(status?: KycStatus, page = 1, limit = 20) {
    const query = this.kycRepo
      .createQueryBuilder('kyc')
      .leftJoinAndSelect('kyc.user', 'user')
      .orderBy('kyc.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      query.where('kyc.status = :status', { status });
    }

    const [records, total] = await query.getManyAndCount();

    return {
      data: records,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── ADMIN: REVIEW KYC (manual review) ────────────────────────────────────────
  async adminReview(recordId: string, reviewerId: string, dto: ReviewKycDto) {
    const record = await this.kycRepo.findOne({
      where: { id: recordId },
      relations: ['user'],
    });

    if (!record) throw new NotFoundException('KYC record not found');

    if (record.status === KycStatus.VERIFIED) {
      throw new BadRequestException(
        'This KYC record has already been verified',
      );
    }

    const newStatus =
      dto.status === 'verified' ? KycStatus.VERIFIED : KycStatus.REJECTED;

    await this.kycRepo.update(recordId, {
      status: newStatus,
      rejectionReason: dto.rejectionReason ?? null,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    });

    await this.userRepo.update(record.userId, { kycStatus: newStatus });

    // Notify user
    if (newStatus === KycStatus.VERIFIED) {
      await this.sendNotification(
        record.userId,
        NotificationType.KYC_APPROVED,
        'Identity Verified ✅',
        'Your identity has been successfully verified. You can now create invoices and receive payouts.',
      );
    } else {
      await this.sendNotification(
        record.userId,
        NotificationType.KYC_REJECTED,
        'Identity Verification Failed',
        `Your KYC was rejected. Reason: ${dto.rejectionReason ?? 'Not specified'}. Please re-submit.`,
      );
    }

    await this.saveAudit(
      reviewerId,
      AuditActorType.ADMIN,
      newStatus === KycStatus.VERIFIED ? 'kyc.approved' : 'kyc.rejected',
      'kyc_records',
      recordId,
      { status: record.status },
      { status: newStatus, rejectionReason: dto.rejectionReason },
    );

    return {
      message: `KYC ${dto.status} successfully`,
      recordId,
      status: newStatus,
    };
  }

  // ── ADMIN: GET SINGLE KYC RECORD ──────────────────────────────────────────────
  async adminGetOne(recordId: string) {
    const record = await this.kycRepo.findOne({
      where: { id: recordId },
      relations: ['user', 'reviewedBy'],
    });
    if (!record) throw new NotFoundException('KYC record not found');
    return record;
  }

  // ── GET SUMSUB APPLICANT DETAILS ──────────────────────────────────────────────
  async getSumsubApplicant(userId: string) {
    const record = await this.kycRepo.findOne({
      where: { userId, provider: 'sumsub' },
      order: { createdAt: 'DESC' },
    });

    if (!record?.providerRef) {
      throw new NotFoundException('No Sumsub applicant found for this user');
    }

    const applicant = await this.sumsubService.getApplicant(record.providerRef);
    return applicant;
  }

  // ── PRIVATE HELPERS ────────────────────────────────────────────────────────────
  private async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, any>,
  ) {
    await this.notifRepo.save(
      this.notifRepo.create({
        userId,
        type,
        channel: NotificationChannel.EMAIL,
        title,
        body,
        data: data ?? null,
      }),
    );

    // Also save in-app notification
    await this.notifRepo.save(
      this.notifRepo.create({
        userId,
        type,
        channel: NotificationChannel.IN_APP,
        title,
        body,
        data: data ?? null,
      }),
    );
  }

  private async saveAudit(
    userId: string | null,
    actorType: AuditActorType,
    action: string,
    entityType?: string,
    entityId?: string,
    oldValues?: any,
    newValues?: any,
    ipAddress?: string,
  ) {
    await this.auditRepo.save(
      this.auditRepo.create({
        userId,
        actorType,
        action,
        entityType,
        entityId,
        oldValues: oldValues ?? null,
        newValues: newValues ?? null,
        ipAddress: ipAddress ?? null,
      }),
    );
  }
}
