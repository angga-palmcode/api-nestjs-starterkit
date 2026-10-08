import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'is_public';

/** Opts a route (or controller) out of the global JWT guard. Everything else requires a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
