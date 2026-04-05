import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface GupshupMessage {
  type: 'text' | 'image' | 'document' | 'list' | 'quick_reply' | 'template';
  text?: string;
  buttons?: GupshupButton[];
  sections?: GupshupSection[];
  header?: string;
  footer?: string;
  templateId?: string;
  templateParams?: string[];
}

export interface GupshupButton {
  type: 'reply' | 'url' | 'call';
  title: string;
  id?: string;
  url?: string;
  phone?: string;
}

export interface GupshupSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

@Injectable()
export class GupshupService {
  private readonly logger = new Logger(GupshupService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly appName: string;
  private readonly sourceNumber: string;

  constructor(private config: ConfigService) {
    this.apiKey = config.get<string>('GUPSHUP_API_KEY') as string;
    this.appName = config.get<string>('GUPSHUP_APP_NAME') as string;
    this.sourceNumber = config.get<string>('GUPSHUP_SOURCE_NUMBER') as string;

    this.client = axios.create({
      baseURL: 'https://api.gupshup.io/wa/api/v1',
      timeout: 15000,
      headers: {
        apikey: this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  // ── SEND TEXT MESSAGE ─────────────────────────────────────────────────────────
  async sendText(to: string, message: string): Promise<boolean> {
    return this.send(to, {
      type: 'text',
      text: message,
    });
  }

  // ── SEND OTP ──────────────────────────────────────────────────────────────────
  async sendOtp(to: string, otp: string, firstName: string): Promise<boolean> {
    const message =
      `👋 Hi ${firstName}!\n\n` +
      `Your *CryptoPay NG* verification code is:\n\n` +
      `*${otp}*\n\n` +
      `⏱ This code expires in *10 minutes*.\n\n` +
      `🔒 Never share this code with anyone.`;

    return this.sendText(to, message);
  }

  // ── SEND QUICK REPLY ──────────────────────────────────────────────────────────
  async sendQuickReply(params: {
    to: string;
    body: string;
    header?: string;
    footer?: string;
    buttons: { id: string; title: string }[];
  }): Promise<boolean> {
    const payload = new URLSearchParams({
      channel: 'whatsapp',
      source: this.sourceNumber,
      destination: this.formatPhone(params.to),
      'src.name': this.appName,
      message: JSON.stringify({
        type: 'quick_reply',
        msgid: `qr-${Date.now()}`,
        content: {
          type: 'text',
          header: params.header ?? '',
          text: params.body,
          footer: params.footer ?? '',
          msgid: `qr-${Date.now()}`,
        },
        options: params.buttons.map((b) => ({ type: 'text', title: b.title })),
      }),
    });

    try {
      await this.client.post('/msg', payload.toString());
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send quick reply to ${params.to}: ${err.message}`,
      );
      return false;
    }
  }

  // ── SEND LIST MESSAGE ─────────────────────────────────────────────────────────
  async sendList(params: {
    to: string;
    body: string;
    header?: string;
    footer?: string;
    buttonText: string;
    sections: GupshupSection[];
  }): Promise<boolean> {
    const payload = new URLSearchParams({
      channel: 'whatsapp',
      source: this.sourceNumber,
      destination: this.formatPhone(params.to),
      'src.name': this.appName,
      message: JSON.stringify({
        type: 'list',
        title: params.header ?? 'Menu',
        body: params.body,
        footer: params.footer ?? '',
        msgid: `list-${Date.now()}`,
        globalButtons: [{ type: 'text', title: params.buttonText }],
        items: params.sections.map((s) => ({
          title: s.title,
          subtitle: '',
          options: s.rows.map((r) => ({
            type: 'text',
            title: r.title,
            description: r.description ?? '',
            postbackText: r.id,
          })),
        })),
      }),
    });

    try {
      await this.client.post('/msg', payload.toString());
      return true;
    } catch (err) {
      this.logger.error(`Failed to send list to ${params.to}: ${err.message}`);
      return false;
    }
  }

  // ── CORE SEND ─────────────────────────────────────────────────────────────────
  private async send(to: string, message: GupshupMessage): Promise<boolean> {
    const payload = new URLSearchParams({
      channel: 'whatsapp',
      source: this.sourceNumber,
      destination: this.formatPhone(to),
      'src.name': this.appName,
      message: JSON.stringify({
        type: message.type,
        text: message.text ?? '',
      }),
    });

    try {
      const res = await this.client.post('/msg', payload.toString());
      this.logger.debug(`WhatsApp sent to ${to}: ${res.data?.status}`);
      return true;
    } catch (err) {
      this.logger.error(`WhatsApp send failed to ${to}: ${err.message}`);
      return false;
    }
  }

  // ── FORMAT PHONE (ensure international format) ────────────────────────────────
  formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    // Nigerian numbers: add 234 prefix
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      return `234${cleaned.substring(1)}`;
    }
    if (cleaned.startsWith('234')) return cleaned;
    if (cleaned.length === 10) return `234${cleaned}`;
    return cleaned;
  }
}
