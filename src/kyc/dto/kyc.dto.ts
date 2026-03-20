import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsUrl,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum DocumentType {
  NIN = 'nin',
  BVN = 'bvn',
  PASSPORT = 'passport',
  DRIVERS_LICENSE = 'drivers_license',
  VOTERS_CARD = 'voters_card',
}

export enum KycProvider {
  SUMSUB = 'sumsub',
  MANUAL = 'manual',
}

export class InitiateKycDto {
  @IsEnum(DocumentType, { message: 'Invalid document type' })
  documentType: DocumentType;
}

export class SubmitKycDto {
  @IsEnum(DocumentType, { message: 'Invalid document type' })
  documentType: DocumentType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => value?.trim())
  documentNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  documentFrontUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  documentBackUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  selfieUrl?: string;
}

export class ReviewKycDto {
  @IsEnum(['verified', 'rejected'])
  status: 'verified' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class SumsubWebhookDto {
  @IsString()
  @IsNotEmpty()
  applicantId: string;

  @IsString()
  @IsNotEmpty()
  inspectionId: string;

  @IsString()
  @IsNotEmpty()
  applicantType: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  levelName: string;

  @IsString()
  @IsNotEmpty()
  externalUserId: string;

  @IsString()
  @IsNotEmpty()
  type: string; // applicantReviewed | applicantPending | applicantCreated etc.

  @IsOptional()
  reviewResult?: {
    reviewAnswer: 'GREEN' | 'RED';
    rejectLabels?: string[];
    reviewRejectType?: string;
    moderationComment?: string;
    clientComment?: string;
  };

  @IsString()
  @IsNotEmpty()
  reviewStatus: string;

  @IsString()
  @IsNotEmpty()
  createdAt: string;
}