import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import { decryptSecret, encryptSecret } from '../common/utils/crypto.util';
import { verifyPassword } from '../common/utils/password.util';
import { hashToken } from '../common/utils/token.util';
import { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import {
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from './totp/totp.util';

const RECOVERY_CODE_COUNT = 10;

export interface TotpSetup {
  secret: string;
  otpauth_uri: string;
}

/**
 * TOTP enrolment and verification. Avoids three common TOTP flaws:
 * replay protection (last accepted step), atomic single-use recovery codes, and a
 * separate pending secret so a repeated /setup cannot clobber an active one.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  private get key(): string {
    const key = this.config.get('AUTH_MFA_ENCRYPTION_KEY', { infer: true });
    if (!key) throw new Error('AUTH_MFA_ENCRYPTION_KEY is not configured');
    return key;
  }

  private assertTotpMode(): void {
    if (this.config.get('AUTH_MFA', { infer: true }) !== 'totp') {
      throw new AppException(ErrorCode.NOT_FOUND, 'Not found');
    }
  }

  async setup(user: User): Promise<TotpSetup> {
    this.assertTotpMode();
    if (user.mfa_enabled) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'Two-factor authentication is already enabled',
      );
    }
    const secret = generateTotpSecret();
    const pending = encryptSecret(secret, this.key);
    await this.prisma.mfaSecret.upsert({
      where: { user_id: user.id },
      create: { user_id: user.id, pending_secret: pending },
      update: { pending_secret: pending },
    });
    return {
      secret,
      otpauth_uri: otpauthUri({
        secret,
        issuer: this.config.get('APP_NAME', { infer: true }),
        account: user.email,
      }),
    };
  }

  /** Verifies the first code against the pending secret, then activates MFA and returns the recovery codes (shown once). */
  async confirm(user: User, code: string): Promise<string[]> {
    this.assertTotpMode();
    if (user.mfa_enabled) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'Two-factor authentication is already enabled',
      );
    }
    const record = await this.prisma.mfaSecret.findUnique({
      where: { user_id: user.id },
    });
    if (!record?.pending_secret) {
      throw new AppException(
        ErrorCode.BAD_REQUEST,
        'Start the setup first (POST /auth/mfa/totp/setup)',
      );
    }
    const step = verifyTotp(
      decryptSecret(record.pending_secret, this.key),
      code,
    );
    if (step === null) {
      throw new AppException(
        ErrorCode.INVALID_CODE,
        'Invalid authenticator code',
      );
    }
    const recovery = this.newRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.mfaSecret.update({
        where: { user_id: user.id },
        data: {
          secret: record.pending_secret,
          pending_secret: null,
          confirmed_at: new Date(),
          last_used_step: step,
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { mfa_enabled: true },
      }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { user_id: user.id } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: recovery.map((c) => ({
          user_id: user.id,
          code_hash: this.hashRecovery(user.id, c),
        })),
      }),
    ]);
    return recovery;
  }

  async disable(user: User, password: string, code: string): Promise<void> {
    this.assertTotpMode();
    if (!user.mfa_enabled) {
      throw new AppException(
        ErrorCode.BAD_REQUEST,
        'Two-factor authentication is not enabled',
      );
    }
    if (
      !user.password_hash ||
      !(await verifyPassword(password, user.password_hash))
    ) {
      throw new AppException(
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid credentials',
      );
    }
    if (!(await this.verifyCode(user, code))) {
      throw new AppException(
        ErrorCode.INVALID_CODE,
        'Invalid authenticator code',
      );
    }
    await this.prisma.$transaction([
      this.prisma.mfaSecret.deleteMany({ where: { user_id: user.id } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { user_id: user.id } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { mfa_enabled: false },
      }),
    ]);
  }

  async regenerateRecoveryCodes(user: User, code: string): Promise<string[]> {
    this.assertTotpMode();
    if (!user.mfa_enabled) {
      throw new AppException(
        ErrorCode.BAD_REQUEST,
        'Two-factor authentication is not enabled',
      );
    }
    if (!/^\d{6}$/.test(code) || !(await this.verifyCode(user, code))) {
      throw new AppException(
        ErrorCode.INVALID_CODE,
        'Invalid authenticator code',
      );
    }
    const recovery = this.newRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { user_id: user.id } }),
      this.prisma.mfaRecoveryCode.createMany({
        data: recovery.map((c) => ({
          user_id: user.id,
          code_hash: this.hashRecovery(user.id, c),
        })),
      }),
    ]);
    return recovery;
  }

  /** A 6-digit authenticator code or a recovery code. Never throws for a wrong code. */
  async verifyCode(user: User, code: string): Promise<boolean> {
    if (!user.mfa_enabled) return false;
    return /^\d{6}$/.test(code.trim())
      ? this.verifyTotpCode(user, code.trim())
      : this.redeemRecoveryCode(user, code);
  }

  private async verifyTotpCode(user: User, code: string): Promise<boolean> {
    const record = await this.prisma.mfaSecret.findUnique({
      where: { user_id: user.id },
    });
    if (!record?.secret) return false;
    const step = verifyTotp(decryptSecret(record.secret, this.key), code);
    if (step === null) return false;
    // Replay protection: a step can be accepted once; concurrent submissions race on this update.
    const claimed = await this.prisma.mfaSecret.updateMany({
      where: {
        id: record.id,
        OR: [{ last_used_step: null }, { last_used_step: { lt: step } }],
      },
      data: { last_used_step: step },
    });
    return claimed.count === 1;
  }

  private async redeemRecoveryCode(user: User, code: string): Promise<boolean> {
    const normalized = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (normalized.length !== 10) return false;
    const redeemed = await this.prisma.mfaRecoveryCode.updateMany({
      where: {
        user_id: user.id,
        code_hash: this.hashRecovery(user.id, normalized),
        used_at: null,
      },
      data: { used_at: new Date() },
    });
    return redeemed.count === 1;
  }

  /** 10 codes like `ABCDE-FGHIJ` (50 bits each), stored only as hashes. */
  private newRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = base32Encode(randomBytes(7)).slice(0, 10);
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
  }

  private hashRecovery(userId: string, code: string): string {
    return hashToken(
      `${userId}:${code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`,
    );
  }
}
