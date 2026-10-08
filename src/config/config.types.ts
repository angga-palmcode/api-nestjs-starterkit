import { ConfigService } from '@nestjs/config';
import { Env } from './env.schema';

/** Inject this instead of reading `process.env`: `get('PORT')` is fully typed. */
export type AppConfigService = ConfigService<Env, true>;
