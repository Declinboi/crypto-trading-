import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  MaxLength,
  Matches,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum KycVerificationType {
  BVN = 'BVN',
  NIN = 'NIN',
  NIN_SLIP = 'NIN_SLIP',
}

export enum KycProvider {
  SMILE_IDENTITY = 'smile_identity',
  MANUAL = 'manual',
}

export class InitiateBvnDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{11}$/, { message: 'BVN must be exactly 11 digits' })
  bvn: string;
}

export class InitiateNinDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{11}$/, { message: 'NIN must be exactly 11 digits' })
  nin: string;
}

export class SubmitKycWithFaceDto {
  @IsEnum(KycVerificationType)
  idType: KycVerificationType;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{11}$/, { message: 'ID number must be 11 digits' })
  idNumber: string;

  @IsString()
  @IsNotEmpty()
  // Base64 encoded selfie image
  selfieImage: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string; // YYYY-MM-DD — required for some ID types
}

export class ReviewKycDto {
  @IsEnum(['verified', 'rejected'])
  status: 'verified' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class SmileWebhookDto {
  job_id: string;
  job_type: number;
  smile_job_id: string;
  partner_id: string;
  result: SmileResult;
  source_sdk: string;
  timestamp: string;
  signature: string;
}

export interface SmileResult {
  ResultCode: string;
  ResultText: string;
  SmileJobID: string;
  Actions: SmileActions;
  FullData?: SmileFullData;
  IsFinalResult: string;
}

export interface SmileActions {
  Liveness_Check: string;
  Register_Selfie: string;
  Selfie_To_ID_Face_Compare: string;
  Verify_ID_Number: string;
  Return_Personal_Info: string;
  Human_Review_Compare?: string;
  Human_Review_Liveness_Check?: string;
}

export interface SmileFullData {
  DOB?: string;
  FullName?: string;
  IDNumber?: string;
  IDType?: string;
  ExpirationDate?: string;
  Gender?: string;
  PhoneNumber?: string;
  Country?: string;
  SecondaryIDNumber?: string;
}
