import { Injectable, Logger, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export enum BotState {
  IDLE = 'IDLE',
  AWAITING_OTP = 'AWAITING_OTP',
  AWAITING_PIN = 'AWAITING_PIN',
  AWAITING_TRANSFER_TAG = 'AWAITING_TRANSFER_TAG',
  AWAITING_TRANSFER_AMOUNT = 'AWAITING_TRANSFER_AMOUNT',
  AWAITING_TRANSFER_CONFIRM = 'AWAITING_TRANSFER_CONFIRM',
  AWAITING_WITHDRAW_AMOUNT = 'AWAITING_WITHDRAW_AMOUNT',
  AWAITING_WITHDRAW_BANK = 'AWAITING_WITHDRAW_BANK',
  AWAITING_WITHDRAW_CONFIRM = 'AWAITING_WITHDRAW_CONFIRM',
  AWAITING_INVOICE_AMOUNT = 'AWAITING_INVOICE_AMOUNT',
  AWAITING_INVOICE_TITLE = 'AWAITING_INVOICE_TITLE',
  AWAITING_INVOICE_CONFIRM = 'AWAITING_INVOICE_CONFIRM',
}

export interface BotSession {
  phone: string;
  userId?: string;
  state: BotState;
  data: Record<string, any>;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class WhatsappSessionService {
  private readonly logger = new Logger(WhatsappSessionService.name);
  private readonly TTL = 60 * 30; // 30 minutes session TTL

  constructor(
    @Inject(REDIS_CLIENT)
    private redis: Redis,
  ) {}

  private key(phone: string): string {
    return `wa:session:${phone}`;
  }

  async get(phone: string): Promise<BotSession | null> {
    try {
      const raw = await this.redis.get(this.key(phone));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async set(phone: string, session: Partial<BotSession>): Promise<void> {
    const existing = (await this.get(phone)) ?? {
      phone,
      state: BotState.IDLE,
      data: {},
      attempts: 0,
      createdAt: new Date().toISOString(),
    };

    const updated: BotSession = {
      ...existing,
      ...session,
      phone,
      updatedAt: new Date().toISOString(),
    };

    await this.redis.setex(this.key(phone), this.TTL, JSON.stringify(updated));
  }

  async setState(
    phone: string,
    state: BotState,
    data?: Record<string, any>,
  ): Promise<void> {
    await this.set(phone, { state, ...(data ? { data } : {}) });
  }

  async updateData(phone: string, data: Record<string, any>): Promise<void> {
    const session = await this.get(phone);
    await this.set(phone, {
      data: { ...(session?.data ?? {}), ...data },
    });
  }

  async clear(phone: string): Promise<void> {
    await this.redis.del(this.key(phone));
  }

  async incrementAttempts(phone: string): Promise<number> {
    const session = await this.get(phone);
    const attempts = (session?.attempts ?? 0) + 1;
    await this.set(phone, { attempts });
    return attempts;
  }
}
