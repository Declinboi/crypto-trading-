import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsPositive,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  CoinType,
  NetworkType,
  SystemWalletStatus,
  SystemWalletTransactionType,
} from '../../entities';

export class CreateSystemWalletDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  label: string;

  @IsOptional()
  @IsEnum(CoinType)
  coin?: CoinType;

  @IsOptional()
  @IsEnum(NetworkType)
  network?: NetworkType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsBoolean()
  isHotWallet?: boolean;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  minBalanceAlertUsd?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nowpaymentsWalletId?: string;

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
  @IsPositive()
  minBalanceAlertUsd?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nowpaymentsWalletId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RecordTransactionDto {
  @IsEnum(SystemWalletTransactionType)
  type: SystemWalletTransactionType;

  @IsOptional()
  @IsEnum(CoinType)
  coin?: CoinType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amountCrypto?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amountUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amountNgn?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  txHash?: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  payoutId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  usdRateSnapshot?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class SyncBalanceDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  balanceCrypto?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  balanceUsdEquiv?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  balanceNgnReserve?: number;
}

export class WalletQueryDto {
  @IsOptional()
  @IsEnum(CoinType)
  coin?: CoinType;

  @IsOptional()
  @IsEnum(SystemWalletStatus)
  status?: SystemWalletStatus;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  isHotWallet?: boolean;

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
