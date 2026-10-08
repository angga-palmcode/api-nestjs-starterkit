// Jest setup: tests never connect to a database unless DATABASE_URL is provided
// (CI does). These values only satisfy boot-time env validation.
process.env.DATABASE_URL ??=
  'postgresql://app:app@localhost:5432/app?schema=public';
process.env.AUTH_ACCESS_SECRET ??= 'test-access-secret-0123456789-abcdefghijkl';
process.env.AUTH_MFA_CHALLENGE_SECRET ??=
  'test-challenge-secret-0123456789-abcdefghi';
process.env.AUTH_EMAIL_VERIFY_SECRET ??=
  'test-email-verify-secret-0123456789-abcdef';
// Cheap bcrypt in tests (production default is 12).
process.env.AUTH_BCRYPT_ROUNDS ??= '4';
// Throttling is exercised by its own test; keep it out of the way elsewhere.
process.env.THROTTLE_ENABLED ??= 'false';
