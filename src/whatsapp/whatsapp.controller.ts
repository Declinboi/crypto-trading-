import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Public } from '../auth/decorators/index';
import { WhatsappBotService } from './whatsapp-bot.service';

@Controller('api/v1/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private botService: WhatsappBotService) {}

  // ── POST /api/v1/whatsapp/webhook ─────────────────────────────────────────────
  // Gupshup sends all incoming WhatsApp messages here
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: any) {
    try {
      const payload = body?.payload ?? body;
      const phone = payload?.sender?.phone ?? payload?.mobile;
      const type = payload?.type ?? 'text';
      const name = payload?.sender?.name ?? '';

      let message = '';

      if (type === 'text') {
        message = payload?.payload?.text ?? payload?.text ?? '';
      } else if (type === 'interactive') {
        // Quick reply or list selection
        message =
          payload?.payload?.title ??
          payload?.payload?.postbackText ??
          payload?.payload?.text ??
          '';
      } else if (type === 'button_reply') {
        message = payload?.payload?.title ?? '';
      }

      if (!phone || !message) {
        this.logger.warn(`Invalid webhook payload: ${JSON.stringify(body)}`);
        return { status: 'ok' };
      }

      // Process async — return immediately so Gupshup doesn't retry
      setImmediate(() => {
        this.botService
          .handleIncomingMessage({
            phone,
            message,
            type,
            name,
          })
          .catch((err) => this.logger.error(`Bot error: ${err.message}`));
      });

      return { status: 'ok' };
    } catch (err) {
      this.logger.error(`Webhook error: ${err.message}`);
      return { status: 'ok' }; // Always return 200 to Gupshup
    }
  }

  // ── GET /api/v1/whatsapp/webhook ─────────────────────────────────────────────
  // Gupshup webhook verification
  @Public()
  @Get('webhook')
  verifyWebhook(@Query() query: any) {
    return query['hub.challenge'] ?? 'ok';
  }
}
