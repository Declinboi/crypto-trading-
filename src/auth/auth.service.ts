import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { nanoid } from 'nanoid';

import { WhatsappOtpService } from '../whatsapp/whatsapp-otp.service';
import { User } from '../entities/user.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';
import {
  UserRole,
  KycStatus,
  AuditActorType,
  NotificationType,
  NotificationChannel,
  TwoFaMethod,
} from '../entities/enums';
import { EmailService } from '../email/email.service';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  Enable2FADto,
  SetPinDto,
  VerifyPinDto,
  ChangePinDto,
  ResetPinDto,
  VerifyEmailOtpDto,
  SwitchToAuthenticatorDto,
  SwitchToEmailDto,
  SendPhoneOtpDto,
  VerifyPhoneOtpDto,
} from './dto/auth.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';
import { EncryptionService } from '../encryption/encryption.service';
import { EncryptionHelper } from '../encryption/encryption.helper';

@Injectable()
export class AuthService {
  private readonly encHelper: EncryptionHelper;

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    @Inject(REDIS_CLIENT) private redis: Redis,

    private whatsappOtp: WhatsappOtpService,
    private jwtService: JwtService,
    private config: ConfigService,
    private emailService: EmailService,
    private encryptionService: EncryptionService,
  ) {
    this.encHelper = new EncryptionHelper(this.encryptionService);
  }

  // ── REDIS KEY HELPERS ─────────────────────────────────────────────────────────
  private rk = {
    passwordReset: (t: string) => `auth:pwd-reset:${t}`,
    emailVerify: (t: string) => `auth:email-verify:${t}`,
    refresh: (t: string) => `auth:refresh:${t}`,
    pinReset: (t: string) => `auth:pin-reset:${t}`,
    pending2fa: (t: string) => `auth:pending-2fa:${t}`,
  } as const;

  // TTLs in seconds
  private ttl = {
    passwordReset: 15 * 60, // 15 min
    emailVerify: 24 * 60 * 60, // 24 h
    refresh: 7 * 24 * 60 * 60, // 7 d
    pinReset: 15 * 60, // 15 min
    pending2fa: 10 * 60, // 10 min
  } as const;

  private async redisSet(key: string, userId: string, ttlSeconds: number) {
    await this.redis.setex(key, ttlSeconds, userId);
  }

  private async redisGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  private async redisDel(key: string) {
    await this.redis.del(key);
  }

  // ── REGISTER ──────────────────────────────────────────────────────────────────
  async register(dto: RegisterDto, ipAddress?: string) {
    const existing = await this.userRepo.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Phone dedup — look up by phoneHash (HMAC) instead of plaintext phone
    if (dto.phone) {
      const phoneHash = this.encryptionService.hash(dto.phone);
      const phoneTaken = await this.userRepo.findOne({
        where: { phoneHash },
        withDeleted: true,
      });
      if (phoneTaken) {
        throw new ConflictException(
          'An account with this phone number already exists',
        );
      }
    }

    let referredBy: User | null = null;
    if (dto.referralCode) {
      referredBy = await this.userRepo.findOne({
        where: { referralCode: dto.referralCode },
      });
      if (!referredBy) throw new BadRequestException('Invalid referral code');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const referralCode = await this.generateUniqueReferralCode();

    // Encrypt sensitive fields before persisting
    const encryptedFields = this.encHelper.prepareUser({
      phone: dto.phone ?? null,
    });

    const user = this.userRepo.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      ...encryptedFields, // phone (encrypted) + phoneHash (HMAC)
      isPhoneVerified: false,
      referralCode,
      referredById: referredBy?.id ?? null,
      role: UserRole.USER,
      kycStatus: KycStatus.PENDING,
      twoFaEnabled: true,
      twoFaMethod: TwoFaMethod.EMAIL,
    });

    await this.userRepo.save(user);

    const verifyToken = await this.createEmailVerifyToken(user.id);
    const verifyLink = `${this.config.get('APP_URL')}/auth/verify-email?token=${verifyToken}`;

    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.IN_APP,
        title: 'Verify your CryptoPay NG account',
        body: 'Verify your email to unlock full access.',
        data: { verifyToken },
      }),
    );

    // Decrypt phone for WhatsApp OTP (needs plaintext)
    const plainPhone = dto.phone ?? null;

    const parallelTasks: Promise<any>[] = [
      this.emailService.sendWelcome(user.email, {
        firstName: user.firstName,
        email: user.email,
      }),
      this.emailService.sendEmailVerification(user.email, {
        firstName: user.firstName,
        otp: verifyLink,
      }),
    ];

    if (plainPhone) {
      parallelTasks.push(
        this.whatsappOtp.sendOtp(plainPhone, user.firstName, false),
      );
    }

    await Promise.allSettled(parallelTasks);

    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.registered',
      'users',
      user.id,
      null,
      { email: user.email },
      ipAddress,
    );

    const tokens = await this.generateTokens(user);
    return {
      message: plainPhone
        ? 'Registration successful. Please verify your email and phone number.'
        : 'Registration successful. Please verify your email.',
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  // ── SEND PHONE VERIFICATION OTP ───────────────────────────────────────────────
  async sendPhoneVerificationOtp(
    userId: string,
    dto: SendPhoneOtpDto,
    ipAddress?: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'firstName', 'phone', 'isPhoneVerified'],
    });
    if (!user) throw new NotFoundException('User not found');

    // Decrypt stored phone before use
    const decryptedUser = this.encHelper.decryptUser(user);
    const phone = decryptedUser.phone ?? dto.phone;

    if (!phone) {
      throw new BadRequestException(
        'No phone number on file. Provide one in the request body.',
      );
    }

    if (user.isPhoneVerified) {
      throw new BadRequestException('Phone number is already verified');
    }

    if (!decryptedUser.phone || decryptedUser.phone !== phone) {
      // Check new phone not already taken — dedup via phoneHash
      const phoneHash = this.encryptionService.hash(phone);
      const phoneTaken = await this.userRepo.findOne({
        where: { phoneHash },
        withDeleted: true,
      });
      if (phoneTaken && phoneTaken.id !== userId) {
        throw new ConflictException(
          'An account with this phone number already exists',
        );
      }

      // Persist encrypted phone + updated phoneHash
      const encryptedFields = this.encHelper.prepareUser({ phone });
      await this.userRepo.update(userId, encryptedFields);
    }

    await this.whatsappOtp.sendOtp(phone, user.firstName);

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.phone_otp_sent',
      'users',
      userId,
      null,
      { phone },
      ipAddress,
    );

    return { message: 'OTP sent to your WhatsApp number' };
  }

  // ── VERIFY PHONE OTP ──────────────────────────────────────────────────────────
  async verifyPhoneOtp(
    userId: string,
    dto: VerifyPhoneOtpDto,
    ipAddress?: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'phone', 'isPhoneVerified'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.isPhoneVerified) {
      return { message: 'Phone number is already verified' };
    }
    if (!user.phone) {
      throw new BadRequestException(
        'No phone number on file. Call send-otp first.',
      );
    }

    // Decrypt phone to pass plaintext to OTP service
    const plainPhone = this.encryptionService.decryptNullable(user.phone)!;

    const result = await this.whatsappOtp.verifyOtp(plainPhone, dto.otp);
    if (!result.valid) {
      throw new BadRequestException(result.reason ?? 'Invalid OTP');
    }

    await this.userRepo.update(userId, { isPhoneVerified: true });

    await this.notifRepo.save(
      this.notifRepo.create({
        userId,
        type: NotificationType.PHONE_VERIFICATION,
        channel: NotificationChannel.IN_APP,
        title: 'Phone number verified',
        body: 'Your WhatsApp number has been verified successfully.',
        data: {},
      }),
    );

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.phone_verified',
      'users',
      userId,
      null,
      { phone: plainPhone },
      ipAddress,
    );

    return { message: 'Phone number verified successfully' };
  }

  // ── LOGIN ─────────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ipAddress?: string) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      select: [
        'id',
        'email',
        'passwordHash',
        'role',
        'isActive',
        'isEmailVerified',
        'twoFaEnabled',
        'twoFaMethod',
        'twoFaSecret',
        'firstName',
        'lastName',
        'kycStatus',
        'referralCode',
        'isPinSet',
      ],
    });

    if (!user) throw new UnauthorizedException('Invalid email or password');

    if (!user.isActive) {
      throw new ForbiddenException(
        'Your account has been deactivated. Contact support.',
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid)
      throw new UnauthorizedException('Invalid email or password');

    if (user.twoFaEnabled) {
      if (!dto.otpCode) {
        if (user.twoFaMethod === TwoFaMethod.EMAIL) {
          await this.sendEmailOtp(user, ipAddress);
        }

        const tempToken = crypto.randomBytes(32).toString('hex');
        await this.redisSet(
          this.rk.pending2fa(tempToken),
          user.id,
          this.ttl.pending2fa,
        );

        return {
          requiresOtp: true,
          twoFaMethod: user.twoFaMethod,
          tempToken,
          message:
            user.twoFaMethod === TwoFaMethod.EMAIL
              ? 'OTP sent to your email. Enter the code to complete login.'
              : 'Enter the 6-digit code from your authenticator app to complete login.',
        };
      }

      await this.validateOtpCode(user, dto.otpCode);
    }

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.login',
      'users',
      user.id,
      null,
      null,
      ipAddress,
    );

    const tokens = await this.generateTokens(user);
    return {
      message: 'Login successful',
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  // ── LOGIN STEP 2: VERIFY OTP ──────────────────────────────────────────────────
  async verifyLoginOtp(
    tempToken: string,
    dto: VerifyEmailOtpDto,
    ipAddress?: string,
  ) {
    const pendingUserId = await this.redisGet(this.rk.pending2fa(tempToken));
    if (!pendingUserId) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const user = await this.userRepo.findOne({
      where: { id: pendingUserId },
      select: [
        'id',
        'email',
        'role',
        'isActive',
        'twoFaEnabled',
        'twoFaMethod',
        'twoFaSecret',
        'emailOtp',
        'emailOtpExpiresAt',
        'firstName',
        'lastName',
        'kycStatus',
        'referralCode',
        'isPinSet',
      ],
    });

    if (!user || !user.isActive)
      throw new UnauthorizedException('User not found');

    await this.validateOtpCode(user, dto.otp);
    await this.redisDel(this.rk.pending2fa(tempToken));

    await this.userRepo.update(user.id, { lastLoginAt: new Date() });
    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.login',
      'users',
      user.id,
      null,
      null,
      ipAddress,
    );

    const tokens = await this.generateTokens(user);
    return {
      message: 'Login successful',
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  // ── RESEND LOGIN OTP ──────────────────────────────────────────────────────────
  async resendLoginOtp(tempToken: string, ipAddress?: string) {
    const pendingUserId = await this.redisGet(this.rk.pending2fa(tempToken));
    if (!pendingUserId) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    const user = await this.userRepo.findOne({
      where: { id: pendingUserId },
      select: ['id', 'email', 'firstName', 'twoFaMethod'],
    });

    if (!user) throw new NotFoundException('User not found');

    if (user.twoFaMethod !== TwoFaMethod.EMAIL) {
      throw new BadRequestException(
        'OTP resend is only available for email 2FA. Open your authenticator app to get a code.',
      );
    }

    await this.sendEmailOtp(user, ipAddress);
    return { message: 'OTP resent to your email address' };
  }

  // ── REFRESH ───────────────────────────────────────────────────────────────────
  async refreshTokens(dto: RefreshTokenDto) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(dto.refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const storedUserId = await this.redis.get(
      `auth:refresh:${dto.refreshToken}`,
    );
    if (!storedUserId || storedUserId !== payload.sub) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive)
      throw new UnauthorizedException('User not found');

    await this.redis.del(`auth:refresh:${dto.refreshToken}`);
    return this.generateTokens(user);
  }

  // ── LOGOUT ────────────────────────────────────────────────────────────────────
  async logout(refreshToken: string, userId: string) {
    await this.redisDel(this.rk.refresh(refreshToken));
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.logout',
      'users',
      userId,
    );
    return { message: 'Logged out successfully' };
  }

  // ── VERIFY EMAIL ──────────────────────────────────────────────────────────────
  async verifyEmail(token: string) {
    const userId = await this.redisGet(this.rk.emailVerify(token));
    if (!userId) {
      throw new BadRequestException(
        'Verification link is invalid or has expired',
      );
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) return { message: 'Email already verified' };

    await this.userRepo.update(user.id, { isEmailVerified: true });
    await this.redisDel(this.rk.emailVerify(token));
    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.email_verified',
      'users',
      user.id,
    );

    return { message: 'Email verified successfully' };
  }

  // ── RESEND VERIFICATION ───────────────────────────────────────────────────────
  async resendVerification(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || user.isEmailVerified) {
      return {
        message:
          'If your email exists and is unverified, a link has been sent.',
      };
    }

    const token = await this.createEmailVerifyToken(user.id);
    const verifyLink = `${this.config.get('APP_URL')}/auth/verify-email?token=${token}`;

    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.IN_APP,
        title: 'Verify your CryptoPay NG account',
        body: 'Verify your email to unlock full access.',
        data: { token },
      }),
    );

    await this.emailService.sendEmailVerification(user.email, {
      firstName: user.firstName,
      otp: verifyLink,
    });

    return {
      message: 'If your email exists and is unverified, a link has been sent.',
    };
  }

  // ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user)
      return { message: 'If that email exists, a reset link has been sent.' };

    const token = crypto.randomBytes(32).toString('hex');
    const resetLink = `${this.config.get('APP_URL')}/auth/reset-password?token=${token}`;

    await this.redisSet(
      this.rk.passwordReset(token),
      user.id,
      this.ttl.passwordReset,
    );

    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.IN_APP,
        title: 'Reset your CryptoPay NG password',
        body: 'A password reset was requested for your account.',
        data: { token },
      }),
    );

    await this.emailService.sendPasswordReset(user.email, {
      firstName: user.firstName,
      resetLink,
    });

    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.forgot_password',
      'users',
      user.id,
    );
    return { message: 'If that email exists, a reset link has been sent.' };
  }

  // ── RESET PASSWORD ────────────────────────────────────────────────────────────
  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.redisGet(this.rk.passwordReset(dto.token));
    if (!userId) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.userRepo.update(user.id, { passwordHash });
    await this.redisDel(this.rk.passwordReset(dto.token));

    await this.revokeAllRefreshTokens(user.id);

    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.password_reset',
      'users',
      user.id,
    );
    return { message: 'Password reset successful. Please log in.' };
  }

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'auth:refresh:*',
        'COUNT',
        100,
      );
      cursor = next;

      if (keys.length === 0) continue;

      const values = await this.redis.mget(...keys);
      const toDelete = keys.filter((_, i) => values[i] === userId);
      if (toDelete.length) await this.redis.del(...toDelete);
    } while (cursor !== '0');
  }

  // ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'passwordHash'],
    });
    if (!user) throw new NotFoundException('User not found');

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.userRepo.update(userId, { passwordHash });
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.password_changed',
      'users',
      userId,
    );
    return { message: 'Password changed successfully' };
  }

  // ── 2FA: SWITCH TO AUTHENTICATOR APP ─────────────────────────────────────────
  async setup2FAAuthenticator(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'email', 'twoFaMethod'],
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.twoFaMethod === TwoFaMethod.AUTHENTICATOR) {
      throw new BadRequestException(
        'You are already using an authenticator app',
      );
    }

    const secret = speakeasy.generateSecret({
      name: `CryptoPay NG (${user.email})`,
      length: 20,
    });

    // Encrypt twoFaSecret before storing
    const encryptedFields = this.encHelper.prepareUser({
      twoFaSecret: secret.base32,
    });
    await this.userRepo.update(userId, encryptedFields);

    const qrCode = await qrcode.toDataURL(secret.otpauth_url!);

    return {
      secret: secret.base32,
      qrCode,
      message:
        'Scan the QR code in your authenticator app, then confirm with POST /auth/2fa/authenticator/confirm',
    };
  }

  async confirm2FAAuthenticator(userId: string, dto: SwitchToAuthenticatorDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'twoFaSecret', 'twoFaMethod'],
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.twoFaMethod === TwoFaMethod.AUTHENTICATOR) {
      throw new BadRequestException(
        'You are already using an authenticator app',
      );
    }

    if (!user.twoFaSecret) {
      throw new BadRequestException(
        'Run GET /auth/2fa/authenticator/setup first',
      );
    }

    // Decrypt before passing to speakeasy
    const plainSecret = this.encryptionService.decrypt(user.twoFaSecret);

    const valid = speakeasy.totp.verify({
      secret: plainSecret,
      encoding: 'base32',
      token: dto.code,
      window: 1,
    });
    if (!valid)
      throw new BadRequestException('Invalid authenticator code. Try again.');

    await this.userRepo.update(userId, {
      twoFaMethod: TwoFaMethod.AUTHENTICATOR,
      twoFaEnabled: true,
      emailOtp: null,
      emailOtpExpiresAt: null,
    });

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.2fa_switched_to_authenticator',
      'users',
      userId,
    );
    return { message: 'Authenticator app 2FA enabled successfully' };
  }

  // ── 2FA: SWITCH BACK TO EMAIL ─────────────────────────────────────────────────
  async switchToEmail2FA(userId: string, dto: SwitchToEmailDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'twoFaSecret', 'twoFaMethod'],
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.twoFaMethod === TwoFaMethod.EMAIL) {
      throw new BadRequestException('You are already using email 2FA');
    }

    // Decrypt before passing to speakeasy
    const plainSecret = this.encryptionService.decrypt(user.twoFaSecret!);

    const valid = speakeasy.totp.verify({
      secret: plainSecret,
      encoding: 'base32',
      token: dto.code,
      window: 1,
    });
    if (!valid) throw new BadRequestException('Invalid authenticator code');

    // Wipe the encrypted secret and revert method to EMAIL
    await this.userRepo.update(userId, {
      twoFaMethod: TwoFaMethod.EMAIL,
      twoFaSecret: null,
    });

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.2fa_switched_to_email',
      'users',
      userId,
    );
    return { message: 'Switched back to email 2FA successfully' };
  }

  // ── PIN: SET ──────────────────────────────────────────────────────────────────
  async setPin(userId: string, dto: SetPinDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'isPinSet'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.isPinSet) {
      throw new BadRequestException(
        'PIN already set. Use change-pin to update it.',
      );
    }

    const pinHash = await argon2.hash(dto.pin, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.userRepo.update(userId, { pinHash, isPinSet: true });
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.pin_set',
      'users',
      userId,
    );
    return { message: 'PIN set successfully' };
  }

  // ── PIN: VERIFY ───────────────────────────────────────────────────────────────
  async verifyPin(userId: string, dto: VerifyPinDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'pinHash', 'isPinSet'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isPinSet || !user.pinHash) {
      throw new BadRequestException('No PIN has been set for this account');
    }

    const valid = await argon2.verify(user.pinHash, dto.pin);
    if (!valid) throw new UnauthorizedException('Incorrect PIN');

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.pin_verified',
      'users',
      userId,
    );
    return { message: 'PIN verified successfully', verified: true };
  }

  // ── PIN: CHANGE ───────────────────────────────────────────────────────────────
  async changePin(userId: string, dto: ChangePinDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'pinHash', 'isPinSet'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isPinSet || !user.pinHash) {
      throw new BadRequestException('No PIN set. Use set-pin first.');
    }

    const valid = await argon2.verify(user.pinHash, dto.currentPin);
    if (!valid) throw new BadRequestException('Current PIN is incorrect');

    if (dto.currentPin === dto.newPin) {
      throw new BadRequestException(
        'New PIN must be different from current PIN',
      );
    }

    const pinHash = await argon2.hash(dto.newPin, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.userRepo.update(userId, { pinHash });
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.pin_changed',
      'users',
      userId,
    );
    return { message: 'PIN changed successfully' };
  }

  // ── PIN: FORGOT ───────────────────────────────────────────────────────────────
  async forgotPin(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'email', 'firstName', 'isPinSet'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isPinSet) {
      throw new BadRequestException('No PIN has been set for this account');
    }

    const token = crypto.randomBytes(32).toString('hex');

    await this.redisSet(this.rk.pinReset(token), user.id, this.ttl.pinReset);

    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.IN_APP,
        title: 'Reset your CryptoPay NG transaction PIN',
        body: 'A PIN reset was requested for your account.',
        data: { token },
      }),
    );

    await this.emailService.sendPinReset(user.email, {
      firstName: user.firstName,
      otp: token,
    });

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.pin_forgot',
      'users',
      userId,
    );
    return { message: 'A PIN reset link has been sent to your email.' };
  }

  // ── PIN: RESET ────────────────────────────────────────────────────────────────
  async resetPin(dto: ResetPinDto) {
    const userId = await this.redisGet(this.rk.pinReset(dto.token));
    if (!userId) {
      throw new BadRequestException('PIN reset link is invalid or has expired');
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const pinHash = await argon2.hash(dto.pin, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.userRepo.update(user.id, { pinHash, isPinSet: true });
    await this.redisDel(this.rk.pinReset(dto.token));

    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.pin_reset',
      'users',
      user.id,
    );
    return { message: 'PIN reset successfully' };
  }

  // ── PIN: REMOVE ───────────────────────────────────────────────────────────────
  async removePin(userId: string, dto: VerifyPinDto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'pinHash', 'isPinSet'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isPinSet || !user.pinHash) {
      throw new BadRequestException('No PIN has been set for this account');
    }

    const valid = await argon2.verify(user.pinHash, dto.pin);
    if (!valid) throw new BadRequestException('Incorrect PIN');

    await this.userRepo.update(userId, { pinHash: null, isPinSet: false });
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.pin_removed',
      'users',
      userId,
    );
    return { message: 'PIN removed successfully' };
  }

  // ── PRIVATE: SEND EMAIL OTP ───────────────────────────────────────────────────
  private async sendEmailOtp(user: User, ipAddress?: string) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.userRepo.update(user.id, {
      emailOtp: otp,
      emailOtpExpiresAt: expiresAt,
    });

    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.IN_APP,
        title: 'Your CryptoPay NG login code',
        body: `Your login OTP is: ${otp}. Expires in 10 minutes.`,
        data: { otp },
      }),
    );

    await this.emailService.sendTwoFAOtp(user.email, {
      firstName: user.firstName,
      otp,
      ipAddress,
    });
  }

  // ── PRIVATE: VALIDATE OTP ─────────────────────────────────────────────────────
  private async validateOtpCode(user: User, code: string) {
    if (user.twoFaMethod === TwoFaMethod.EMAIL) {
      const freshUser = await this.userRepo.findOne({
        where: { id: user.id },
        select: ['id', 'emailOtp', 'emailOtpExpiresAt'],
      });

      if (!freshUser?.emailOtp || !freshUser?.emailOtpExpiresAt) {
        throw new UnauthorizedException(
          'No OTP found. Please request a new one.',
        );
      }

      if (freshUser.emailOtpExpiresAt < new Date()) {
        throw new UnauthorizedException(
          'OTP has expired. Please request a new one.',
        );
      }

      if (freshUser.emailOtp !== code) {
        throw new UnauthorizedException('Invalid OTP code');
      }

      await this.userRepo.update(user.id, {
        emailOtp: null,
        emailOtpExpiresAt: null,
      });
    } else {
      // AUTHENTICATOR — decrypt secret before verifying TOTP
      const freshUser = await this.userRepo.findOne({
        where: { id: user.id },
        select: ['id', 'twoFaSecret'],
      });

      if (!freshUser?.twoFaSecret) {
        throw new UnauthorizedException(
          'Authenticator not configured. Please set up your authenticator app or switch to email 2FA.',
        );
      }

      // Decrypt the stored secret before passing to speakeasy
      const plainSecret = this.encryptionService.decrypt(freshUser.twoFaSecret);

      const valid = speakeasy.totp.verify({
        secret: plainSecret,
        encoding: 'base32',
        token: code,
        window: 1,
      });

      if (!valid)
        throw new UnauthorizedException(
          'Invalid authenticator code. Check the code on your device and try again.',
        );
    }
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────
  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const jwtSecret = this.config.get<string>('JWT_SECRET') as string;
    const jwtRefreshSecret = this.config.get<string>(
      'JWT_REFRESH_SECRET',
    ) as string;
    const jwtExpiresIn = (this.config.get<string>('JWT_EXPIRES_IN') ??
      '15m') as `${number}${'s' | 'm' | 'h' | 'd'}`;
    const jwtRefreshExpires = (this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) ?? '7d') as `${number}${'s' | 'm' | 'h' | 'd'}`;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: jwtSecret,
        expiresIn: jwtExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: jwtRefreshSecret,
        expiresIn: jwtRefreshExpires,
      }),
    ]);

    await this.redis.setex(
      `auth:refresh:${refreshToken}`,
      7 * 24 * 60 * 60,
      user.id,
    );

    return { accessToken, refreshToken };
  }

  private async generateUniqueReferralCode(): Promise<string> {
    let code: string;
    let exists: User | null;
    do {
      code = nanoid(8).toUpperCase();
      exists = await this.userRepo.findOne({ where: { referralCode: code } });
    } while (exists);
    return code;
  }

  private async createEmailVerifyToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.redisSet(
      this.rk.emailVerify(token),
      userId,
      this.ttl.emailVerify,
    );
    return token;
  }

  private sanitizeUser(user: User) {
    const { passwordHash, twoFaSecret, pinHash, emailOtp, ...safe } =
      user as any;
    return safe;
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
