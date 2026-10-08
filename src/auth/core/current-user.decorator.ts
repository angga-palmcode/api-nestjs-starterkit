import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './authenticated-user';

export type RequestWithUser = Request & { user?: AuthenticatedUser };

/** `@CurrentUser() actor: AuthenticatedUser` (only on guarded routes). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined =>
    ctx.switchToHttp().getRequest<RequestWithUser>().user,
);
