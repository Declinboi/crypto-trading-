import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsPhoneNumber,
  Matches,
  IsNotEmpty,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(64, { message: 'Password must not exceed 64 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain uppercase, lowercase, number and special character',
  })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => value?.trim())
  businessName?: string;

  @IsOptional()
  @IsPhoneNumber('NG', {
    message: 'Please provide a valid Nigerian phone number',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(6)
  otpCode?: string; // works for both email OTP and authenticator TOTP
}

export class VerifyEmailOtpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 numeric digits' })
  otp: string;
}

export class SwitchToAuthenticatorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  @Matches(/^\d{6}$/, { message: 'Code must be 6 numeric digits' })
  code: string; // TOTP code to confirm before switching
}

export class SwitchToEmailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  @Matches(/^\d{6}$/, { message: 'Code must be 6 numeric digits' })
  code: string; // current authenticator TOTP to confirm before switching back
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class ResendVerificationDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Reset token is required' })
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain uppercase, lowercase, number and special character',
  })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain uppercase, lowercase, number and special character',
  })
  newPassword: string;
}

export class Enable2FADto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  code: string;
}

// ── PIN DTOs ──────────────────────────────────────────────────────────────────
export class SetPinDto {
  @IsString()
  @MinLength(4, { message: 'PIN must be exactly 4 digits' })
  @MaxLength(4, { message: 'PIN must be exactly 4 digits' })
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 numeric digits only' })
  pin: string;
}

export class VerifyPinDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 numeric digits only' })
  pin: string;
}

export class ChangePinDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'Current PIN must be 4 numeric digits' })
  currentPin: string;

  @IsString()
  @MinLength(4)
  @MaxLength(4)
  @Matches(/^\d{4}$/, { message: 'New PIN must be 4 numeric digits only' })
  newPin: string;
}

export class ResetPinDto {
  @IsString()
  @IsNotEmpty({ message: 'Reset token is required' })
  token: string;

  @IsString()
  @MinLength(4)
  @MaxLength(4)
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 numeric digits only' })
  pin: string;
}

export class SendPhoneOtpDto {
     @IsOptional()
     @IsString()
     @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
     phone?: string;
   }

   export class VerifyPhoneOtpDto {
     @IsString()
     @Length(6, 6)
     otp: string;
   }