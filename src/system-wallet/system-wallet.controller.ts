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
import { UserRole } from '../entities/enums';
import {
  CreateSystemWalletDto,
  UpdateSystemWalletDto,
  TopUpSystemWalletDto,
  WalletQueryDto,
  TransactionQueryDto,
  WithdrawSystemWalletDto,
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

  // ── GET /api/v1/system-wallets/main ──────────────────────────────────────────
  @Get('main')
  getMainWallet() {
    return this.systemWalletService.getMainWallet();
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

  // ── POST /api/v1/system-wallets/:id/top-up ───────────────────────────────────
  // Admin manually tops up the NGN reserve
  @Post(':id/top-up')
  @HttpCode(HttpStatus.OK)
  topUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TopUpSystemWalletDto,
    @CurrentUser() user: User,
  ) {
    return this.systemWalletService.adminTopUp(id, dto, user.id);
  }

  // ── POST /api/v1/system-wallets/:id/withdraw ──────────────────────────────────
  // Admin withdraws profit/fees from the system wallet
  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawSystemWalletDto,
    @CurrentUser() user: User,
  ) {
    return this.systemWalletService.adminWithdraw(id, dto, user.id);
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
