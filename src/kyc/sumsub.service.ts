import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import FormData from 'form-data';

@Injectable()
export class SumsubService {
  private readonly logger = new Logger(SumsubService.name);
  private readonly client: AxiosInstance;
  private readonly appToken: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.sumsub.com';

  constructor(private config: ConfigService) {
    this.appToken = config.get<string>('SUMSUB_APP_TOKEN') as string;
    this.secretKey = config.get<string>('SUMSUB_SECRET_KEY') as string;

    this.client = axios.create({ baseURL: this.baseUrl });

    // Attach HMAC signature to every request
    this.client.interceptors.request.use((cfg) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const method = cfg.method!.toUpperCase();
      const url = cfg.url!;

      let body = '';
      if (cfg.data) {
        body =
          cfg.data instanceof FormData
            ? ''
            : typeof cfg.data === 'string'
              ? cfg.data
              : JSON.stringify(cfg.data);
      }

      const signature = this.sign(ts, method, url, body);

      cfg.headers['X-App-Token'] = this.appToken;
      cfg.headers['X-App-Access-Ts'] = ts;
      cfg.headers['X-App-Access-Sig'] = signature;

      return cfg;
    });
  }

  // ── Create or get applicant ───────────────────────────────────────────────────
  async createApplicant(
    externalUserId: string,
    levelName = 'basic-kyc-level',
  ): Promise<{ applicantId: string }> {
    const response = await this.client.post(
      `/resources/applicants?levelName=${levelName}`,
      { externalUserId },
      { headers: { 'Content-Type': 'application/json' } },
    );
    return { applicantId: response.data.id };
  }

  // ── Get applicant by external user ID ────────────────────────────────────────
  async getApplicantByExternalId(externalUserId: string) {
    const response = await this.client.get(
      `/resources/applicants/-;externalUserId=${externalUserId}/one`,
    );
    return response.data;
  }

  // ── Generate SDK access token (for frontend SDK) ──────────────────────────────
  async generateSdkAccessToken(
    externalUserId: string,
    levelName = 'basic-kyc-level',
    ttlInSecs = 600,
  ): Promise<{ token: string; userId: string }> {
    const response = await this.client.post(
      `/resources/accessTokens?userId=${externalUserId}&levelName=${levelName}&ttlInSecs=${ttlInSecs}`,
      {},
      { headers: { 'Content-Type': 'application/json' } },
    );
    return {
      token: response.data.token,
      userId: response.data.userId,
    };
  }

  // ── Get applicant review status ───────────────────────────────────────────────
  async getApplicantStatus(applicantId: string) {
    const response = await this.client.get(
      `/resources/applicants/${applicantId}/requiredIdDocsStatus`,
    );
    return response.data;
  }

  // ── Get full applicant data ───────────────────────────────────────────────────
  async getApplicant(applicantId: string) {
    const response = await this.client.get(
      `/resources/applicants/${applicantId}/one`,
    );
    return response.data;
  }

  // ── Reset applicant (for re-submission) ───────────────────────────────────────
  async resetApplicant(applicantId: string): Promise<void> {
    await this.client.post(`/resources/applicants/${applicantId}/reset`);
  }

  // ── Verify webhook signature ──────────────────────────────────────────────────
  verifyWebhookSignature(payload: string, receivedDigest: string): boolean {
    const expectedDigest = crypto
      .createHmac('sha1', this.secretKey)
      .update(payload)
      .digest('hex');
    return expectedDigest === receivedDigest;
  }

  // ── HMAC signing for API requests ─────────────────────────────────────────────
  private sign(ts: string, method: string, url: string, body: string): string {
    const data = ts + method + url + body;
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(data)
      .digest('hex');
  }
}
