import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { QueryDefinition } from './define-query';

/**
 * Documents every query parameter a definition accepts (`filter[...]`, `sort`, `include`,
 * `search`, `page`, `page_size`), generated from the definition itself so the docs cannot
 * drift from the validation: `@ApiQueryFrom(userQuery)`.
 */
export function ApiQueryFrom<W extends object, O, I>(
  definition: QueryDefinition<W, O, I>,
) {
  const d = definition.describe();
  const decorators = [
    ...d.filters.map((f) =>
      ApiQuery({
        name: `filter[${f.key}]`,
        required: false,
        type: String,
        description: f.description,
        example: f.example,
        ...(f.enum ? { enum: [...f.enum] } : {}),
      }),
    ),
    ApiQuery({
      name: 'sort',
      required: false,
      type: String,
      description: `Comma-separated fields, \`-\` for descending (max 3). Allowed: ${d.sorts.join(', ')}. Default: ${d.defaultSort}`,
      example: d.defaultSort,
    }),
    ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      example: 1,
      description: '1-based page number',
    }),
    ApiQuery({
      name: 'page_size',
      required: false,
      type: Number,
      example: d.defaultPageSize,
      description: `Rows per page (default ${d.defaultPageSize}, capped at ${d.maxPageSize})`,
    }),
  ];
  if (d.search.length > 0) {
    decorators.push(
      ApiQuery({
        name: 'search',
        required: false,
        type: String,
        example: 'ani',
        description: `Case-insensitive match on: ${d.search.join(', ')}`,
      }),
    );
  }
  if (d.includes.length > 0) {
    decorators.push(
      ApiQuery({
        name: 'include',
        required: false,
        type: String,
        example: d.includes[0],
        description: `Comma-separated relations. Allowed: ${d.includes.join(', ')}`,
      }),
    );
  }
  return applyDecorators(...decorators);
}
