import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Input DTOs are allow-lists too: the global pipe uses `whitelist` + `forbidNonWhitelisted`,
 * so a client cannot send `id`, `created_by`, `deleted_at`... they are rejected with a 422.
 */
export class CreateExampleItemDto {
  @ApiProperty({ example: 'Quarterly report', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: 'Draft of the Q3 numbers for review',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;
}

/** PATCH: every field optional; send `description: null` to clear it. */
export class UpdateExampleItemDto {
  @ApiPropertyOptional({ example: 'Quarterly report v2', maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: 'Final numbers',
    maxLength: 2000,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;
}
