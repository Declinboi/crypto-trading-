import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Patch,
  Delete,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, Public } from './decorators/index';
import { User } from '../entities/user.entity';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  VerifyEmailDto,
  ResendVerificationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  VerifyPinDto,
  ResetPinDto,
  SetPinDto,
  ChangePinDto,
  VerifyEmailOtpDto,
  SwitchToAuthenticatorDto,
  SwitchToEmailDto,
} from './dto/auth.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshTokenDto, @CurrentUser() user: User) {
    return this.authService.logout(dto.refreshToken, user.id);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: User) {
    return this.authService.changePassword(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@CurrentUser() user: User) {
    const { passwordHash, twoFaSecret, ...safe } = user as any;
    return { user: safe };
  }

  // ── POST /api/v1/auth/login/verify-otp ───────────────────────────────────────
  @Public()
  @Post('login/verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyLoginOtp(
    @Body('tempToken') tempToken: string,
    @Body() dto: VerifyEmailOtpDto,
    @Req() req: Request,
  ) {
    return this.authService.verifyLoginOtp(tempToken, dto, req.ip);
  }

  // ── POST /api/v1/auth/login/resend-otp ───────────────────────────────────────
  @Public()
  @Post('login/resend-otp')
  @HttpCode(HttpStatus.OK)
  resendLoginOtp(@Body('tempToken') tempToken: string) {
    return this.authService.resendLoginOtp(tempToken);
  }

  // ── GET /api/v1/auth/2fa/authenticator/setup ─────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('2fa/authenticator/setup')
  setup2FAAuthenticator(@CurrentUser() user: User) {
    return this.authService.setup2FAAuthenticator(user.id);
  }

  // ── POST /api/v1/auth/2fa/authenticator/confirm ──────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('2fa/authenticator/confirm')
  @HttpCode(HttpStatus.OK)
  confirm2FAAuthenticator(
    @Body() dto: SwitchToAuthenticatorDto,
    @CurrentUser() user: User,
  ) {
    return this.authService.confirm2FAAuthenticator(user.id, dto);
  }

  // ── POST /api/v1/auth/2fa/switch-to-email ────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('2fa/switch-to-email')
  @HttpCode(HttpStatus.OK)
  switchToEmail2FA(@Body() dto: SwitchToEmailDto, @CurrentUser() user: User) {
    return this.authService.switchToEmail2FA(user.id, dto);
  }

  // ── POST /api/v1/auth/pin/set ─────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('pin/set')
  @HttpCode(HttpStatus.CREATED)
  setPin(@Body() dto: SetPinDto, @CurrentUser() user: User) {
    return this.authService.setPin(user.id, dto);
  }

  // ── POST /api/v1/auth/pin/verify ──────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('pin/verify')
  @HttpCode(HttpStatus.OK)
  verifyPin(@Body() dto: VerifyPinDto, @CurrentUser() user: User) {
    return this.authService.verifyPin(user.id, dto);
  }

  // ── PATCH /api/v1/auth/pin/change ─────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Patch('pin/change')
  @HttpCode(HttpStatus.OK)
  changePin(@Body() dto: ChangePinDto, @CurrentUser() user: User) {
    return this.authService.changePin(user.id, dto);
  }

  // ── POST /api/v1/auth/pin/forgot ──────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('pin/forgot')
  @HttpCode(HttpStatus.OK)
  forgotPin(@CurrentUser() user: User) {
    return this.authService.forgotPin(user.id);
  }

  // ── POST /api/v1/auth/pin/reset ───────────────────────────────────────────────
  @Public()
  @Post('pin/reset')
  @HttpCode(HttpStatus.OK)
  resetPin(@Body() dto: ResetPinDto) {
    return this.authService.resetPin(dto);
  }

  // ── DELETE /api/v1/auth/pin/remove ────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Delete('pin/remove')
  @HttpCode(HttpStatus.OK)
  removePin(@Body() dto: VerifyPinDto, @CurrentUser() user: User) {
    return this.authService.removePin(user.id, dto);
  }
}
