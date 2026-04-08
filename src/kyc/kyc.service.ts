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
import {
  SmileIdentityService,
  SmileVerificationResult,
} from './smile-identity.service';
import { EmailService } from '../email/email.service';
import {
  InitiateBvnDto,
  InitiateNinDto,
  SubmitKycWithFaceDto,
  ReviewKycDto,
  SmileWebhookDto,
  KycVerificationType,
} from './dto/kyc.dto';

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

    private smileService: SmileIdentityService,
    private emailService: EmailService,
  ) {}

  // ── GET KYC STATUS ────────────────────────────────────────────────────────────
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

  // ── STEP 1: VERIFY BVN ────────────────────────────────────────────────────────
  // User submits their BVN — we verify it against Smile Identity database.
  // The name returned here is the authoritative verified name for this user.
  // It will be used to overwrite the user's profile in Step 2 (NIN + face).
  async verifyBvn(
    userId: string,
    dto: InitiateBvnDto,
  ): Promise<{
    verified: boolean;
    fullName: string | null;
    jobId: string;
    message: string;
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.kycStatus === KycStatus.VERIFIED) {
      throw new BadRequestException('Your identity is already verified');
    }

    // Hash BVN before storing — never persist the raw BVN
    const bvnHash = crypto
      .createHash('sha256')
      .update(dto.bvn.trim())
      .digest('hex');

    // Check if BVN already used by another account
    const existingBvn = await this.kycRepo
      .createQueryBuilder('kyc')
      .where('kyc.document_number = :hash', { hash: bvnHash })
      .andWhere('kyc.status IN (:...statuses)', {
        statuses: [KycStatus.SUBMITTED, KycStatus.VERIFIED],
      })
      .andWhere('kyc.user_id != :userId', { userId })
      .getOne();

    if (existingBvn) {
      throw new BadRequestException(
        'This BVN is already associated with another account',
      );
    }

    // Call Smile Identity BVN verification
    const result = await this.smileService.verifyBvn({
      userId,
      bvn: dto.bvn,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    if (!result.idVerified) {
      await this.saveAudit(
        userId,
        AuditActorType.USER,
        'kyc.bvn_failed',
        'kyc_records',
        undefined,
        null,
        { resultCode: result.resultCode, resultText: result.resultText },
      );

      throw new BadRequestException(
        `BVN verification failed: ${result.resultText}. ` +
          `Please ensure your BVN is correct.`,
      );
    }

    // Derive clean first/last name from the Smile Identity result.
    // extractVerifiedName normalises single-word names and trims whitespace.
    const { firstName, lastName, fullName } = this.extractVerifiedName(
      result.fullName,
      result.firstName,
      result.lastName,
    );

    // Save/update KYC record with BVN data
    const existing = await this.kycRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const bvnMeta = {
      bvnVerified: true,
      bvnJobId: result.jobId,
      smileJobId: result.smileJobId,
      // Store the normalised names — these are the source of truth for
      // every downstream name update (NIN step, webhook path, admin review)
      fullName,
      firstName,
      lastName,
      dateOfBirth: result.dateOfBirth,
      gender: result.gender,
      verifiedAt: new Date().toISOString(),
    };

    if (existing) {
      await this.updateKyc(existing.id, {
        documentType: 'bvn' as any,
        documentNumber: bvnHash,
        status: KycStatus.SUBMITTED,
        provider: 'smile_identity',
        providerRef: result.jobId,
        metadata: bvnMeta,
      });
    } else {
      await this.kycRepo.save(
        this.kycRepo.create({
          userId,
          documentType: 'bvn' as any,
          documentNumber: bvnHash,
          status: KycStatus.SUBMITTED,
          provider: 'smile_identity',
          providerRef: result.jobId,
          metadata: bvnMeta,
        }),
      );
    }

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'kyc.bvn_verified',
      'kyc_records',
      undefined,
      null,
      { jobId: result.jobId, resultCode: result.resultCode },
    );

    this.logger.log(
      `BVN verified for userId=${userId} jobId=${result.jobId} name="${fullName}"`,
    );

    return {
      verified: true,
      fullName,
      jobId: result.jobId,
      message: 'BVN verified successfully. Please proceed to NIN verification.',
    };
  }

  // ── STEP 2: VERIFY NIN + FACE ─────────────────────────────────────────────────
  // User submits NIN + selfie — we verify NIN and compare face against it.
  // On success: user profile (firstName, lastName, verifiedName) is replaced
  // with the BVN-verified name captured in Step 1. The NIN result name is
  // intentionally ignored to avoid inconsistency.
  async verifyNinWithFace(
    userId: string,
    dto: SubmitKycWithFaceDto,
  ): Promise<{
    verified: boolean;
    message: string;
    fullName: string | null;
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.kycStatus === KycStatus.VERIFIED) {
      throw new BadRequestException('Your identity is already verified');
    }

    // Ensure BVN step was completed first
    const kycRecord = await this.kycRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const bvnVerified = (kycRecord?.metadata as any)?.bvnVerified === true;
    if (!bvnVerified) {
      throw new BadRequestException(
        'Please verify your BVN first before proceeding to NIN verification',
      );
    }

    // Hash NIN before storing — never persist the raw NIN
    const ninHash = crypto
      .createHash('sha256')
      .update(dto.idNumber.trim())
      .digest('hex');

    // Check if NIN already used by another account
    const existingNin = await this.kycRepo
      .createQueryBuilder('kyc')
      .where("kyc.metadata->>'ninHash' = :hash", { hash: ninHash })
      .andWhere('kyc.status = :status', { status: KycStatus.VERIFIED })
      .andWhere('kyc.user_id != :userId', { userId })
      .getOne();

    if (existingNin) {
      throw new BadRequestException(
        'This NIN is already associated with another verified account',
      );
    }

    // Validate selfie image (must be base64)
    if (
      !dto.selfieImage.startsWith('data:image') &&
      !this.isBase64(dto.selfieImage)
    ) {
      throw new BadRequestException(
        'Invalid selfie image format. Must be a base64 encoded image.',
      );
    }

    // Call Smile Identity — NIN + face verification
    const result = await this.smileService.verifyWithFace({
      userId,
      idType: dto.idType,
      idNumber: dto.idNumber,
      selfieBase64: dto.selfieImage,
      firstName: user.firstName,
      lastName: user.lastName,
      dateOfBirth: dto.dateOfBirth,
    });

    // ── Handle verification failures ──────────────────────────────────────────

    if (!result.idVerified) {
      await this.updateKyc(kycRecord!.id, {
        status: KycStatus.REJECTED,
        rejectionReason: `ID verification failed: ${result.resultText}`,
      });
      await this.userRepo.update(userId, { kycStatus: KycStatus.REJECTED });
      await this.sendKycRejectedNotifications(
        user,
        `ID verification failed: ${result.resultText}`,
      );
      throw new BadRequestException(
        `NIN verification failed: ${result.resultText}. Please check your NIN and try again.`,
      );
    }

    if (!result.faceVerified) {
      await this.updateKyc(kycRecord!.id, {
        status: KycStatus.REJECTED,
        rejectionReason:
          'Face does not match the ID. Please ensure your selfie is clear.',
      });
      await this.userRepo.update(userId, { kycStatus: KycStatus.REJECTED });
      await this.sendKycRejectedNotifications(
        user,
        'Your selfie did not match the photo on your ID document.',
      );
      throw new BadRequestException(
        'Face verification failed. Your selfie does not match your ID. Please try again with a clearer photo.',
      );
    }

    if (!result.livenessCheck) {
      await this.updateKyc(kycRecord!.id, {
        status: KycStatus.REJECTED,
        rejectionReason:
          'Liveness check failed. Possible use of photo or video.',
      });
      await this.userRepo.update(userId, { kycStatus: KycStatus.REJECTED });
      await this.sendKycRejectedNotifications(
        user,
        'Liveness check failed. Please take a live selfie (not a photo of a photo).',
      );
      throw new BadRequestException(
        'Liveness check failed. Please ensure you are taking a live selfie.',
      );
    }

    // ── ALL CHECKS PASSED ─────────────────────────────────────────────────────
    // Pull the BVN-verified name that was normalised and stored in Step 1.
    // This is the single source of truth — we never use the NIN result name.
    const { firstName, lastName, fullName } = this.resolveVerifiedName(
      kycRecord!.metadata as any,
      user,
    );

    // Replace user profile with BVN-verified identity
    await this.applyVerifiedNameToUser(userId, firstName, lastName, fullName);

    // Update KYC record to VERIFIED with full audit trail
    await this.updateKyc(kycRecord!.id, {
      status: KycStatus.VERIFIED,
      reviewedAt: new Date(),
      rejectionReason: null,
      metadata: {
        ...((kycRecord!.metadata as any) ?? {}),
        ninVerified: true,
        faceVerified: true,
        livenessCheck: true,
        ninHash,
        ninJobId: result.jobId,
        smileJobId: result.smileJobId,
        // Record exactly what was written to the user profile
        verifiedName: fullName,
        verifiedFirstName: firstName,
        verifiedLastName: lastName,
        dateOfBirth: result.dateOfBirth,
        gender: result.gender,
        resultCode: result.resultCode,
        verifiedAt: new Date().toISOString(),
      },
    });

    await this.sendKycApprovedNotifications(user, fullName);

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'kyc.verified',
      'kyc_records',
      kycRecord!.id,
      null,
      {
        jobId: result.jobId,
        resultCode: result.resultCode,
        verifiedName: fullName,
        nameSource: 'bvn',
        previousFirstName: user.firstName,
        previousLastName: user.lastName,
      },
    );

    this.logger.log(
      `KYC VERIFIED: userId=${userId} name="${fullName}" ` +
        `(was: "${user.firstName} ${user.lastName}") jobId=${result.jobId}`,
    );

    return {
      verified: true,
      fullName,
      message:
        `Identity verified successfully. Your profile has been updated to ` +
        `${fullName}.`,
    };
  }

  // ── SMILE IDENTITY WEBHOOK ────────────────────────────────────────────────────
  async handleSmileWebhook(
    payload: string,
    dto: SmileWebhookDto,
  ): Promise<{ received: boolean }> {
    const isValid = this.smileService.verifyWebhookSignature(
      dto.timestamp,
      dto.signature,
    );

    if (!isValid) {
      this.logger.warn('Invalid Smile Identity webhook signature');
    }

    this.logger.log(
      `Smile webhook: jobId=${dto.job_id} resultCode=${dto.result?.ResultCode}`,
    );

    // Find KYC record by job ID
    const kycRecord = await this.kycRepo
      .createQueryBuilder('kyc')
      .where('kyc.provider_ref = :jobId', { jobId: dto.job_id })
      .orWhere("kyc.metadata->>'ninJobId' = :jobId", { jobId: dto.job_id })
      .orWhere("kyc.metadata->>'bvnJobId' = :jobId", { jobId: dto.job_id })
      .getOne();

    if (!kycRecord) {
      this.logger.warn(`KYC record not found for jobId=${dto.job_id}`);
      return { received: true };
    }

    const result = this.smileService.parseVerificationResult(dto, dto.job_id);

    // Only process final results
    if (dto.result?.IsFinalResult !== 'true') {
      this.logger.log(`Non-final result for jobId=${dto.job_id} — skipping`);
      return { received: true };
    }

    const user = await this.userRepo.findOne({
      where: { id: kycRecord.userId },
    });
    if (!user) return { received: true };

    if (result.success && result.faceVerified && result.livenessCheck) {
      // Same resolution logic as the NIN step — always use BVN metadata name
      const { firstName, lastName, fullName } = this.resolveVerifiedName(
        kycRecord.metadata as any,
        user,
      );

      await this.applyVerifiedNameToUser(
        kycRecord.userId,
        firstName,
        lastName,
        fullName,
      );

      await this.updateKyc(kycRecord.id, {
        status: KycStatus.VERIFIED,
        reviewedAt: new Date(),
        metadata: {
          ...((kycRecord.metadata as any) ?? {}),
          webhookVerified: true,
          verifiedName: fullName,
          verifiedFirstName: firstName,
          verifiedLastName: lastName,
          resultCode: result.resultCode,
          finalVerifiedAt: new Date().toISOString(),
        },
      });

      await this.sendKycApprovedNotifications(user, fullName);

      this.logger.log(
        `KYC VERIFIED via webhook: userId=${kycRecord.userId} name="${fullName}"`,
      );
    } else {
      const reason = `Verification failed: ${result.resultText} (${result.resultCode})`;

      await this.userRepo.update(kycRecord.userId, {
        kycStatus: KycStatus.REJECTED,
      });

      await this.updateKyc(kycRecord.id, {
        status: KycStatus.REJECTED,
        rejectionReason: reason,
      });

      await this.sendKycRejectedNotifications(user, reason);

      this.logger.log(
        `KYC REJECTED via webhook: userId=${kycRecord.userId} reason="${reason}"`,
      );
    }

    return { received: true };
  }

  // ── ADMIN: REVIEW KYC ─────────────────────────────────────────────────────────
  async adminReview(recordId: string, reviewerId: string, dto: ReviewKycDto) {
    const record = await this.kycRepo.findOne({
      where: { id: recordId },
      relations: ['user'],
    });

    if (!record) throw new NotFoundException('KYC record not found');
    if (record.status === KycStatus.VERIFIED)
      throw new BadRequestException('Already verified');

    const newStatus =
      dto.status === 'verified' ? KycStatus.VERIFIED : KycStatus.REJECTED;

    await this.updateKyc(recordId, {
      status: newStatus,
      rejectionReason: dto.rejectionReason ?? null,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    });

    await this.userRepo.update(record.userId, { kycStatus: newStatus });

    const user = record.user as User;

    if (newStatus === KycStatus.VERIFIED) {
      // Admin approval also applies the BVN-verified name if it was captured
      const { firstName, lastName, fullName } = this.resolveVerifiedName(
        record.metadata as any,
        user,
      );
      await this.applyVerifiedNameToUser(
        record.userId,
        firstName,
        lastName,
        fullName,
      );
      await this.sendKycApprovedNotifications(user, fullName);
    } else {
      await this.sendKycRejectedNotifications(
        user,
        dto.rejectionReason ?? 'Not specified',
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

  // ── ADMIN: GET ALL ────────────────────────────────────────────────────────────
  async adminGetAll(status?: KycStatus, page = 1, limit = 20) {
    const qb = this.kycRepo
      .createQueryBuilder('kyc')
      .leftJoinAndSelect('kyc.user', 'user')
      .orderBy('kyc.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) qb.where('kyc.status = :status', { status });

    const [records, total] = await qb.getManyAndCount();
    return {
      data: records,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminGetOne(recordId: string) {
    const record = await this.kycRepo.findOne({
      where: { id: recordId },
      relations: ['user'],
    });
    if (!record) throw new NotFoundException('KYC record not found');
    return record;
  }

  // ── PRIVATE: EXTRACT VERIFIED NAME (from Smile Identity result) ───────────────
  //
  // Normalises the name returned by Smile Identity at BVN verification time.
  // Handles three common shapes:
  //   1. firstName + lastName both present   → use as-is
  //   2. fullName only, single word           → treat as firstName, lastName = ''
  //   3. fullName only, multiple words        → first token = firstName,
  //                                             rest joined = lastName
  //
  // This is the ONLY place Smile-supplied name strings are processed.
  // Every downstream path (NIN step, webhook, admin review) reads from the
  // already-normalised values stored in KYC metadata.
  // ─────────────────────────────────────────────────────────────────────────────
  private extractVerifiedName(
    rawFullName: string | null | undefined,
    rawFirstName: string | null | undefined,
    rawLastName: string | null | undefined,
  ): { firstName: string; lastName: string; fullName: string } {
    const trim = (s: string | null | undefined) => (s ?? '').trim();

    let firstName = trim(rawFirstName);
    let lastName = trim(rawLastName);

    // If Smile returned explicit first/last names, prefer those
    if (firstName || lastName) {
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      return { firstName, lastName, fullName };
    }

    // Fall back to splitting fullName
    const full = trim(rawFullName);
    if (!full) {
      // Nothing usable — caller will fall back to existing user names
      return { firstName: '', lastName: '', fullName: '' };
    }

    const parts = full.split(/\s+/);
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: '', fullName: parts[0] };
    }

    firstName = parts[0];
    lastName = parts.slice(1).join(' ');
    return { firstName, lastName, fullName: full };
  }

  // ── PRIVATE: RESOLVE VERIFIED NAME (from KYC metadata) ───────────────────────
  //
  // Reads the BVN-verified name that was normalised and stored in Step 1.
  // Falls back to the user's current profile names only if metadata is absent
  // (e.g. records created before this logic was added).
  // ─────────────────────────────────────────────────────────────────────────────
  private resolveVerifiedName(
    metadata: Record<string, any> | null | undefined,
    user: User,
  ): { firstName: string; lastName: string; fullName: string } {
    const meta = metadata ?? {};

    const firstName =
      (meta.firstName as string | undefined)?.trim() || user.firstName;
    const lastName =
      (meta.lastName as string | undefined)?.trim() || user.lastName;

    // Prefer the stored fullName; rebuild from parts only if absent
    const fullName =
      (meta.fullName as string | undefined)?.trim() ||
      [firstName, lastName].filter(Boolean).join(' ');

    return { firstName, lastName, fullName };
  }

  // ── PRIVATE: APPLY VERIFIED NAME TO USER ──────────────────────────────────────
  //
  // Single function that owns the user profile name update.
  // Called by: verifyNinWithFace, handleSmileWebhook, adminReview.
  // Always sets firstName, lastName, verifiedName, and kycStatus together
  // so the user row is never left in a partial state.
  // ─────────────────────────────────────────────────────────────────────────────
  private async applyVerifiedNameToUser(
    userId: string,
    firstName: string,
    lastName: string,
    fullName: string,
  ): Promise<void> {
    await this.userRepo.update(userId, {
      firstName,
      lastName,
      verifiedName: fullName,
      kycStatus: KycStatus.VERIFIED,
    });

    this.logger.log(
      `User profile updated: userId=${userId} firstName="${firstName}" ` +
        `lastName="${lastName}" verifiedName="${fullName}"`,
    );
  }

  // ── PRIVATE: SEND APPROVED NOTIFICATIONS ──────────────────────────────────────
  private async sendKycApprovedNotifications(
    user: User,
    verifiedName: string,
  ): Promise<void> {
    await this.sendNotification(
      user.id,
      NotificationType.KYC_APPROVED,
      'Identity Verified ✅',
      `Your identity has been verified. Your profile name has been updated to ${verifiedName}. You now have full access.`,
    );

    try {
      await this.emailService.sendKycApproved(user.email, {
        firstName: user.firstName,
      });
    } catch (err) {
      this.logger.warn(`Failed to send KYC approval email: ${err.message}`);
    }
  }

  // ── PRIVATE: SEND REJECTED NOTIFICATIONS ──────────────────────────────────────
  private async sendKycRejectedNotifications(
    user: User,
    reason: string,
  ): Promise<void> {
    await this.sendNotification(
      user.id,
      NotificationType.KYC_REJECTED,
      'Identity Verification Failed',
      `KYC verification failed. Reason: ${reason}. Please re-submit.`,
    );

    try {
      await this.emailService.sendKycRejected(user.email, {
        firstName: user.firstName,
        reason,
      });
    } catch (err) {
      this.logger.warn(`Failed to send KYC rejection email: ${err.message}`);
    }
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────

  private async updateKyc(
    id: string,
    partial: Partial<KycRecord>,
  ): Promise<void> {
    await this.kycRepo.update(id, partial as any);
  }

  private isBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
      return false;
    }
  }

  private async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, any>,
  ) {
    await this.notifRepo.save([
      this.notifRepo.create({
        userId,
        type,
        channel: NotificationChannel.EMAIL,
        title,
        body,
        data: data ?? null,
      }),
      this.notifRepo.create({
        userId,
        type,
        channel: NotificationChannel.IN_APP,
        title,
        body,
        data: data ?? null,
      }),
    ]);
  }

  private async saveAudit(
    userId: string | null,
    actorType: AuditActorType,
    action: string,
    entityType?: string,
    entityId?: string,
    oldValues?: any,
    newValues?: any,
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
      }),
    );
  }
}
