import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Audited } from '../audit/audited.decorator';
import { Authenticated } from './core/authenticated.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApiCreatedEnvelope,
  ApiErrorResponses,
  ApiOkEnvelope,
} from '../common/swagger/decorators';
import type { AuthenticatedUser } from './core/authenticated-user';
import { CurrentUser } from './core/current-user.decorator';
import { TotpConfirmDto, TotpDisableDto } from './dto/auth-requests.dto';
import { RecoveryCodesDto, TotpSetupDto } from './dto/auth-responses.dto';
import { MfaService } from './mfa.service';

const MINUTE = 60_000;

/** TOTP management. Every route answers 404 unless AUTH_MFA=totp. */
@ApiTags('auth')
@ApiBearerAuth()
@Authenticated()
@Controller('auth/mfa/totp')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly prisma: PrismaService,
  ) {}

  private user(actor: AuthenticatedUser) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({
    summary: 'Start TOTP enrolment',
    description:
      'Returns a pending secret and an otpauth URI. Nothing is active until the first code is confirmed; calling it again only replaces the pending secret.',
  })
  @ApiOkEnvelope(TotpSetupDto)
  @ApiErrorResponses(401, 404, 409, 429)
  async setup(@CurrentUser() actor: AuthenticatedUser) {
    return this.mfa.setup(await this.user(actor));
  }

  @Post('confirm')
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({
    summary: 'Confirm TOTP enrolment',
    description:
      'Activates two-factor authentication and returns the recovery codes (shown once).',
  })
  @ApiCreatedEnvelope(RecoveryCodesDto)
  @ApiErrorResponses(400, 401, 404, 409, 422, 429)
  @Audited('auth.mfa_enabled', 'user')
  async confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: TotpConfirmDto,
  ): Promise<RecoveryCodesDto> {
    return {
      recovery_codes: await this.mfa.confirm(await this.user(actor), dto.code),
    };
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({
    summary: 'Disable TOTP',
    description:
      'Needs your password and a current authenticator or recovery code.',
  })
  @ApiNoContentResponse({ description: 'Two-factor authentication disabled' })
  @ApiErrorResponses(400, 401, 404, 422, 429)
  @Audited('auth.mfa_disabled', 'user')
  async disable(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: TotpDisableDto,
  ): Promise<void> {
    await this.mfa.disable(await this.user(actor), dto.password, dto.code);
  }

  @Post('recovery-codes')
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({
    summary: 'Regenerate recovery codes',
    description:
      'Invalidates all previous codes. Needs a current authenticator code.',
  })
  @ApiCreatedEnvelope(RecoveryCodesDto)
  @ApiErrorResponses(400, 401, 404, 422, 429)
  @Audited('auth.recovery_codes_regenerated', 'user')
  async recoveryCodes(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: TotpConfirmDto,
  ): Promise<RecoveryCodesDto> {
    return {
      recovery_codes: await this.mfa.regenerateRecoveryCodes(
        await this.user(actor),
        dto.code,
      ),
    };
  }
}
