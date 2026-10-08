import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedEnvelope,
  ApiCreatedEnvelope,
  ApiErrorResponses,
} from '../common/swagger/decorators';
import { UserDto } from '../users/dto/user.dto';
import { AccountService } from './account.service';
import type { AuthenticatedUser } from './core/authenticated-user';
import { CurrentUser } from './core/current-user.decorator';
import { Public } from './core/public.decorator';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth-requests.dto';
import { Audited } from '../audit/audited.decorator';
import { Authenticated } from './core/authenticated.decorator';
import { MessageDto } from './dto/auth-responses.dto';

const MINUTE = 60_000;
const ACCEPTED = {
  data: { message: 'If the request can be processed, an email is on its way.' },
};

@ApiTags('auth')
@Controller('auth')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Open self-registration',
    description:
      'Only when AUTH_ALLOW_REGISTRATION=true (otherwise 404). Always answers 202 so it cannot be used to discover existing accounts.',
  })
  @ApiAcceptedEnvelope(MessageDto)
  @ApiErrorResponses(404, 422, 429)
  async register(@Body() dto: RegisterDto) {
    await this.accounts.register(dto);
    return ACCEPTED.data;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Resend the email verification link' })
  @ApiAcceptedEnvelope(MessageDto)
  @ApiErrorResponses(422, 429)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.accounts.resendVerification(dto.email);
    return ACCEPTED.data;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm an email address with the emailed token' })
  @ApiNoContentResponse({ description: 'Email verified (idempotent)' })
  @ApiErrorResponses(400, 422, 429)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.accounts.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always answers 202, whether or not the address is registered.',
  })
  @ApiAcceptedEnvelope(MessageDto)
  @ApiErrorResponses(422, 429)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.accounts.forgotPassword(dto.email);
    return ACCEPTED.data;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password with the emailed token',
    description: 'Signs the user out everywhere. The token works once.',
  })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiErrorResponses(400, 422, 429)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.accounts.resetPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('accept-invite')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Accept an invitation and set a password',
    description: 'The invitation token works once. Sign in afterwards.',
  })
  @ApiCreatedEnvelope(UserDto)
  @ApiErrorResponses(400, 409, 422, 429)
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.accounts.acceptInvite(dto);
  }

  @Post('change-password')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({
    summary: 'Change your password',
    description: 'Signs you out of every device, including this one.',
  })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiErrorResponses(401, 422, 429)
  @Audited('auth.password_changed', 'user')
  changePassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.accounts.changePassword(actor, dto);
  }
}
