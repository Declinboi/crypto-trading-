import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  Req,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Public, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole, KycStatus } from '../entities/enums';
import {
  InitiateKycDto,
  SubmitKycDto,
  ReviewKycDto,
  SumsubWebhookDto,
} from './dto/kyc.dto';

@Controller('api/v1/kyc')
export class KycController {
  constructor(private kycService: KycService) {}

  // ── GET /api/v1/kyc/status ────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus(@CurrentUser() user: User) {
    return this.kycService.getStatus(user.id);
  }

  // ── POST /api/v1/kyc/initiate ─────────────────────────────────────────────────
  // Returns Sumsub SDK token for frontend widget
  @UseGuards(JwtAuthGuard)
  @Post('initiate')
  @HttpCode(HttpStatus.OK)
  initiate(@Body() dto: InitiateKycDto, @CurrentUser() user: User) {
    return this.kycService.initiate(user.id, dto);
  }

  // ── POST /api/v1/kyc/submit ───────────────────────────────────────────────────
  // Manual fallback (no SDK)
  @UseGuards(JwtAuthGuard)
  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  submit(@Body() dto: SubmitKycDto, @CurrentUser() user: User) {
    return this.kycService.submit(user.id, dto);
  }

  // ── GET /api/v1/kyc/sumsub-applicant ─────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('sumsub-applicant')
  getSumsubApplicant(@CurrentUser() user: User) {
    return this.kycService.getSumsubApplicant(user.id);
  }

  // ── POST /api/v1/kyc/webhook/sumsub ──────────────────────────────────────────
  @Public()
  @Post('webhook/sumsub')
  @HttpCode(HttpStatus.OK)
  sumsubWebhook(
    @Headers('x-payload-digest') signature: string,
    @Body() dto: SumsubWebhookDto,
    @Req() req: Request,
  ) {
    const rawPayload = JSON.stringify(req.body);
    return this.kycService.handleSumsubWebhook(rawPayload, signature, dto);
  }

  // ── ADMIN: GET ALL ────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/all')
  adminGetAll(
    @Query('status') status?: KycStatus,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.kycService.adminGetAll(status, page, limit);
  }

  // ── ADMIN: GET ONE ────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/:id')
  adminGetOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.kycService.adminGetOne(id);
  }

  // ── ADMIN: REVIEW ─────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('admin/:id/review')
  @HttpCode(HttpStatus.OK)
  adminReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewKycDto,
    @CurrentUser() user: User,
  ) {
    return this.kycService.adminReview(id, user.id, dto);
  }
}
