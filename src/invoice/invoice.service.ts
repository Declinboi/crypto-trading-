import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { BankAccount } from '../entities/bank-account.entity';
import { User } from '../entities/user.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { Notification } from '../entities/notification.entity';
import { InvoiceStatus, AuditActorType, KycStatus } from '../entities/enums';
import {
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceQueryDto,
} from './dto/invoice.dto';
import { EmailService } from 'src/email/email.service';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,

    @InjectRepository(BankAccount)
    private bankAccountRepo: Repository<BankAccount>,

    @InjectRepository(User)
    private userRepo: Repository<User>,

    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,

    private emailService: EmailService,

    private dataSource: DataSource,
  ) {}

  // ── CREATE INVOICE ────────────────────────────────────────────────────────────
  async create(userId: string, dto: CreateInvoiceDto): Promise<Invoice> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // KYC check for large invoices
    const KYC_THRESHOLD = 500;
    if (
      dto.amountUsd > KYC_THRESHOLD &&
      user.kycStatus !== KycStatus.VERIFIED
    ) {
      throw new ForbiddenException(
        `KYC verification required for invoices above $${KYC_THRESHOLD}. Please complete your KYC first.`,
      );
    }

    // ── Auto-cashout validation ─────────────────────────────────────────────────
    let autoCashoutBankAccountId: string | null = null;

    if (dto.autoCashout) {
      if (dto.autoCashoutBankAccountId) {
        // Verify the specified bank account belongs to user and is verified
        const bankAccount = await this.bankAccountRepo.findOne({
          where: {
            id: dto.autoCashoutBankAccountId,
            userId,
            isVerified: true,
          },
        });

        if (!bankAccount) {
          throw new BadRequestException(
            'Bank account not found or not verified. Please add and verify a bank account first.',
          );
        }
        autoCashoutBankAccountId = bankAccount.id;
      } else {
        // Fall back to user's default bank account
        const defaultBank = await this.bankAccountRepo.findOne({
          where: { userId, isDefault: true, isVerified: true },
        });

        if (!defaultBank) {
          throw new BadRequestException(
            'No verified default bank account found. Please add a bank account or specify one for auto-cashout.',
          );
        }
        autoCashoutBankAccountId = defaultBank.id;
      }
    }

    const invoiceNumber = await this.generateInvoiceNumber();

    const invoice = await this.invoiceRepo.save(
      this.invoiceRepo.create({
        userId,
        invoiceNumber,
        title: dto.title,
        clientName: dto.clientName ?? null,
        clientEmail: dto.clientEmail ?? null,
        amountUsd: dto.amountUsd,
        notes: dto.notes ?? null,
        status: InvoiceStatus.DRAFT,
        autoCashout: dto.autoCashout ?? false,
        autoCashoutBankAccountId,
      }),
    );

    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'invoice.created',
      'invoices',
      invoice.id,
      null,
      {
        invoiceNumber,
        amountUsd: dto.amountUsd,
        autoCashout: dto.autoCashout ?? false,
        autoCashoutBankAccountId,
      },
    );
    try {
      await this.emailService.sendInvoiceCreated(user.email, {
        firstName: user.firstName,
        invoiceNumber,
        amountUsd: dto.amountUsd,
        title: dto.title,
        autoCashout: dto.autoCashout ?? false,
        invoiceLink: `${process.env.FRONTEND_URL}/invoices/${invoice.id}`,
      });
    } catch (err) {
      this.logger.warn(`Failed to send invoice creation email: ${err.message}`);
    }

    this.logger.log(
      `Invoice created: ${invoiceNumber} $${dto.amountUsd} autoCashout=${dto.autoCashout ?? false} userId=${userId}`,
    );

    return invoice;
  }

  // ── GET USER INVOICES ─────────────────────────────────────────────────────────
  async findAll(userId: string, query: InvoiceQueryDto) {
    const qb = this.invoiceRepo
      .createQueryBuilder('inv')
      .where('inv.user_id = :userId', { userId })
      .orderBy('inv.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.status) {
      qb.andWhere('inv.status = :status', { status: query.status });
    }

    const [invoices, total] = await qb.getManyAndCount();

    return {
      data: invoices,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  // ── GET SINGLE INVOICE ────────────────────────────────────────────────────────
  async findOne(invoiceId: string, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, userId },
      relations: ['items'],
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  // ── GET PUBLIC PAYMENT PAGE (no auth — client-facing) ─────────────────────────
  async getPublicPaymentPage(invoiceId: string): Promise<{
    invoice: Partial<Invoice>;
    autoCashout: boolean;
    bankAccountLastFour: string | null;
    bankName: string | null;
  }> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ['items'],
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    if (
      invoice.status === InvoiceStatus.CANCELLED ||
      invoice.status === InvoiceStatus.EXPIRED
    ) {
      throw new BadRequestException(
        `This invoice is ${invoice.status}. Please request a new payment link.`,
      );
    }

    // Only show safe public fields to the client — no internal IDs
    const publicInvoice: Partial<Invoice> = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      title: invoice.title,
      clientName: invoice.clientName,
      amountUsd: invoice.amountUsd,
      status: invoice.status,
      selectedCoin: invoice.selectedCoin,
      cryptoAmount: invoice.cryptoAmount,
      paymentAddress: invoice.paymentAddress,
      qrCodeUrl: invoice.qrCodeUrl,
      expiresAt: invoice.expiresAt,
      paidAt: invoice.paidAt,
    };

    // Show bank info to assure client where money goes (builds trust)
    let bankAccountLastFour: string | null = null;
    let bankName: string | null = null;

    if (invoice.autoCashout && invoice.autoCashoutBankAccountId) {
      const bank = await this.bankAccountRepo.findOne({
        where: { id: invoice.autoCashoutBankAccountId },
      });
      if (bank) {
        bankAccountLastFour = bank.accountNumber.slice(-4);
        bankName = bank.bankName;
      }
    }

    return {
      invoice: publicInvoice,
      autoCashout: invoice.autoCashout,
      bankAccountLastFour,
      bankName,
    };
  }

  // ── UPDATE INVOICE ────────────────────────────────────────────────────────────
  async update(
    invoiceId: string,
    userId: string,
    dto: UpdateInvoiceDto,
  ): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, userId },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only draft invoices can be updated');
    }

    // Handle auto-cashout bank account change
    let autoCashoutBankAccountId = invoice.autoCashoutBankAccountId;

    if (dto.autoCashout !== undefined) {
      if (dto.autoCashout) {
        const bankId = dto.autoCashoutBankAccountId;
        if (bankId) {
          const bank = await this.bankAccountRepo.findOne({
            where: { id: bankId, userId, isVerified: true },
          });
          if (!bank)
            throw new BadRequestException(
              'Bank account not found or not verified',
            );
          autoCashoutBankAccountId = bank.id;
        } else {
          const defaultBank = await this.bankAccountRepo.findOne({
            where: { userId, isDefault: true, isVerified: true },
          });
          if (!defaultBank)
            throw new BadRequestException(
              'No verified default bank account found',
            );
          autoCashoutBankAccountId = defaultBank.id;
        }
      } else {
        autoCashoutBankAccountId = null;
      }
    }

    await this.invoiceRepo.update(invoiceId, {
      ...(dto.title && { title: dto.title }),
      ...(dto.clientName !== undefined && { clientName: dto.clientName }),
      ...(dto.clientEmail !== undefined && { clientEmail: dto.clientEmail }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.autoCashout !== undefined && { autoCashout: dto.autoCashout }),
      autoCashoutBankAccountId,
    });

    return (await this.invoiceRepo.findOne({
      where: { id: invoiceId },
    })) as Invoice;
  }

  // ── CANCEL INVOICE ────────────────────────────────────────────────────────────
  async cancel(
    invoiceId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, userId },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID)
      throw new BadRequestException('Paid invoices cannot be cancelled');
    if (invoice.status === InvoiceStatus.CANCELLED)
      throw new BadRequestException('Invoice is already cancelled');

    await this.invoiceRepo.update(invoiceId, {
      status: InvoiceStatus.CANCELLED,
    });
    await this.saveAudit(
      userId,
      AuditActorType.USER,
      'invoice.cancelled',
      'invoices',
      invoiceId,
    );

    // ── Notify user ──────────────────────────────────────────────────────────────
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['email', 'firstName'],
    });

    if (user) {
      try {
        await this.emailService.sendInvoiceCancelled(user.email, {
          firstName: user.firstName,
          invoiceNumber: invoice.invoiceNumber,
          amountUsd: Number(invoice.amountUsd),
        });
      } catch (err) {
        this.logger.warn(`Failed to send cancellation email: ${err.message}`);
      }
    }

    return { message: 'Invoice cancelled successfully' };
  }

  // ── ADMIN: GET ALL INVOICES ───────────────────────────────────────────────────
  async adminGetAll(query: InvoiceQueryDto) {
    const qb = this.invoiceRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.user', 'u')
      .orderBy('inv.createdAt', 'DESC')
      .skip(((query.page ?? 1) - 1) * (query.limit ?? 20))
      .take(query.limit ?? 20);

    if (query.status) {
      qb.andWhere('inv.status = :status', { status: query.status });
    }

    const [invoices, total] = await qb.getManyAndCount();

    return {
      data: invoices,
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      totalPages: Math.ceil(total / (query.limit ?? 20)),
    };
  }

  // ── GET INVOICE STATS ─────────────────────────────────────────────────────────
  async getStats(userId: string) {
    const stats = await this.invoiceRepo
      .createQueryBuilder('inv')
      .select('inv.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(inv.amount_usd)', 'totalUsd')
      .where('inv.user_id = :userId', { userId })
      .groupBy('inv.status')
      .getRawMany();

    const autoCashoutCount = await this.invoiceRepo.count({
      where: { userId, autoCashout: true },
    });

    return { byStatus: stats, autoCashoutEnabled: autoCashoutCount };
  }

  // ── PRIVATE HELPERS ───────────────────────────────────────────────────────────
  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();

    // Use a DB sequence approach — find the last invoice number for this year
    const lastInvoice = await this.invoiceRepo
      .createQueryBuilder('inv')
      .where('inv.invoice_number LIKE :pattern', { pattern: `INV-${year}-%` })
      .orderBy('inv.invoice_number', 'DESC')
      .select('inv.invoice_number', 'invoiceNumber')
      .getRawOne();

    let seq = 1;
    if (lastInvoice?.invoiceNumber) {
      const parts = lastInvoice.invoiceNumber.split('-');
      seq = parseInt(parts[2] ?? '0', 10) + 1;
    }

    return `INV-${year}-${String(seq).padStart(4, '0')}`;
  }

  private async saveAudit(
    userId: string | null,
    actorType: AuditActorType,
    action: string,
    entityType?: string,
    entityId?: string,
    oldValues?: any,
    newValues?: any,
  ) {
    await this.auditRepo.save(
      this.auditRepo.create({
        userId,
        actorType,
        action,
        entityType,
        entityId,
        oldValues: oldValues ?? null,
        newValues: newValues ?? null,
      }),
    );
  }
}
