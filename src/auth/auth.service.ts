import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
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

import { User } from '../entities/user.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';
import {
  UserRole,
  KycStatus,
  AuditActorType,
  NotificationType,
  NotificationChannel,
} from '../entities/enums';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  Enable2FADto,
} from './dto/auth.dto';
import { JwtPayload } from './strategies/jwt.strategy';

// NOTE: Replace these Maps with Redis before going to production
const passwordResetTokens = new Map<
  string,
  { userId: string; expiresAt: Date }
>();
const emailVerifyTokens = new Map<
  string,
  { userId: string; expiresAt: Date }
>();
const refreshTokenStore = new Map<
  string,
  { userId: string; expiresAt: Date }
>();

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    @InjectRepository(Notification)
    private notifRepo: Repository<Notification>,

    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  // ── REGISTER ────────────────────────────────────────────────────────────────
  async register(dto: RegisterDto, ipAddress?: string) {
    const existing = await this.userRepo.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    let referredBy: User | null = null;
    if (dto.referralCode) {
      referredBy = await this.userRepo.findOne({
        where: { referralCode: dto.referralCode },
      });
      if (!referredBy) {
        throw new BadRequestException('Invalid referral code');
      }
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const referralCode = await this.generateUniqueReferralCode();

    const user = this.userRepo.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      businessName: dto.businessName ?? null,
      phone: dto.phone ?? null,
      referralCode,
      referredById: referredBy?.id ?? null,
      role: UserRole.USER,
      kycStatus: KycStatus.PENDING,
    });

    await this.userRepo.save(user);

    const verifyToken = await this.createEmailVerifyToken(user.id);

    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.EMAIL,
        title: 'Verify your CryptoPay NG account',
        body: `Verify your email: ${this.config.get('APP_URL')}/auth/verify-email?token=${verifyToken}`,
        data: { verifyToken },
      }),
    );

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
      message: 'Registration successful. Please verify your email.',
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  // ── LOGIN ────────────────────────────────────────────────────────────────────
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
        'twoFaSecret',
        'firstName',
        'lastName',
        'kycStatus',
        'referralCode',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new ForbiddenException(
        'Your account has been deactivated. Contact support.',
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.twoFaEnabled) {
      if (!dto.twoFaCode) {
        return { requiresTwoFa: true, message: 'Please provide your 2FA code' };
      }
      const valid = speakeasy.totp.verify({
        secret: user.twoFaSecret!,
        encoding: 'base32',
        token: dto.twoFaCode,
        window: 1,
      });
      if (!valid) throw new UnauthorizedException('Invalid 2FA code');
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

  // ── REFRESH ──────────────────────────────────────────────────────────────────
  async refreshTokens(dto: RefreshTokenDto) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(dto.refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const stored = refreshTokenStore.get(dto.refreshToken);
    if (
      !stored ||
      stored.userId !== payload.sub ||
      stored.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive)
      throw new UnauthorizedException('User not found');

    refreshTokenStore.delete(dto.refreshToken);
    return this.generateTokens(user);
  }

  // ── LOGOUT ───────────────────────────────────────────────────────────────────
  async logout(refreshToken: string, userId: string) {
    refreshTokenStore.delete(refreshToken);
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.logout',
      'users',
      userId,
    );
    return { message: 'Logged out successfully' };
  }

  // ── VERIFY EMAIL ─────────────────────────────────────────────────────────────
  async verifyEmail(token: string) {
    const record = emailVerifyTokens.get(token);
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException(
        'Verification link is invalid or has expired',
      );
    }

    const user = await this.userRepo.findOne({ where: { id: record.userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) return { message: 'Email already verified' };

    await this.userRepo.update(user.id, { isEmailVerified: true });
    emailVerifyTokens.delete(token);
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
    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.EMAIL,
        title: 'Verify your CryptoPay NG account',
        body: `Verify your email: ${this.config.get('APP_URL')}/auth/verify-email?token=${token}`,
        data: { token },
      }),
    );

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
    passwordResetTokens.set(token, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
    });

    await this.notifRepo.save(
      this.notifRepo.create({
        userId: user.id,
        type: NotificationType.PAYMENT_WAITING,
        channel: NotificationChannel.EMAIL,
        title: 'Reset your CryptoPay NG password',
        body: `Reset link: ${this.config.get('APP_URL')}/auth/reset-password?token=${token}. Expires in 15 minutes.`,
        data: { token },
      }),
    );

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
    const record = passwordResetTokens.get(dto.token);
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const user = await this.userRepo.findOne({ where: { id: record.userId } });
    if (!user) throw new NotFoundException('User not found');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await this.userRepo.update(user.id, { passwordHash });
    passwordResetTokens.delete(dto.token);

    // Revoke all refresh tokens for security
    for (const [key, val] of refreshTokenStore.entries()) {
      if (val.userId === user.id) refreshTokenStore.delete(key);
    }

    await this.saveAudit(
      user.id,
      AuditActorType.USER,
      'user.password_reset',
      'users',
      user.id,
    );

    return { message: 'Password reset successful. Please log in.' };
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

  // ── 2FA GENERATE ─────────────────────────────────────────────────────────────
  async generate2FASecret(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.twoFaEnabled)
      throw new BadRequestException('2FA is already enabled');

    const secret = speakeasy.generateSecret({
      name: `CryptoPay NG (${user.email})`,
      length: 20,
    });

    await this.userRepo.update(userId, { twoFaSecret: secret.base32 });
    const qrCode = await qrcode.toDataURL(secret.otpauth_url!);

    return {
      secret: secret.base32,
      qrCode,
      message:
        'Scan the QR code with your authenticator app then confirm with your code',
    };
  }

  // ── 2FA ENABLE ───────────────────────────────────────────────────────────────
  async enable2FA(userId: string, dto: Enable2FADto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'twoFaSecret', 'twoFaEnabled', 'email'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.twoFaEnabled)
      throw new BadRequestException('2FA is already enabled');
    if (!user.twoFaSecret) {
      throw new BadRequestException(
        'Generate a 2FA secret first via GET /auth/2fa/generate',
      );
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFaSecret,
      encoding: 'base32',
      token: dto.code,
      window: 1,
    });
    if (!valid) throw new BadRequestException('Invalid 2FA code');

    await this.userRepo.update(userId, { twoFaEnabled: true });
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.2fa_enabled',
      'users',
      userId,
    );

    return { message: '2FA enabled successfully' };
  }

  // ── 2FA DISABLE ──────────────────────────────────────────────────────────────
  async disable2FA(userId: string, dto: Enable2FADto) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'twoFaSecret', 'twoFaEnabled'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.twoFaEnabled) throw new BadRequestException('2FA is not enabled');

    const valid = speakeasy.totp.verify({
      secret: user.twoFaSecret!,
      encoding: 'base32',
      token: dto.code,
      window: 1,
    });
    if (!valid) throw new BadRequestException('Invalid 2FA code');

    await this.userRepo.update(userId, {
      twoFaEnabled: false,
      twoFaSecret: null,
    });
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'user.2fa_disabled',
      'users',
      userId,
    );

    return { message: '2FA disabled successfully' };
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

    refreshTokenStore.set(refreshToken, {
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

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
    emailVerifyTokens.set(token, {
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });
    return token;
  }

  private sanitizeUser(user: User) {
    const { passwordHash, twoFaSecret, ...safe } = user as any;
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
