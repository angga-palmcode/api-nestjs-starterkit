import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-code';
import { PaginationMeta } from '../envelope/envelope.types';
import { ErrorResponseDto } from './error-response.dto';

const NOW = '2026-10-08T10:00:00.000Z';
const REQUEST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const errorExample = (
  message: string,
  error_code: ErrorCode,
  extra: object = {},
) => ({
  message,
  error_code,
  timestamp: NOW,
  request_id: REQUEST_ID,
  ...extra,
});

/** One realistic example per documented status, using the kit's real error codes. */
export const ERROR_EXAMPLES = {
  400: {
    description: 'Bad request (malformed body, unknown filter/sort/include)',
    example: errorExample('Malformed JSON body', ErrorCode.BAD_REQUEST),
  },
  401: {
    description: 'Missing, invalid or expired credentials',
    example: errorExample('Unauthorized', ErrorCode.UNAUTHENTICATED),
  },
  403: {
    description: 'Authenticated but not allowed',
    example: errorExample('Forbidden resource', ErrorCode.FORBIDDEN),
  },
  404: {
    description: 'Resource not found',
    example: errorExample('Item not found', ErrorCode.NOT_FOUND),
  },
  409: {
    description: 'Conflicts with current state (e.g. duplicate)',
    example: errorExample('Email already in use', ErrorCode.CONFLICT),
  },
  422: {
    description: 'Validation failed',
    example: errorExample('Validation failed', ErrorCode.VALIDATION_ERROR, {
      errors: [{ field: 'email', message: 'email must be an email' }],
    }),
  },
  429: {
    description: 'Rate limit exceeded',
    example: errorExample('Too many requests', ErrorCode.RATE_LIMITED),
  },
  500: {
    description: 'Unexpected server error',
    example: errorExample('Internal server error', ErrorCode.INTERNAL_ERROR),
  },
  503: {
    description: 'Dependency unavailable',
    example: errorExample('Service unavailable', ErrorCode.SERVICE_UNAVAILABLE),
  },
} as const;

export type DocumentedErrorStatus = keyof typeof ERROR_EXAMPLES;

/** `@ApiErrorResponses(401, 403, 404, 422)`: documents each status with the standard error schema + example. */
export function ApiErrorResponses(...statuses: DocumentedErrorStatus[]) {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_EXAMPLES[status].description,
        schema: {
          allOf: [{ $ref: getSchemaPath(ErrorResponseDto) }],
          example: ERROR_EXAMPLES[status].example,
        },
      }),
    ),
  );
}

const dataSchema = (model: Type, isArray?: boolean) => ({
  type: 'object',
  required: ['data'],
  properties: {
    data: isArray
      ? { type: 'array', items: { $ref: getSchemaPath(model) } }
      : { $ref: getSchemaPath(model) },
  },
});

/**
 * 200 with `{ data: Model }` (or `{ data: Model[] }` with `isArray`).
 * `examples` documents several response variants (e.g. each state of the login state machine).
 */
export const ApiOkEnvelope = (
  model: Type,
  options: {
    isArray?: boolean;
    examples?: Record<string, { summary: string; value: unknown }>;
  } = {},
) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: dataSchema(model, options.isArray),
      ...(options.examples ? { examples: options.examples } : {}),
    }),
  );

/** 202 with `{ data: Model }`. */
export const ApiAcceptedEnvelope = (model: Type) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiAcceptedResponse({ schema: dataSchema(model) }),
  );

/** 201 with `{ data: Model }`. */
export const ApiCreatedEnvelope = (model: Type) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiCreatedResponse({ schema: dataSchema(model) }),
  );

/** 200 with `{ data: Model[], meta: PaginationMeta }`. */
export const ApiPaginatedEnvelope = (model: Type) =>
  applyDecorators(
    ApiExtraModels(model, PaginationMeta),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMeta) },
        },
      },
    }),
  );
