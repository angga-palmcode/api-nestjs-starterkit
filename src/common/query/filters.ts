import { escapeLike } from '../utils/like.util';
import { invalidQuery } from './query-errors';
import type { Filter, Fragment } from './query.types';

const MAX_TEXT = 100;
const MAX_LIST = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const label = (key: string) => `filter[${key}]`;

/** The value as one trimmed, non-empty string; arrays and nested objects are rejected. */
function single(value: unknown, key: string): string {
  if (typeof value !== 'string') {
    throw invalidQuery(label(key), 'must be a single value');
  }
  const text = value.trim();
  if (!text) throw invalidQuery(label(key), 'must not be empty');
  return text;
}

/** String, or repeated parameter, split on commas. Used by list filters. */
function list(value: unknown, key: string): string[] {
  const parts = Array.isArray(value) ? value : [value];
  const items = parts.flatMap((part) => {
    if (typeof part !== 'string') {
      throw invalidQuery(label(key), 'must be a comma-separated list');
    }
    return part.split(',').map((s) => s.trim());
  });
  const clean = items.filter(Boolean);
  if (clean.length === 0) throw invalidQuery(label(key), 'must not be empty');
  if (clean.length > MAX_LIST) {
    throw invalidQuery(label(key), `at most ${MAX_LIST} values`);
  }
  return clean;
}

type Cast = 'string' | 'number' | 'uuid';

function cast(text: string, how: Cast, key: string): string | number {
  if (how === 'number') {
    const n = Number(text);
    if (!Number.isFinite(n)) throw invalidQuery(label(key), 'must be a number');
    return n;
  }
  if (how === 'uuid' && !UUID.test(text)) {
    throw invalidQuery(label(key), 'must be a UUID');
  }
  return how === 'uuid' ? text.toLowerCase() : text;
}

function checkValues(
  text: string,
  values: readonly string[] | undefined,
  key: string,
): void {
  if (values && !values.includes(text)) {
    throw invalidQuery(label(key), `must be one of: ${values.join(', ')}`);
  }
}

interface ValueOptions {
  /** Prisma field when it differs from the public filter key. */
  field?: string;
  values?: readonly string[];
  cast?: Cast;
  example?: string;
  description?: string;
}

/** `filter[key]=value`: equality on one value. */
export function exact(options: ValueOptions = {}): Filter {
  return {
    kind: 'exact',
    description:
      options.description ??
      (options.values
        ? `Exact match. One of: ${options.values.join(', ')}`
        : 'Exact match'),
    example: options.example ?? options.values?.[0] ?? '',
    enum: options.values,
    apply(value, key) {
      const text = single(value, key);
      checkValues(text, options.values, key);
      return {
        [options.field ?? key]: cast(text, options.cast ?? 'string', key),
      };
    },
  };
}

/** `filter[key]=a,b` (or repeated): the field is any of the values. (The Blueprint's `in`.) */
export function oneOf(options: ValueOptions = {}): Filter {
  return {
    kind: 'one_of',
    description:
      options.description ??
      (options.values
        ? `Any of a comma-separated list. Allowed: ${options.values.join(', ')}`
        : 'Any of a comma-separated list'),
    example:
      options.example ??
      (options.values ? options.values.slice(0, 2).join(',') : 'a,b'),
    // No `enum` here: the parameter takes a comma-separated list, and an OpenAPI enum would
    // render as a single-value dropdown. The allowed values are in the description.
    apply(value, key) {
      const items = list(value, key).map((text) => {
        checkValues(text, options.values, key);
        return cast(text, options.cast ?? 'string', key);
      });
      return { [options.field ?? key]: { in: items } };
    },
  };
}

/** `filter[key]=ani`: case-insensitive "contains"; `%` and `_` are matched literally. */
export function partial(
  options: { field?: string; example?: string } = {},
): Filter {
  return {
    kind: 'partial',
    description: 'Case-insensitive contains',
    example: options.example ?? 'ani',
    apply(value, key) {
      const text = single(value, key);
      if (text.length > MAX_TEXT) {
        throw invalidQuery(label(key), `at most ${MAX_TEXT} characters`);
      }
      return {
        [options.field ?? key]: {
          contains: escapeLike(text),
          mode: 'insensitive',
        },
      };
    },
  };
}

/** `filter[key]=true|false|1|0`. */
export function boolean(
  options: { field?: string; example?: string } = {},
): Filter {
  return {
    kind: 'boolean',
    description: 'true or false',
    example: options.example ?? 'true',
    enum: ['true', 'false'],
    apply(value, key) {
      const text = single(value, key).toLowerCase();
      if (text !== 'true' && text !== 'false' && text !== '1' && text !== '0') {
        throw invalidQuery(label(key), 'must be true or false');
      }
      return { [options.field ?? key]: text === 'true' || text === '1' };
    },
  };
}

function parseBound(text: string, end: boolean, key: string): Date {
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    const start = new Date(Date.UTC(y, m - 1, d));
    // Reject impossible dates such as 2026-02-30 (Date.UTC would roll over).
    if (start.getUTCMonth() !== m - 1 || start.getUTCDate() !== d) {
      throw invalidQuery(label(key), `"${text}" is not a valid date`);
    }
    // A bare date covers the whole UTC day: inclusive on both ends.
    return end ? new Date(start.getTime() + 86_400_000 - 1) : start;
  }
  const parsed = DATE_TIME.test(text) ? new Date(text) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw invalidQuery(
      label(key),
      `"${text}" is not a valid date (use YYYY-MM-DD or an ISO 8601 timestamp)`,
    );
  }
  return parsed;
}

/** `filter[key]=from,to`: inclusive; either end may be empty; bare dates are UTC days. */
export function dateRange(
  field: string,
  options: { example?: string } = {},
): Filter {
  return {
    kind: 'date_range',
    description:
      'Inclusive range `from,to` (YYYY-MM-DD, UTC days, or ISO 8601). Either side may be empty.',
    example: options.example ?? '2026-01-01,2026-01-31',
    apply(value, key) {
      const raw = single(value, key);
      const parts = raw.split(',');
      if (parts.length !== 2) {
        throw invalidQuery(label(key), 'must look like "from,to"');
      }
      const [from, to] = parts.map((p) => p.trim());
      if (!from && !to)
        throw invalidQuery(label(key), 'needs a start or an end');
      const range: { gte?: Date; lte?: Date } = {};
      if (from) range.gte = parseBound(from, false, key);
      if (to) range.lte = parseBound(to, true, key);
      if (range.gte && range.lte && range.gte > range.lte) {
        throw invalidQuery(label(key), 'the start must not be after the end');
      }
      return { [field]: range };
    },
  };
}

/** Anything else: `fn` receives the (trimmed) value or list and returns a where-fragment. */
export function callback(
  fn: (value: string | string[], key: string) => Fragment | undefined,
  meta: { description: string; example: string; values?: readonly string[] },
): Filter {
  return {
    kind: 'callback',
    description: meta.description,
    example: meta.example,
    enum: meta.values,
    apply(value, key) {
      if (Array.isArray(value)) {
        return fn(
          value.map((v) => single(v, key)),
          key,
        );
      }
      return fn(single(value, key), key);
    },
  };
}
