import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class InviteUserDto {
  @ApiProperty({ example: 'budi.santoso@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: 'Budi Santoso' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ enum: Role, example: Role.user })
  @IsEnum(Role)
  role!: Role;
}

export class InvitationDto {
  @ApiProperty({ example: '6fa459ea-ee8a-3ca4-894e-db77e160355e' })
  id!: string;

  @ApiProperty({ example: 'budi.santoso@example.com' })
  email!: string;

  @ApiProperty({ enum: Role, example: Role.user })
  role!: Role;

  @ApiProperty({ example: '2026-10-11T09:30:00.000Z' })
  expires_at!: Date;

  @ApiProperty({ example: '2026-10-08T09:30:00.000Z' })
  created_at!: Date;
}
