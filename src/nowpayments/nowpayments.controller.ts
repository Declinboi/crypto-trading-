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
} from '@nestjs/common';
import type { Request } from 'express';
import { NowpaymentsService } from './nowpayments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Public, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole, CoinType } from '../entities/enums';
import { CreatePaymentDto, NowpaymentsWebhookDto } from './dto/nowpayments.dto';

@Controller('api/v1/payments')
export class NowpaymentsController {
  constructor(private nowpaymentsService: NowpaymentsService) {}

  // ── GET /api/v1/payments/rates ────────────────────────────────────────────────
  @Public()
  @Get('rates')
  getAllRates() {
    return this.nowpaymentsService.getAllLatestRates();
  }

  // ── GET /api/v1/payments/rates/:coin ─────────────────────────────────────────
  @Public()
  @Get('rates/:coin')
  getRate(@Param('coin') coin: CoinType) {
    return this.nowpaymentsService.getLatestRate(coin);
  }

  // ── POST /api/v1/payments/rates/refresh ───────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('rates/refresh')
  @HttpCode(HttpStatus.OK)
  refreshRates() {
    return this.nowpaymentsService.fetchLiveRates();
  }

  // ── GET /api/v1/payments/currencies ──────────────────────────────────────────
  @Public()
  @Get('currencies')
  getCurrencies() {
    return this.nowpaymentsService.getAvailableCurrencies();
  }

  // ── GET /api/v1/payments/min-amount/:coin ─────────────────────────────────────
  @Public()
  @Get('min-amount/:coin')
  getMinAmount(@Param('coin') coin: CoinType) {
    return this.nowpaymentsService.getMinimumPaymentAmount(coin);
  }

  // ── POST /api/v1/payments/create ─────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  createPayment(@Body() dto: CreatePaymentDto, @CurrentUser() user: User) {
    return this.nowpaymentsService.createPayment(
      dto.invoiceId,
      dto.coin,
      user.id,
    );
  }

  // ── POST /api/v1/payments/lock-rate ──────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('lock-rate')
  @HttpCode(HttpStatus.OK)
  lockRate(
    @Body('invoiceId') invoiceId: string,
    @Body('coin') coin: CoinType,
    @Body('amountUsd') amountUsd: number,
  ) {
    return this.nowpaymentsService.lockRate(invoiceId, coin, amountUsd);
  }

  // ── GET /api/v1/payments/status/:paymentId ────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('status/:paymentId')
  getPaymentStatus(@Param('paymentId') paymentId: string) {
    return this.nowpaymentsService.getPaymentStatus(paymentId);
  }

  // ── POST /api/v1/payments/webhook/nowpayments ─────────────────────────────────
  @Public()
  @Post('webhook/nowpayments')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Headers('x-nowpayments-sig') signature: string,
    @Body() dto: NowpaymentsWebhookDto,
    @Req() req: Request,
  ) {
    const rawPayload = JSON.stringify(req.body);
    return this.nowpaymentsService.processWebhook(rawPayload, signature, dto);
  }
}
