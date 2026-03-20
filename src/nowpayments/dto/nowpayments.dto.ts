import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsNumber,
  IsPositive,
  IsEmail,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CoinType } from '../../entities/enums';

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amountUsd: number;

  @IsEnum(CoinType)
  coin: CoinType;

  @IsOptional()
  @IsEmail()
  payerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class CreateInvoiceDto {
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amountUsd: number;

  @IsEnum(CoinType)
  coin: CoinType;

  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  orderDescription?: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;
}

export class NowpaymentsWebhookDto {
  @IsString()
  @IsNotEmpty()
  payment_id: string;

  @IsString()
  @IsNotEmpty()
  payment_status: string;

  @IsString()
  @IsNotEmpty()
  pay_address: string;

  @IsNumber()
  price_amount: number;

  @IsString()
  price_currency: string;

  @IsNumber()
  pay_amount: number;

  @IsNumber()
  actually_paid: number;

  @IsString()
  pay_currency: string;

  @IsOptional()
  @IsString()
  order_id?: string;

  @IsOptional()
  @IsString()
  order_description?: string;

  @IsOptional()
  @IsString()
  payin_hash?: string;

  @IsOptional()
  @IsNumber()
  payin_extra_id?: number;

  @IsOptional()
  @IsString()
  invoice_id?: string;

  @IsOptional()
  @IsNumber()
  outcome_amount?: number;

  @IsOptional()
  @IsString()
  outcome_currency?: string;

  created_at: string;
  updated_at: string;
}