import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { KycVerificationType } from './dto/kyc.dto';

export interface SmileVerificationResult {
  success: boolean;
  jobId: string;
  smileJobId: string;
  resultCode: string;
  resultText: string;
  idVerified: boolean;
  faceVerified: boolean;
  livenessCheck: boolean;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  phoneNumber: string | null;
  rawResult: any;
}

@Injectable()
export class SmileIdentityService {
  private readonly logger = new Logger(SmileIdentityService.name);
  private readonly client: AxiosInstance;
  private readonly partnerId: string;
  private readonly apiKey: string;
  private readonly callbackUrl: string;
  private readonly baseUrl: string;

  constructor(private config: ConfigService) {
    this.partnerId = config.get<string>('SMILE_PARTNER_ID') as string;
    this.apiKey = config.get<string>('SMILE_API_KEY') as string;
    this.callbackUrl = `${config.get('APP_URL')}/api/v1/kyc/webhook/smile`;
    this.baseUrl =
      config.get<string>('SMILE_BASE_URL') ??
      'https://testapi.smileidentity.com/v1'; // sandbox
    // production: https://api.smileidentity.com/v1

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── VERIFY BVN (no face — just ID lookup) ─────────────────────────────────────
  async verifyBvn(params: {
    userId: string;
    bvn: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
  }): Promise<SmileVerificationResult> {
    const jobId = uuidv4();
    const timestamp = new Date().toISOString();

    const payload = {
      partner_id: this.partnerId,
      timestamp,
      signature: this.generateSignature(timestamp),
      smile_client_id: params.userId,
      job_type: 5, // BVN verification job type
      job_id: jobId,
      id_info: {
        country: 'NG',
        id_type: 'BVN',
        id_number: params.bvn,
        first_name: params.firstName ?? '',
        last_name: params.lastName ?? '',
        dob: params.dateOfBirth ?? '',
        entered: true,
      },
      callback_url: this.callbackUrl,
      return_job_status: true,
      return_history: false,
      return_images: false,
    };

    try {
      const res = await this.client.post('/id_verification', payload);
      return this.parseVerificationResult(res.data, jobId);
    } catch (err) {
      const message = err.response?.data?.error ?? err.message;
      this.logger.error(`BVN verification failed: ${message}`);
      throw new InternalServerErrorException(
        `BVN verification failed: ${message}`,
      );
    }
  }

  // ── VERIFY NIN (no face — just ID lookup) ─────────────────────────────────────
  async verifyNin(params: {
    userId: string;
    nin: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
  }): Promise<SmileVerificationResult> {
    const jobId = uuidv4();
    const timestamp = new Date().toISOString();

    const payload = {
      partner_id: this.partnerId,
      timestamp,
      signature: this.generateSignature(timestamp),
      smile_client_id: params.userId,
      job_type: 5, // Enhanced KYC
      job_id: jobId,
      id_info: {
        country: 'NG',
        id_type: 'NIN',
        id_number: params.nin,
        first_name: params.firstName ?? '',
        last_name: params.lastName ?? '',
        dob: params.dateOfBirth ?? '',
        entered: true,
      },
      callback_url: this.callbackUrl,
      return_job_status: true,
      return_history: false,
      return_images: false,
    };

    try {
      const res = await this.client.post('/id_verification', payload);
      return this.parseVerificationResult(res.data, jobId);
    } catch (err) {
      const message = err.response?.data?.error ?? err.message;
      this.logger.error(`NIN verification failed: ${message}`);
      throw new InternalServerErrorException(
        `NIN verification failed: ${message}`,
      );
    }
  }

  // ── VERIFY ID + FACE (selfie match) ──────────────────────────────────────────
  // Job type 1 = biometric KYC (ID lookup + face compare + liveness)
  async verifyWithFace(params: {
    userId: string;
    idType: KycVerificationType;
    idNumber: string;
    selfieBase64: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
  }): Promise<SmileVerificationResult> {
    const jobId = uuidv4();
    const timestamp = new Date().toISOString();

    // Map our enum to Smile Identity ID types
    const smileIdType = this.mapIdType(params.idType);

    const payload = {
      partner_id: this.partnerId,
      timestamp,
      signature: this.generateSignature(timestamp),
      smile_client_id: params.userId,
      job_type: 1, // Biometric KYC — face + ID
      job_id: jobId,
      id_info: {
        country: 'NG',
        id_type: smileIdType,
        id_number: params.idNumber,
        first_name: params.firstName ?? '',
        last_name: params.lastName ?? '',
        dob: params.dateOfBirth ?? '',
        entered: true,
      },
      images: [
        {
          image_type_id: 2, // selfie (front of face)
          image: params.selfieBase64,
        },
      ],
      callback_url: this.callbackUrl,
      return_job_status: true,
      return_history: false,
      return_images: false,
      use_enrolled_image: false,
    };

    try {
      const res = await this.client.post('/submission', payload);
      return this.parseVerificationResult(res.data, jobId);
    } catch (err) {
      const message = err.response?.data?.error ?? err.message;
      this.logger.error(`Face verification failed: ${message}`);
      throw new InternalServerErrorException(
        `Face verification failed: ${message}`,
      );
    }
  }

  // ── GET JOB STATUS ────────────────────────────────────────────────────────────
  async getJobStatus(jobId: string, userId: string): Promise<any> {
    const timestamp = new Date().toISOString();

    try {
      const res = await this.client.post('/job_status', {
        partner_id: this.partnerId,
        timestamp,
        signature: this.generateSignature(timestamp),
        smile_client_id: userId,
        job_id: jobId,
        return_history: false,
        return_images: false,
      });
      return res.data;
    } catch (err) {
      this.logger.error(`Job status check failed: ${err.message}`);
      throw new InternalServerErrorException('Failed to check job status');
    }
  }

  // ── PARSE VERIFICATION RESULT ─────────────────────────────────────────────────
  parseVerificationResult(data: any, jobId: string): SmileVerificationResult {
    const result = data.result ?? data;
    const actions = result?.Actions ?? {};
    const fullData = result?.FullData ?? result?.full_data ?? {};
    const resultCode = result?.ResultCode ?? '0820';

    // Result codes:
    // 0810 = Approved (ID verified)
    // 0811 = Approved with warnings
    // 0812 = ID number not found
    // 0820 = Not approved
    // 0821 = Selfie to ID mismatch
    // 0822 = Liveness check failed

    const codeApproved = ['0810', '0811'].includes(resultCode);
    const actionVerified = actions?.Verify_ID_Number === 'Verified';
    const idVerified = codeApproved && actionVerified;

    const faceVerified =
      actions?.Selfie_To_ID_Face_Compare === 'Passed' ||
      actions?.Selfie_To_ID_Face_Compare === 'Approved';

    const livenessCheck =
      actions?.Liveness_Check === 'Passed' ||
      (actions?.Liveness_Check === 'Not Applicable' && !data.images?.length);

    // Extract name from result
    const fullName = fullData?.FullName ?? null;
    let firstName = fullData?.FirstName ?? fullData?.first_name ?? null;
    let lastName = fullData?.LastName ?? fullData?.last_name ?? null;
    let middleName = fullData?.MiddleName ?? fullData?.middle_name ?? null;

    // If only FullName is available, parse it
    if (fullName && !firstName) {
      const parts = fullName.trim().split(' ');
      firstName = parts[0] ?? null;
      lastName = parts[parts.length - 1] ?? null;
      middleName = parts.length > 2 ? parts.slice(1, -1).join(' ') : null;
    }

    return {
      success: idVerified,
      jobId,
      smileJobId: result?.SmileJobID ?? data?.smile_job_id ?? jobId,
      resultCode,
      resultText: result?.ResultText ?? 'Unknown',
      idVerified,
      faceVerified,
      livenessCheck,
      fullName:
        fullName ?? (firstName && lastName ? `${firstName} ${lastName}` : null),
      firstName,
      lastName,
      dateOfBirth: fullData?.DOB ?? fullData?.dob ?? null,
      gender: fullData?.Gender ?? fullData?.gender ?? null,
      phoneNumber: fullData?.PhoneNumber ?? fullData?.phone_number ?? null,
      rawResult: data,
    };
  }

  // ── VERIFY WEBHOOK SIGNATURE ──────────────────────────────────────────────────
  verifyWebhookSignature(timestamp: string, signature: string): boolean {
    try {
      const expected = this.generateSignature(timestamp);
      return expected === signature;
    } catch {
      return false;
    }
  }

  // ── GENERATE SIGNATURE ────────────────────────────────────────────────────────
  // Smile Identity uses: HMAC-SHA256(timestamp + partner_id + "sid_request", apiKey)
  generateSignature(timestamp: string): string {
    const data = timestamp + this.partnerId + 'sid_request';
    return crypto
      .createHmac('sha256', this.apiKey)
      .update(data)
      .digest('base64');
  }

  // ── MAP ID TYPE ───────────────────────────────────────────────────────────────
  private mapIdType(idType: KycVerificationType): string {
    const map: Record<KycVerificationType, string> = {
      [KycVerificationType.BVN]: 'BVN',
      [KycVerificationType.NIN]: 'NIN',
      [KycVerificationType.NIN_SLIP]: 'NIN_SLIP',
    };
    return map[idType] ?? 'NIN';
  }
}
