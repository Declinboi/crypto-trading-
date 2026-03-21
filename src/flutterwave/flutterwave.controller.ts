import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { FlutterwaveService } from './flutterwave.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Public, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/enums';
import {
  VerifyBankAccountDto,
  FlutterwaveWebhookDto,
  RetryPayoutDto,
  PayoutQueryDto,
} from './dto/flutterwave.dto';

@Controller('api/v1/payouts')
export class FlutterwaveController {
  constructor(private flutterwaveService: FlutterwaveService) {}

  // ── GET /api/v1/payouts/banks ─────────────────────────────────────────────────
  @Public()
  @Get('banks')
  getBanks() {
    return this.flutterwaveService.getBanks();
  }

  // ── POST /api/v1/payouts/verify-bank ─────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('verify-bank')
  @HttpCode(HttpStatus.OK)
  verifyBank(@Body() dto: VerifyBankAccountDto) {
    return this.flutterwaveService.verifyBankAccount(dto);
  }

  // ── POST /api/v1/payouts/retry ────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('retry')
  @HttpCode(HttpStatus.OK)
  retryPayout(@Body() dto: RetryPayoutDto, @CurrentUser() user: User) {
    return this.flutterwaveService.retryPayout(dto.payoutId, user.id);
  }

  // ── GET /api/v1/payouts ───────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get()
  getUserPayouts(@CurrentUser() user: User, @Query() query: PayoutQueryDto) {
    return this.flutterwaveService.getUserPayouts(user.id, query);
  }

  // ── GET /api/v1/payouts/stats ─────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('stats')
  getStats() {
    return this.flutterwaveService.getPayoutStats();
  }

  // ── GET /api/v1/payouts/:id ───────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getPayout(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.flutterwaveService.getPayout(id, user.id);
  }

  // ── GET /api/v1/payouts/:id/verify ───────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get(':id/verify')
  verifyStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.flutterwaveService.verifyPayoutStatus(id, user.id);
  }

  // ── POST /api/v1/payouts/webhook/flutterwave ──────────────────────────────────
  @Public()
  @Post('webhook/flutterwave')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Headers('verif-hash') signature: string,
    @Body() dto: FlutterwaveWebhookDto,
    @Req() req: Request,
  ) {
    const rawPayload = JSON.stringify(req.body);
    return this.flutterwaveService.processWebhook(rawPayload, signature, dto);
  }

  // ── ADMIN: GET ALL PAYOUTS ────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/all')
  adminGetAll(@Query() query: PayoutQueryDto) {
    return this.flutterwaveService.adminGetAllPayouts(query);
  }

  // ── ADMIN: MANUAL TRIGGER ─────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/trigger/:transactionId')
  @HttpCode(HttpStatus.OK)
  adminTrigger(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @CurrentUser() user: User,
  ) {
    return this.flutterwaveService.adminTriggerPayout(transactionId, user.id);
  }
}
