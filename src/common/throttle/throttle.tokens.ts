/**
 * Optional seam: a module (the redis module) may provide a `ThrottlerStorage` under this
 * token, used instead of the in-memory default (the redis module provides it when `REDIS_URL` is set).
 */
export const THROTTLER_STORAGE_OVERRIDE = Symbol('THROTTLER_STORAGE_OVERRIDE');
