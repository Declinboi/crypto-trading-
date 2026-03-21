import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, Public, Roles } from '../auth/decorators/index';
import { User } from '../entities/user.entity';
import { UserRole } from '../entities/enums';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceQueryDto,
} from './dto/invoice.dto';

@Controller('api/v1/invoices')
export class InvoiceController {
  constructor(private invoiceService: InvoiceService) {}

  // ── POST /api/v1/invoices ─────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: User) {
    return this.invoiceService.create(user.id, dto);
  }

  // ── GET /api/v1/invoices ──────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@CurrentUser() user: User, @Query() query: InvoiceQueryDto) {
    return this.invoiceService.findAll(user.id, query);
  }

  // ── GET /api/v1/invoices/stats ────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('stats')
  getStats(@CurrentUser() user: User) {
    return this.invoiceService.getStats(user.id);
  }

  // ── GET /api/v1/invoices/:id ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.invoiceService.findOne(id, user.id);
  }

  // ── GET /api/v1/invoices/:id/pay ─────────────────────────────────────────────
  // Public — this is what the client sees
  @Public()
  @Get(':id/pay')
  getPaymentPage(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceService.getPublicPaymentPage(id);
  }

  // ── PATCH /api/v1/invoices/:id ────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: User,
  ) {
    return this.invoiceService.update(id, user.id, dto);
  }

  // ── DELETE /api/v1/invoices/:id ───────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.invoiceService.cancel(id, user.id);
  }

  // ── ADMIN ─────────────────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/all')
  adminGetAll(@Query() query: InvoiceQueryDto) {
    return this.invoiceService.adminGetAll(query);
  }
}