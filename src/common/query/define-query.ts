import { ErrorCode } from '../errors/error-code';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPaginationMeta,
  PaginatedResult,
} from '../envelope/envelope.types';
import { escapeLike } from '../utils/like.util';
import { invalidQuery, unknownParameter } from './query-errors';
import type {
  Fragment,
  ParseOptions,
  ParsedQuery,
  QueryDefinitionConfig,
  QueryDescription,
  RawQuery,
} from './query.types';

const MAX_SEARCH = 100;
const MAX_SORT_KEYS = 3;
const MAX_SKIP = 2_147_483_647; // Prisma's Int
const INT = /^\d+$/;

const has = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export interface QueryDefinition<W, O = Fragment, I = Fragment> {
  parse(raw?: RawQuery, options?: ParseOptions<W>): ParsedQuery<W, O, I>;
  /** Everything the definition accepts, for Swagger (`@ApiQueryFrom`). */
  describe(): QueryDescription;
}

/** Reads a parameter that must be a single string (arrays from repeated params are rejected). */
function text(raw: unknown, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string')
    throw invalidQuery(name, 'must be a single value');
  return raw.trim();
}

function positiveInt(raw: unknown, name: string): number | undefined {
  const value = text(raw, name);
  if (value === undefined) return undefined;
  if (
    !INT.test(value) ||
    Number(value) < 1 ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw invalidQuery(name, 'must be a positive integer');
  }
  return Number(value);
}

function nest(path: string, direction: 'asc' | 'desc'): Fragment {
  return path
    .split('.')
    .reduceRight<unknown>(
      (inner, segment) => ({ [segment]: inner }),
      direction,
    ) as Fragment;
}

/**
 * One definition per entity (Blueprint A7): whitelists for filters, sorts and includes,
 * the search columns and the paging limits. `parse()` turns `?filter[..]&sort&include&search&page`
 * into Prisma arguments; anything not whitelisted is a 400. Swagger parameters are generated
 * from the same object, so validation and documentation cannot drift.
 */
export function defineQuery<
  W extends object = Record<string, unknown>,
  O = Fragment,
  I = Fragment,
