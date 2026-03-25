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
  IsEmail,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum PayoutPriority {
  NORMAL = 'normal',
  EXPRESS = 'express',
}

export class InitiatePayoutDto {
  @IsUUID()
  @IsNotEmpty()
  bankAccountId: string;

  @IsNumber()
  @IsPositive()
  @Min(100)
  @Type(() => Number)
  amountNgn: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  narration?: string;

  @IsOptional()
  @IsEnum(PayoutPriority)
  priority?: PayoutPriority;
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

export class MonnifyWebhookDto {
  eventType: string;
  eventData: {
    transactionReference: string;
    paymentReference: string;
    amountPaid: number;
    totalPayable: number;
    settlementAmount: number;
    paidOn: string;
    paymentStatus: string;
    paymentDescription: string;
    currency: string;
    paymentMethod: string;
    product: {
      reference: string;
      type: string;
    };
    customer: {
      email: string;
      name: string;
    };
    accountDetails?: {
      accountName: string;
      accountNumber: string;
      bankCode: string;
      bankName: string;
    };
  };
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

export class RetryPayoutDto {
  @IsUUID()
  @IsNotEmpty()
  payoutId: string;
}