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
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Public, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole, KycStatus } from '../entities/enums';
import {
  InitiateBvnDto,
  InitiateNinDto,
  SubmitKycWithFaceDto,
  ReviewKycDto,
  SmileWebhookDto,
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

  // ── POST /api/v1/kyc/verify-bvn ──────────────────────────────────────────────
  // Step 1: Verify BVN
  @UseGuards(JwtAuthGuard)
  @Post('verify-bvn')
  @HttpCode(HttpStatus.OK)
  verifyBvn(@Body() dto: InitiateBvnDto, @CurrentUser() user: User) {
    return this.kycService.verifyBvn(user.id, dto);
  }

  // ── POST /api/v1/kyc/verify-nin-face ─────────────────────────────────────────
  // Step 2: Verify NIN + selfie face comparison
  @UseGuards(JwtAuthGuard)
  @Post('verify-nin-face')
  @HttpCode(HttpStatus.OK)
  verifyNinWithFace(
    @Body() dto: SubmitKycWithFaceDto,
    @CurrentUser() user: User,
  ) {
    return this.kycService.verifyNinWithFace(user.id, dto);
  }

  // ── POST /api/v1/kyc/webhook/smile ────────────────────────────────────────────
  @Public()
  @Post('webhook/smile')
  @HttpCode(HttpStatus.OK)
  smileWebhook(@Body() dto: SmileWebhookDto, @Req() req: Request) {
    const rawPayload = JSON.stringify(req.body);
    return this.kycService.handleSmileWebhook(rawPayload, dto);
  }

  // ── ADMIN ─────────────────────────────────────────────────────────────────────
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

  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/:id')
  adminGetOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.kycService.adminGetOne(id);
  }

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