>(config: QueryDefinitionConfig): QueryDefinition<W, O, I> {
  const sorts = config.sorts;
  const includes = config.includes ?? [];
  const search = config.search ?? [];
  const softDelete = config.softDelete ?? true;
  const tiebreaker = config.tiebreaker ?? 'id';
  const defaultPageSize = config.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = config.maxPageSize ?? MAX_PAGE_SIZE;
  const maxIncludeDepth = config.maxIncludeDepth ?? 2;
  const defaultSort = config.defaultSort ?? tiebreaker;

  for (const name of includes) {
    if (name.split('.').length > maxIncludeDepth) {
      throw new Error(
        `include "${name}" exceeds the maximum depth of ${maxIncludeDepth}`,
      );
    }
  }

  const parseSort = (value: string, strict: boolean) => {
    const tokens = value.split(',').map((t) => t.trim());
    if (tokens.length > MAX_SORT_KEYS) {
      throw invalidQuery('sort', `at most ${MAX_SORT_KEYS} sort fields`);
    }
    const keys: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
    for (const token of tokens) {
      if (!token || token === '-') {
        throw invalidQuery('sort', 'contains an empty field');
      }
      const direction = token.startsWith('-') ? 'desc' : 'asc';
      const field = direction === 'desc' ? token.slice(1) : token;
      if (!sorts.includes(field)) {
        if (!strict) {
          throw new Error(
            `defaultSort "${value}" uses "${field}", which is not in sorts`,
          );
        }
        throw unknownParameter(
          ErrorCode.UNKNOWN_SORT,
          'sort',
          `sort field "${field}"`,
          sorts,
        );
      }
      if (!keys.some((k) => k.field === field)) keys.push({ field, direction });
    }
    return keys;
  };

  // Fail at start-up, not on the first request.
  const defaultKeys = config.defaultSort
    ? parseSort(config.defaultSort, false)
    : [{ field: tiebreaker, direction: 'asc' as const }];

  const buildOrderBy = (keys: typeof defaultKeys): Fragment[] => {
    const orderBy = keys.map((k) => nest(k.field, k.direction));
    if (!keys.some((k) => k.field === tiebreaker)) {
      orderBy.push(nest(tiebreaker, keys[0].direction));
    }
    return orderBy;
  };

  const buildInclude = (value: string): Fragment => {
    type Node = { [name: string]: Node };
    const tree: Node = {};
    for (const name of value
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)) {
      if (!includes.includes(name)) {
        throw unknownParameter(
          ErrorCode.UNKNOWN_INCLUDE,
          'include',
          `include "${name}"`,
          includes,
        );
      }
      let node = tree;
      for (const segment of name.split('.')) node = node[segment] ??= {};
    }
    // `owner` -> true; `owner.team` -> { include: { team: true } }
    const toPrisma = (node: Node): Fragment =>
      Object.fromEntries(
        Object.entries(node).map(([key, child]) => [
          key,
          Object.keys(child).length === 0 ? true : { include: toPrisma(child) },
        ]),
      );
    return toPrisma(tree);
  };

  return {
    parse(
      raw: RawQuery = {},
      options: ParseOptions<W> = {},
    ): ParsedQuery<W, O, I> {
      const conditions: Fragment[] = [];
      if (options.scope) conditions.push(options.scope as Fragment);
      if (softDelete && !options.withTrashed)
        conditions.push({ deleted_at: null });

      // filter[...]
      const rawFilter = raw.filter;
      if (rawFilter !== undefined) {
        if (
          rawFilter === null ||
          typeof rawFilter !== 'object' ||
          Array.isArray(rawFilter)
        ) {
          throw invalidQuery('filter', 'must look like filter[name]=value');
        }
        for (const [key, value] of Object.entries(rawFilter)) {
          if (!has(config.filters, key)) {
            throw unknownParameter(
              ErrorCode.UNKNOWN_FILTER,
              `filter[${key}]`,
              `filter "${key}"`,
              Object.keys(config.filters),
            );
          }
          const fragment = config.filters[key].apply(value, key);
          if (fragment) conditions.push(fragment);
        }
      }

      // search=...
      const term = text(raw.search, 'search');
      if (term && search.length > 0) {
        if (term.length > MAX_SEARCH) {
          throw invalidQuery('search', `at most ${MAX_SEARCH} characters`);
        }
        const pattern = escapeLike(term);
        conditions.push({
          OR: search.map((field) => ({
            [field]: { contains: pattern, mode: 'insensitive' },
          })),
        });
      }

      // sort=...
      const sortText = text(raw.sort, 'sort');
      const orderBy = buildOrderBy(
        sortText ? parseSort(sortText, true) : defaultKeys,
      ) as O[];

      // include=...
      const includeText = text(raw.include, 'include');
      const include = (includeText ? buildInclude(includeText) : undefined) as
        I | undefined;
      const hasInclude =
        include !== undefined && Object.keys(include as object).length > 0;

      // page / page_size
      const page = positiveInt(raw.page, 'page') ?? 1;
      const requested =
        positiveInt(raw.page_size, 'page_size') ?? defaultPageSize;
      const page_size = Math.min(requested, maxPageSize);
      const skip = (page - 1) * page_size;
      if (skip > MAX_SKIP) throw invalidQuery('page', 'is too large');

      const where = (conditions.length ? { AND: conditions } : {}) as W;
      const args = {
        where,
        orderBy,
        ...(hasInclude ? { include } : {}),
        skip,
        take: page_size,
      };
      return {
        where,
        orderBy,
        include: hasInclude ? include : undefined,
        skip,
        take: page_size,
        page,
        page_size,
        args,
        paginate: <T>(items: T[], total: number) =>
          new PaginatedResult(
            items,
            buildPaginationMeta(page, page_size, total),
          ),
      };
    },

    describe(): QueryDescription {
      return {
        filters: Object.entries(config.filters).map(([key, f]) => ({
          key,
          kind: f.kind,
          description: f.description,
          example: f.example,
          enum: f.enum,
        })),
        sorts,
        defaultSort,
        includes,
        search,
        defaultPageSize,
        maxPageSize,
      };
    },
  };
}
