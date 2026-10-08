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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../audit/audited.decorator';
import { Permissions } from '../rbac/rbac.decorators';
import type { AuthenticatedUser } from '../auth/core/authenticated-user';
import { CurrentUser } from '../auth/core/current-user.decorator';
import { PaginatedResult } from '../common/envelope/envelope.types';
import { ApiQueryFrom, type RawQuery } from '../common/query';
import {
  ApiCreatedEnvelope,
  ApiErrorResponses,
  ApiOkEnvelope,
  ApiPaginatedEnvelope,
} from '../common/swagger/decorators';
import { InvitationDto, InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserDto } from './dto/user.dto';
import { userQuery } from './users.query';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions('users.read')
  @ApiOperation({
    summary: 'List users',
    description:
      'Filter, search, sort and paginate. Unknown filters, sort fields or includes are a 400.',
  })
  @ApiQueryFrom(userQuery)
  @ApiPaginatedEnvelope(UserDto)
  @ApiErrorResponses(400, 401, 403)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: RawQuery,
  ): Promise<PaginatedResult<UserDto>> {
    return this.users.list(actor, query);
  }

  @Post('invitations')
  @Permissions('users.invite')
  @ApiOperation({
    summary: 'Invite a user by email',
    description:
      'Only roles strictly below your own can be assigned. A new invitation supersedes any pending one for the same email.',
  })
  @ApiCreatedEnvelope(InvitationDto)
  @ApiErrorResponses(401, 403, 409, 422)
  @Audited('user.invite', 'user_invitation')
  invite(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: InviteUserDto,
  ): Promise<InvitationDto> {
    return this.users.invite(actor, dto);
  }

  @Get(':id')
  @Permissions('users.read')
  @ApiOperation({ summary: 'Get a user' })
  @ApiOkEnvelope(UserDto)
  @ApiErrorResponses(400, 401, 403, 404)
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDto> {
    return this.users.get(actor, id);
  }

  @Patch(':id')
  @Permissions('users.update')
  @ApiOperation({ summary: 'Update a user name or role' })
  @ApiOkEnvelope(UserDto)
  @ApiErrorResponses(400, 401, 403, 404, 422)
  @Audited('user.update', 'user')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    return this.users.update(actor, id, dto);
  }

  @Post(':id/activate')
  @Permissions('users.activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a user and clear their lockout' })
  @ApiOkEnvelope(UserDto)
  @ApiErrorResponses(400, 401, 403, 404)
  @Audited('user.activate', 'user')
  activate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDto> {
    return this.users.activate(actor, id);
  }

  @Post(':id/deactivate')
  @Permissions('users.deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a user',
    description: 'Also revokes every session and refresh token.',
  })
  @ApiOkEnvelope(UserDto)
  @ApiErrorResponses(400, 401, 403, 404)
  @Audited('user.deactivate', 'user')
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDto> {
    return this.users.deactivate(actor, id);
  }

  @Post(':id/force-logout')
  @Permissions('users.force_logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all sessions and refresh tokens of a user' })
  @ApiNoContentResponse({ description: 'All sessions revoked' })
  @ApiErrorResponses(400, 401, 403, 404)
  @Audited('user.force_logout', 'user')
  forceLogout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.users.forceLogout(actor, id);
  }

  @Delete(':id')
  @Permissions('users.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete a user',
    description: 'The row is kept (deleted_at) and the email stays reserved.',
  })
  @ApiNoContentResponse({ description: 'User deleted' })
  @ApiErrorResponses(400, 401, 403, 404)
  @Audited('user.delete', 'user')
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.users.remove(actor, id);
  }
}
