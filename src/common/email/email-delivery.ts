import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { EMAIL_TRANSPORT } from './email-transport';
import type { EmailTransport } from './email-transport';

/** Lets a module see whether the project provides an `EMAIL_TRANSPORT` (the optional mail module does). */
@Injectable()
export class EmailTransportHolder {
  constructor(
    @Optional()
    @Inject(EMAIL_TRANSPORT)
    readonly transport?: EmailTransport,
  ) {}
}

/**
 * `AUTH_DELIVERY=email` -> the transport, or a boot-time error when none is provided
 * (never a failure at the first login). Any other value -> null (use the console adapters).
 */
export function resolveEmailTransport(
  config: ConfigService<Env, true>,
  holder: EmailTransportHolder,
): EmailTransport | null {
  if (config.get('AUTH_DELIVERY', { infer: true }) !== 'email') return null;
  if (!holder.transport) {
    throw new Error(
      'AUTH_DELIVERY=email requires an EMAIL_TRANSPORT provider (enable the mail module or provide your own)',
    );
  }
  return holder.transport;
}
