import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated } from '../auth/core/authenticated.decorator';
import type { AuthenticatedUser } from '../auth/core/authenticated-user';
import { CurrentUser } from '../auth/core/current-user.decorator';
import { Role } from '../auth/core/roles';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/swagger/decorators';
import { ALL_PERMISSIONS, permissionsOf } from './permissions';

export class MyPermissionsDto {
  @ApiProperty({ enum: Role, example: Role.admin })
  role!: Role;

  @ApiProperty({
    type: [String],
    enum: ALL_PERMISSIONS,
    example: ['users.read', 'users.invite'],
    description: 'Permissions held by your role (from the central matrix)',
  })
  permissions!: string[];
}

@ApiTags('rbac')
@ApiBearerAuth()
@Controller('rbac')
export class RbacController {
  @Get('permissions')
  @Authenticated()
  @ApiOperation({
    summary: 'Your role and permissions',
    description:
      'Lets a frontend show or hide actions without duplicating the matrix.',
  })
  @ApiOkEnvelope(MyPermissionsDto)
  @ApiErrorResponses(401)
  mine(@CurrentUser() actor: AuthenticatedUser): MyPermissionsDto {
    return { role: actor.role, permissions: permissionsOf(actor.role) };
  }
}
