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
import { MonnifyService } from './monnify.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Public, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/enums';
import {
  InitiatePayoutDto,
  VerifyBankAccountDto,
  MonnifyWebhookDto,
  RetryPayoutDto,
  PayoutQueryDto,
} from './dto/monnify.dto';

@Controller('api/v1/payouts')
export class MonnifyController {
  constructor(private monnifyService: MonnifyService) {}

  @Public()
  @Get('banks')
  getBanks() {
    return this.monnifyService.getBanks();
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-bank')
  @HttpCode(HttpStatus.OK)
  verifyBank(@Body() dto: VerifyBankAccountDto) {
    return this.monnifyService.verifyBankAccount(dto);
  }

  // User withdraws from wallet to bank (main user-facing payout trigger)
  // Users do NOT call initiatePayout directly — they use POST /wallet/withdraw

  @UseGuards(JwtAuthGuard)
  @Post('retry')
  @HttpCode(HttpStatus.OK)
  retryPayout(@Body() dto: RetryPayoutDto, @CurrentUser() user: User) {
    return this.monnifyService.retryPayout(dto.payoutId, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  getUserPayouts(@CurrentUser() user: User, @Query() query: PayoutQueryDto) {
    return this.monnifyService.getUserPayouts(user.id, query);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('stats')
  getStats() {
    return this.monnifyService.getPayoutStats();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getPayout(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.monnifyService.getPayout(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/verify')
  verifyStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.monnifyService.verifyPayoutStatus(id, user.id);
  }

  @Public()
  @Post('webhook/monnify')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Headers('monnify-signature') signature: string,
    @Body() dto: MonnifyWebhookDto,
    @Req() req: Request,
  ) {
    const rawPayload = JSON.stringify(req.body);
    return this.monnifyService.processWebhook(rawPayload, signature, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/all')
  adminGetAll(@Query() query: PayoutQueryDto) {
    return this.monnifyService.adminGetAllPayouts(query);
  }

  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/trigger/:transactionId')
  @HttpCode(HttpStatus.OK)
  adminTrigger(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @CurrentUser() user: User,
  ) {
    return this.monnifyService.adminTriggerPayout(transactionId, user.id);
  }

  // ── System wallet virtual account ─────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('system/virtual-account')
  getSystemVirtualAccount() {
    return this.monnifyService.getSystemWalletVirtualAccount();
  }

  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('system/virtual-account/create')
  @HttpCode(HttpStatus.CREATED)
  createSystemVirtualAccount() {
    return this.monnifyService.createSystemWalletVirtualAccount();
  }
}
