import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsUUID,
  MaxLength,
  Min,
  Matches,
  IsEnum,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum WalletTransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  PAYOUT = 'payout',
  REVERSAL = 'reversal',
}

export enum WalletStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
  SUSPENDED = 'suspended',
}

export class TransferToUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Transform(({ value }) => value?.trim().toUpperCase())
  recipientTag: string; // e.g. @JOHN1234

  @IsNumber()
  @IsPositive()
  @Min(100, { message: 'Minimum transfer amount is ₦100' })
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 numeric digits' })
  pin: string; // require PIN for transfers
}

export class WithdrawTobankDto {
  @IsNumber()
  @IsPositive()
  @Min(100, { message: 'Minimum withdrawal amount is ₦100' })
  @Type(() => Number)
  amount: number;

  @IsUUID()
  @IsNotEmpty()
  bankAccountId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  narration?: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 numeric digits' })
  pin: string;
}

export class FundWalletDto {
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsNotEmpty()
  description: string;
}

export class WalletTransactionQueryDto {
  @IsOptional()
  @IsEnum(WalletTransactionType)
  type?: WalletTransactionType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}

export class UpdateWalletTagDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'Tag can only contain letters, numbers and underscores',
  })
  @Transform(({ value }) => value?.trim().toUpperCase())
  tag: string;
}

export class AdminFreezeWalletDto {
  @IsEnum(WalletStatus)
  status: WalletStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}