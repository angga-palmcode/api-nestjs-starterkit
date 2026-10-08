import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException, ErrorDetail } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-code';

/** Flattens nested class-validator errors into `{ field: 'a.b', message }` entries. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): ErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppException(ErrorCode.VALIDATION_ERROR, 'Validation failed', {
        errors: flattenValidationErrors(errors),
      }),
  });
}
