# Add an error code

Every error the API returns has a stable `error_code` (the enum `ErrorCode`). Frontends switch on it, so add codes deliberately and never rename one.

The wire shape never changes: `{ message, error_code, timestamp, request_id, errors? }`.

## Steps

**1. Add it to the enum and give it a status**, in `src/common/errors/error-code.ts` (the `Record<ErrorCode, number>` makes the compiler force the status):

```ts
export enum ErrorCode {
  // ...
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  // ...
  [ErrorCode.QUOTA_EXCEEDED]: HttpStatus.PAYMENT_REQUIRED,   // 402
};
```

**2. Throw it**:

```ts
throw new AppException(ErrorCode.QUOTA_EXCEEDED, 'Monthly quota reached');
// per-field details (validation-style):
throw new AppException(ErrorCode.VALIDATION_ERROR, 'Validation failed', {
  errors: [{ field: 'email', message: 'email is already registered' }],
});
// a different status than the default for the code:
throw new AppException(ErrorCode.INVALID_TOKEN, 'Link expired', { status: 400 });
```

**3. Document it.** Use `@ApiErrorResponses(...)` with the status on the routes that can return it. If the status is new to the kit (402 above), add a realistic example to `ERROR_EXAMPLES` in `src/common/swagger/decorators.ts` (status, description, example body with your code). Statuses already there: 400, 401, 403, 404, 409, 422, 429, 500, 503.

**4. Test it** at the HTTP level: assert both the status and `error_code` (see `test/http-contract.e2e-spec.ts` and `src/example/example.flow.spec.ts` for the pattern). `src/common/errors/errors.spec.ts` already asserts that every code has a default status.

## Rules of thumb

- One code per client decision ("show the quota banner"), not per cause. Put detail in `message` or `errors`.
- `message` is for humans and may change; `error_code` may not.
- Expected failures are always `AppException`. Never throw a bare `Error` for them: unknown errors become a generic `500 INTERNAL_ERROR` and their message is hidden.
- 5xx messages never reach clients, whatever you pass.
- Do not reveal whether an account exists: use the same code and message for "unknown" and "wrong" (see how auth does it).

## Translating messages

Messages are plain strings (i18n is off by default). To localise, map `error_code` to text on the client, or add a translation step inside `AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`).
