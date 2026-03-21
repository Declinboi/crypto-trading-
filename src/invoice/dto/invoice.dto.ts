import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsBoolean,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsNumber()
  @IsPositive()
  @Min(1, { message: 'Minimum invoice amount is $1' })
  @Type(() => Number)
  amountUsd: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // ── Auto-cashout settings ───────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  autoCashout?: boolean;

  @IsOptional()
  @IsUUID()
  autoCashoutBankAccountId?: string;
  // If autoCashout=true but no bankAccountId provided → use user's default bank
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  autoCashout?: boolean;

  @IsOptional()
  @IsUUID()
  autoCashoutBankAccountId?: string;
}

export class InvoiceQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

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