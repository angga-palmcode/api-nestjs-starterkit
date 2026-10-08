import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExampleItem } from '@prisma/client';

/**
 * Response DTO. Rules to copy:
 *  - every property has `@ApiProperty({ example })` with a realistic value, never a bare type;
 *  - the DTO is an explicit allow-list: map rows through `toExampleItemDto`, never return a Prisma row.
 */
export class ExampleItemDto {
  @ApiProperty({ example: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  id!: string;

  @ApiProperty({ example: 'Quarterly report' })
  name!: string;

  @ApiPropertyOptional({
    example: 'Draft of the Q3 numbers for review',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({
    example: false,
    description: 'Unpublished items are visible to admins only',
  })
  is_published!: boolean;

  @ApiProperty({ example: '2026-10-08T09:30:00.000Z' })
  created_at!: Date;

  @ApiProperty({ example: '2026-10-08T10:15:00.000Z' })
  updated_at!: Date;

  @ApiPropertyOptional({
    example: 'a0000000-0000-4000-8000-000000000001',
    nullable: true,
    description: 'User who created the item',
  })
  created_by!: string | null;
}

export function toExampleItemDto(item: ExampleItem): ExampleItemDto {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    is_published: item.is_published,
    created_at: item.created_at,
    updated_at: item.updated_at,
    created_by: item.created_by,
  };
}
