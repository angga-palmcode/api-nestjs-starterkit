import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Audited } from '../audit/audited.decorator';
import { Authenticated } from './core/authenticated.decorator';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/swagger/decorators';
import { UserDto } from '../users/dto/user.dto';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './core/authenticated-user';
import { Meta } from './core/client-meta.decorator';
import { CurrentUser } from './core/current-user.decorator';
import { Public } from './core/public.decorator';
import type { ClientMeta } from './core/session.service';
import {
  LoginDto,
  RefreshDto,
  UpdateMeDto,
  VerifyMfaDto,
  VerifyOtpDto,
} from './dto/auth-requests.dto';
import {
  LOGIN_EXAMPLES,
  LoginResponseDto,
  SessionDto,
  TokenPairDto,
} from './dto/auth-responses.dto';

const MINUTE = 60_000;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in (step 1 of the login state machine)',
    description:
      'Send `email` + `password`. Depending on AUTH_METHODS / AUTH_MFA the response is `authenticated`, `otp_required` or `mfa_required`; the shape is always the same. Omit `password` to start a passwordless email-code login (needs AUTH_METHODS to include otp).',
  })
  @ApiOkEnvelope(LoginResponseDto, { examples: LOGIN_EXAMPLES })
  @ApiErrorResponses(401, 403, 422, 429)
  login(@Body() dto: LoginDto, @Meta() meta: ClientMeta) {
    return this.auth.login(dto, meta);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('login/otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit the emailed login code (state `otp_required`)',
  })
  @ApiOkEnvelope(LoginResponseDto, { examples: LOGIN_EXAMPLES })
  @ApiErrorResponses(401, 403, 422, 429)
  verifyOtp(@Body() dto: VerifyOtpDto, @Meta() meta: ClientMeta) {
    return this.auth.verifyOtp(dto, meta);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit the second factor (state `mfa_required`)',
    description:
      'TOTP mode: authenticator code or a recovery code. OTP mode: the emailed code. The challenge is single use and allows a limited number of attempts.',
  })
  @ApiOkEnvelope(LoginResponseDto, { examples: LOGIN_EXAMPLES })
  @ApiErrorResponses(401, 403, 422, 429)
  verifyMfa(@Body() dto: VerifyMfaDto, @Meta() meta: ClientMeta) {
    return this.auth.verifyMfa(dto, meta);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Each refresh token works once. Presenting an already-used one revokes the whole session.',
  })
  @ApiOkEnvelope(TokenPairDto)
  @ApiErrorResponses(401, 422, 429)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out of the current session' })
  @ApiNoContentResponse({ description: 'Session revoked' })
  @ApiErrorResponses(401)
  @Audited('auth.logout', 'user_session')
  logout(@CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.auth.logout(actor);
  }

  @Post('logout-all')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out of every session on every device' })
  @ApiNoContentResponse({ description: 'All sessions revoked' })
  @ApiErrorResponses(401)
  @Audited('auth.logout_all', 'user')
  logoutAll(@CurrentUser() actor: AuthenticatedUser): Promise<void> {
    return this.auth.logoutAll(actor);
  }

  @Get('me')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiOkEnvelope(UserDto)
  @ApiErrorResponses(401)
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.auth.me(actor);
  }

  @Patch('me')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your own profile' })
  @ApiOkEnvelope(UserDto)
  @ApiErrorResponses(401, 422)
  @Audited('auth.profile_updated', 'user')
  updateMe(@CurrentUser() actor: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(actor, dto.name);
  }

  @Get('sessions')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Your active sessions' })
  @ApiOkEnvelope(SessionDto, { isArray: true })
  @ApiErrorResponses(401)
  sessions(@CurrentUser() actor: AuthenticatedUser) {
    return this.auth.listSessions(actor);
  }

  @Delete('sessions/:id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke one of your sessions' })
  @ApiNoContentResponse({ description: 'Session revoked' })
  @ApiErrorResponses(400, 401, 404)
  @Audited('auth.session_revoked', 'user_session')
  revokeSession(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.auth.revokeSession(actor, id);
  }
}
