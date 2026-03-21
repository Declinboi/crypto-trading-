import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  MaxLength,
  Min,
  IsEnum,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import {
  SystemWalletStatus,
  SystemWalletTransactionType,
} from '../../entities/enums';

export class CreateSystemWalletDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  label: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minBalanceAlertNgn?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateSystemWalletDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  label?: string;

  @IsOptional()
  @IsEnum(SystemWalletStatus)
  status?: SystemWalletStatus;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minBalanceAlertNgn?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class TopUpSystemWalletDto {
  @IsNumber()
  @IsPositive({ message: 'Top-up amount must be greater than 0' })
  @Min(100, { message: 'Minimum top-up amount is ₦100' })
  @Type(() => Number)
  amountNgn: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description: string;
  // e.g. "Flutterwave balance top-up", "Bank transfer deposit"

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
  // External bank transfer reference or receipt number
}

export class WithdrawSystemWalletDto {
  @IsNumber()
  @IsPositive({ message: 'Withdrawal amount must be greater than 0' })
  @Min(100, { message: 'Minimum withdrawal amount is ₦100' })
  @Type(() => Number)
  amountNgn: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description: string;
  // e.g. "Profit withdrawal to GTBank 0123456789", "Monthly profit transfer"

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
  // External transfer reference for reconciliation

  @IsOptional()
  @IsString()
  @MaxLength(100)
  destinationBank?: string;
  // For audit trail — where is this money going

  @IsOptional()
  @IsString()
  @MaxLength(20)
  destinationAccount?: string;
  // For audit trail

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  forceWithdraw?: boolean;
  // Override minimum reserve safety check
}

export class RecordTransactionDto {
  @IsEnum(SystemWalletTransactionType)
  type: SystemWalletTransactionType;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amountNgn: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsUUID()
  relatedPayoutId?: string | null;

  @IsOptional()
  @IsUUID()
  relatedTransactionId?: string | null;
}

export class WalletQueryDto {
  @IsOptional()
  @IsEnum(SystemWalletStatus)
  status?: SystemWalletStatus;

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

export class TransactionQueryDto {
  @IsOptional()
  @IsEnum(SystemWalletTransactionType)
  type?: SystemWalletTransactionType;

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
