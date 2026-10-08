import './setup-env';

// Unit and integration tests must not depend on the machine (or CI job) they run on.
// CI exports REDIS_URL for the real-Redis suite (test/redis.e2e-spec.ts, which uses
// test/setup-env.ts only). Here it would make RedisModule open a real connection and break
// "no Redis configured" assertions, so it is removed for these tests.
delete process.env.REDIS_URL;
