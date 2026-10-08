import { ApiProperty } from '@nestjs/swagger';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export class PaginationMeta {
  @ApiProperty({ example: 2, description: '1-based page number' })
  current_page!: number;

  @ApiProperty({ example: 25 })
  page_size!: number;

  @ApiProperty({ example: 137, description: 'Total rows matching the query' })
  total!: number;

  @ApiProperty({ example: 6, description: 'Last page number; never below 1' })
  last_page!: number;
}

/** Return this from a handler to get `{ data: [...], meta }` instead of `{ data }`. */
export class PaginatedResult<T> {
  constructor(
    readonly data: T[],
    readonly meta: PaginationMeta,
  ) {}
}

export function buildPaginationMeta(
  page: number,
  page_size: number,
  total: number,
): PaginationMeta {
  return {
    current_page: page,
    page_size,
    total,
    last_page: Math.max(1, Math.ceil(total / page_size)),
  };
}

export function paginated<T>(
  data: T[],
  page: { page: number; page_size: number; total: number },
): PaginatedResult<T> {
  return new PaginatedResult(
    data,
    buildPaginationMeta(page.page, page.page_size, page.total),
  );
}

export function toSkipTake(
  page: number,
  page_size: number,
): { skip: number; take: number } {
  return { skip: (page - 1) * page_size, take: page_size };
}
