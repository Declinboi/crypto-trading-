import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsPositive,
  IsUUID,
  MaxLength,
  Min,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PayoutPriority {
  NORMAL = 'normal',
  INSTANT = 'instant',
}

export class InitiatePayoutDto {
  @IsUUID()
  @IsNotEmpty()
  transactionId: string ;

  @IsUUID()
  @IsNotEmpty()
  bankAccountId: string;

  @IsOptional()
  @IsEnum(PayoutPriority)
  priority?: PayoutPriority;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  narration?: string;
}

export class VerifyBankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  bankCode: string;
}

export class FlutterwaveWebhookDto {
  @IsString()
  @IsNotEmpty()
  event: string;

  data: {
    id: number;
    account_number: string;
    bank_name: string;
    bank_code: string;
    fullname: string;
    created_at: string;
    currency: string;
    debit_currency: string;
    amount: number;
    fee: number;
    status: string;
    reference: string;
    meta: any;
    narration: string;
    complete_message: string;
    requires_approval: number;
    is_approved: number;
    transfer_code: string;
  };
}

export class RetryPayoutDto {
  @IsUUID()
  @IsNotEmpty()
  payoutId: string;
}

export class PayoutQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

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