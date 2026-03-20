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
} from '@nestjs/common';
import { SystemWalletService } from './system-wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole, CoinType, SystemWalletStatus } from '../entities/enums';
import {
  CreateSystemWalletDto,
  UpdateSystemWalletDto,
  RecordTransactionDto,
  SyncBalanceDto,
  WalletQueryDto,
  TransactionQueryDto,
} from './dto/system-wallet.dto';

@Controller('api/v1/system-wallets')
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class SystemWalletController {
  constructor(private systemWalletService: SystemWalletService) {}

  // ── GET /api/v1/system-wallets/stats ─────────────────────────────────────────
  @Get('stats')
  getPlatformStats() {
    return this.systemWalletService.getPlatformStats();
  }

  // ── GET /api/v1/system-wallets ────────────────────────────────────────────────
  @Get()
  findAll(@Query() query: WalletQueryDto) {
    return this.systemWalletService.findAll(query);
  }

  // ── POST /api/v1/system-wallets ───────────────────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSystemWalletDto, @CurrentUser() user: User) {
    return this.systemWalletService.create(dto, user.id);
  }

  // ── GET /api/v1/system-wallets/coin/:coin ─────────────────────────────────────
  @Get('coin/:coin')
  findByCoin(@Param('coin') coin: CoinType) {
    return this.systemWalletService.findByCoin(coin);
  }

  // ── GET /api/v1/system-wallets/:id ───────────────────────────────────────────
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.systemWalletService.findOne(id);
  }

  // ── PATCH /api/v1/system-wallets/:id ─────────────────────────────────────────
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSystemWalletDto,
    @CurrentUser() user: User,
  ) {
    return this.systemWalletService.update(id, dto, user.id);
  }

  // ── PATCH /api/v1/system-wallets/:id/status ───────────────────────────────────
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  toggleStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: SystemWalletStatus,
    @CurrentUser() user: User,
  ) {
    return this.systemWalletService.toggleStatus(id, status, user.id);
  }

  // ── PATCH /api/v1/system-wallets/:id/sync-balance ────────────────────────────
  @Patch(':id/sync-balance')
  @HttpCode(HttpStatus.OK)
  syncBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SyncBalanceDto,
    @CurrentUser() user: User,
  ) {
    return this.systemWalletService.syncBalance(id, dto, user.id);
  }

  // ── POST /api/v1/system-wallets/:id/transactions ─────────────────────────────
  @Post(':id/transactions')
  @HttpCode(HttpStatus.CREATED)
  recordTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordTransactionDto,
    @CurrentUser() user: User,
  ) {
    return this.systemWalletService.recordTransaction(id, dto, user.id);
  }

  // ── GET /api/v1/system-wallets/:id/transactions ───────────────────────────────
  @Get(':id/transactions')
  getTransactions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TransactionQueryDto,
  ) {
    return this.systemWalletService.getTransactions(id, query);
  }
}