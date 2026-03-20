import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPinAnd2FAMethod1774096546004 implements MigrationInterface {
  name = 'AddPinAnd2FAMethod1774096546004';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // Applied directly via psql — columns already exist in DB
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_pin_set"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "pin_hash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "email_otp_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "email_otp"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "two_fa_method"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."users_two_fa_method_enum"`,
    );
  }
}
