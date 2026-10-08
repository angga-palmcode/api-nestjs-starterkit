import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';

export class UserDto {
  @ApiProperty({ example: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  id!: string;

  @ApiProperty({ example: 'ani.wijaya@example.com' })
  email!: string;

  @ApiProperty({ example: 'Ani Wijaya' })
  name!: string;

  @ApiProperty({ enum: Role, example: Role.admin })
  role!: Role;

  @ApiProperty({ example: true })
  is_active!: boolean;

  @ApiProperty({ example: true, description: 'Whether the email was verified' })
  email_verified!: boolean;

  @ApiProperty({ example: false })
  mfa_enabled!: boolean;

  @ApiPropertyOptional({ example: '2026-10-08T09:30:00.000Z', nullable: true })
  last_login_at!: Date | null;

  @ApiProperty({ example: '2026-09-01T08:00:00.000Z' })
  created_at!: Date;

  @ApiProperty({ example: '2026-10-01T12:00:00.000Z' })
  updated_at!: Date;
}

/** Explicit mapping: password hashes, lockout counters and token versions never leave the service. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    is_active: user.is_active,
    email_verified: user.email_verified_at !== null,
    mfa_enabled: user.mfa_enabled,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}
