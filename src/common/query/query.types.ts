import type { PaginatedResult } from '../envelope/envelope.types';

/** What `@Query()` hands over: values are strings, arrays (repeated params) or nested objects (`filter[x]`). */
export type RawQuery = Record<string, unknown>;

export type Fragment = Record<string, unknown>;

/** One entry of `filter[key]=value`. */
export interface Filter {
  readonly kind: string;
  /** Shown in Swagger. */
  readonly description: string;
  /** A realistic value, shown in Swagger. */
  readonly example: string;
  readonly enum?: readonly string[];
  /** Turns the raw value into a where-fragment. Throws `INVALID_QUERY` for bad values. */
  apply(value: unknown, key: string): Fragment | undefined;
}

export interface QueryDefinitionConfig {
  /** `filter[key]`: only listed keys are accepted. */
  filters: Record<string, Filter>;
  /** Fields allowed in `sort=`. Dotted names sort by a relation field (`owner.name`). */
  sorts: readonly string[];
  /** e.g. `-created_at`. Defaults to `id` ascending. */
  defaultSort?: string;
  /** Names allowed in `include=`; dotted names are nested relations. */
  includes?: readonly string[];
  /** Fields matched by `search=` (case-insensitive contains, OR-ed). */
  search?: readonly string[];
  /** Hide rows with `deleted_at` set unless `withTrashed`. Default true; set false for tables without `deleted_at`. */
  softDelete?: boolean;
  /** Field used as the final sort key so pages never overlap. Default `id`. */
  tiebreaker?: string;
  defaultPageSize?: number;
  maxPageSize?: number;
  maxIncludeDepth?: number;
}

export interface ParseOptions<W> {
  /** Extra where merged with AND: row-level scoping, and the seam for multi-tenancy. */
  scope?: W;
  /** Include soft-deleted rows. */
  withTrashed?: boolean;
}

export interface FindArgs<W, O = Fragment, I = Fragment> {
  where: W;
  orderBy: O[];
  include?: I;
  skip: number;
  take: number;
}

export interface ParsedQuery<W, O = Fragment, I = Fragment> {
  where: W;
  orderBy: O[];
  include?: I;
  skip: number;
  take: number;
  page: number;
  page_size: number;
  /** Ready for `findMany(q.args)`. */
  args: FindArgs<W, O, I>;
  /** Wraps rows + total into `{ data, meta }`. */
  paginate<T>(items: T[], total: number): PaginatedResult<T>;
}

export interface QueryDescription {
  filters: Array<{
    key: string;
    kind: string;
    description: string;
    example: string;
    enum?: readonly string[];
  }>;
  sorts: readonly string[];
  defaultSort: string;
  includes: readonly string[];
  search: readonly string[];
  defaultPageSize: number;
  maxPageSize: number;
}
