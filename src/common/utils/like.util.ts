/**
 * Escapes LIKE wildcards so user input is matched literally. Prisma passes
 * `contains` values through as LIKE patterns, so a bare "%" or "_" would act as a wildcard.
 * PostgreSQL's default LIKE escape character is the backslash.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
