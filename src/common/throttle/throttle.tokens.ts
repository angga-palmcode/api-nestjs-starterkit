/**
 * Optional seam: a module (the redis module) may provide a `ThrottlerStorage` under this
 * token, used instead of the in-memory default when `THROTTLE_STORAGE=redis`.
 */
export const THROTTLER_STORAGE_OVERRIDE = Symbol('THROTTLER_STORAGE_OVERRIDE');
