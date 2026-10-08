import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { ClientMeta } from './session.service';

/** `@Meta() meta: ClientMeta`: caller IP (honours `trust proxy`) and user agent. */
export const Meta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientMeta => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return { ip: req.ip, user_agent: req.header('user-agent') };
  },
);
