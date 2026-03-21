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
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/enums';
import {
  TransferToUserDto,
  WalletTransactionQueryDto,
  UpdateWalletTagDto,
  AdminFreezeWalletDto,
  WithdrawTobankDto,
} from './dto/wallet.dto';

@Controller('api/v1/wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private walletService: WalletService) {}

  // ── GET /api/v1/wallet ────────────────────────────────────────────────────────
  @Get()
  getMyWallet(@CurrentUser() user: User) {
    return this.walletService.getMyWallet(user.id);
  }

  // ── GET /api/v1/wallet/summary ────────────────────────────────────────────────
  @Get('summary')
  getSummary(@CurrentUser() user: User) {
    return this.walletService.getWalletSummary(user.id);
  }

  // ── GET /api/v1/wallet/transactions ──────────────────────────────────────────
  @Get('transactions')
  getTransactions(
    @CurrentUser() user: User,
    @Query() query: WalletTransactionQueryDto,
  ) {
    return this.walletService.getTransactions(user.id, query);
  }

  // ── GET /api/v1/wallet/lookup/:tag ───────────────────────────────────────────
  @Get('lookup/:tag')
  lookupByTag(@Param('tag') tag: string) {
    return this.walletService.getWalletByTag(tag);
  }

  // ── PATCH /api/v1/wallet/tag ──────────────────────────────────────────────────
  @Patch('tag')
  @HttpCode(HttpStatus.OK)
  updateTag(@Body() dto: UpdateWalletTagDto, @CurrentUser() user: User) {
    return this.walletService.updateTag(user.id, dto);
  }

  // ── POST /api/v1/wallet/transfer ──────────────────────────────────────────────
  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  transfer(@Body() dto: TransferToUserDto, @CurrentUser() user: User) {
    return this.walletService.transferToUser(user.id, dto);
  }

  // ── POST /api/v1/wallet/withdraw ──────────────────────────────────────────────
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@Body() dto: WithdrawTobankDto, @CurrentUser() user: User) {
    return this.walletService.withdrawToBank(user.id, dto);
  }

  // ── ADMIN: GET ALL WALLETS ────────────────────────────────────────────────────
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/all')
  adminGetAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.walletService.adminGetAllWallets(page, limit);
  }

  // ── ADMIN: PLATFORM STATS ─────────────────────────────────────────────────────
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/stats')
  adminStats() {
    return this.walletService.adminGetStats();
  }

  // ── ADMIN: FREEZE / UNFREEZE ──────────────────────────────────────────────────
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch('admin/:id/status')
  @HttpCode(HttpStatus.OK)
  adminFreeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminFreezeWalletDto,
    @CurrentUser() user: User,
  ) {
    return this.walletService.adminFreezeWallet(id, dto, user.id);
  }
}