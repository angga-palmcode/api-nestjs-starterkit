import { ConfigService } from '@nestjs/config';
import { Role, User } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/core/authenticated-user';
import { AppException } from '../common/errors/app.exception';
import { AppLogger } from '../common/logger/app.logger';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaMock, PrismaMock } from '../../test/helpers/prisma-mock';
import { testEnv } from '../../test/helpers/test-env';
import { InvitationMessage, InvitationSender } from './invitation-sender';
import { UsersService } from './users.service';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const actorOf = (
  role: Role,
  id = 'a0000000-0000-4000-8000-000000000001',
): AuthenticatedUser => ({
  id,
  email: `${role}@example.com`,
  role,
  session_id: 'b0000000-0000-4000-8000-000000000002',
});

const userOf = (overrides: Partial<User> = {}): User => ({
  id: ID,
  email: 'target@example.com',
  password_hash: 'secret-hash',
  name: 'Target',
  role: Role.user,
  is_active: true,
  email_verified_at: new Date(),
  mfa_enabled: false,
  failed_login_attempts: 3,
  locked_until: null,
  token_version: 0,
  last_login_at: null,
  created_at: new Date('2026-09-01T00:00:00Z'),
  updated_at: new Date('2026-09-02T00:00:00Z'),
  deleted_at: null,
  created_by: null,
  updated_by: null,
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (e) {
    return e as AppException;
  }
  throw new Error('expected rejection');
}

describe('UsersService', () => {
  let prisma: PrismaMock;
  let service: UsersService;
  let send: jest.Mock<Promise<void>, [InvitationMessage]>;
  let logError: jest.Mock;

  beforeEach(() => {
    prisma = createPrismaMock();
    send = jest.fn<Promise<void>, [InvitationMessage]>().mockResolvedValue();
    logError = jest.fn();
    service = new UsersService(
      prisma as unknown as PrismaService,
      new ConfigService(
        testEnv({
          INVITATION_TTL_HOURS: '24',
          FRONTEND_URL: 'https://app.example.com/',
        }),
      ) as never,
      { send } satisfies InvitationSender,
      { error: logError } as unknown as AppLogger,
    );
  });

  describe('list', () => {
    it('is admin-only', async () => {
      const err = await failure(service.list(actorOf(Role.user), {}));
      expect(err.getStatus()).toBe(403);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('builds Prisma args from the query definition, in one transaction, without leaking secrets', async () => {
      prisma.user.findMany.mockResolvedValue([userOf()]);
      prisma.user.count.mockResolvedValue(51);

      const result = await service.list(actorOf(Role.admin), {
        page: '3',
        page_size: '10',
        filter: { role: 'user,admin', is_active: 'true' },
        search: 'tar',
        sort: 'name',
      });

      const where = {
        AND: [
          { deleted_at: null },
          { role: { in: ['user', 'admin'] } },
          { is_active: true },
          {
            OR: [
              { name: { contains: 'tar', mode: 'insensitive' } },
              { email: { contains: 'tar', mode: 'insensitive' } },
            ],
          },
        ],
      };
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: 20,
        take: 10,
      });
      // the count uses the same where, so the total matches the page
      expect(prisma.user.count).toHaveBeenCalledWith({ where });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.meta).toEqual({
        current_page: 3,
        page_size: 10,
        total: 51,
        last_page: 6,
      });
      expect(result.data[0]).not.toHaveProperty('password_hash');
      expect(result.data[0]).not.toHaveProperty('failed_login_attempts');
      expect(result.data[0]).toMatchObject({ email_verified: true });
    });

    it('defaults to newest first with a stable tiebreaker and hides soft-deleted users', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);
      const result = await service.list(actorOf(Role.admin), {});
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { AND: [{ deleted_at: null }] },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 25,
      });
      expect(result.meta.last_page).toBe(1);
    });

    it('rejects unknown filters/sorts before touching the database', async () => {
      for (const [raw, code] of [
        [{ filter: { password_hash: 'x' } }, 'UNKNOWN_FILTER'],
        [{ sort: 'password_hash' }, 'UNKNOWN_SORT'],
        [{ include: 'sessions' }, 'UNKNOWN_INCLUDE'],
        [{ filter: { role: 'owner' } }, 'INVALID_QUERY'],
      ] as const) {
        const err = await failure(service.list(actorOf(Role.admin), raw));
        expect(err.getStatus()).toBe(400);
        expect(err.code).toBe(code);
      }
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('filters by verification state and creation date', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);
      await service.list(actorOf(Role.admin), {
        filter: {
          email_verified: 'false',
          created_between: '2026-01-01,2026-01-31',
        },
      });
      const args = prisma.user.findMany.mock.calls[0][0] as {
        where: { AND: object[] };
      };
      expect(args.where.AND).toEqual([
        { deleted_at: null },
        { email_verified_at: null },
        {
          created_at: {
            gte: new Date('2026-01-01T00:00:00.000Z'),
            lte: new Date('2026-01-31T23:59:59.999Z'),
          },
        },
      ]);
    });
  });

  describe('get', () => {
    it('returns 404 for a missing or soft-deleted user', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const err = await failure(service.get(actorOf(Role.admin), ID));
      expect(err.getStatus()).toBe(404);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: ID, deleted_at: null },
      });
    });
  });

  describe('invite', () => {
    it('only allows roles strictly below the actor', async () => {
      const err = await failure(
        service.invite(actorOf(Role.admin), {
          email: 'a@example.com',
          role: Role.admin,
        }),
      );
      expect(err.getStatus()).toBe(403);
      expect(prisma.userInvitation.create).not.toHaveBeenCalled();
    });

    it('rejects an email that already belongs to a user (even soft-deleted)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        userOf({ deleted_at: new Date() }),
      );
      const err = await failure(
        service.invite(actorOf(Role.admin), {
          email: 'Target@Example.com',
          role: Role.user,
        }),
      );
      expect(err.getStatus()).toBe(409);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'target@example.com' },
      });
    });

    it('stores only a token hash, supersedes pending invitations and sends the link', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.userInvitation.updateMany.mockResolvedValue({ count: 1 });
      prisma.userInvitation.create.mockImplementation((args) =>
        Promise.resolve({
          id: 'inv-1',
          created_at: new Date(),
          ...(args as { data: object }).data,
        }),
      );

      const result = await service.invite(actorOf(Role.superadmin), {
        email: 'New@Example.com',
        name: 'New Person',
        role: Role.admin,
      });

      const created = prisma.userInvitation.create.mock.calls[0][0] as {
        data: { token_hash: string; email: string; invited_by_id: string };
      };
      expect(created.data.email).toBe('new@example.com');
      expect(created.data.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.userInvitation.updateMany).toHaveBeenCalledWith({
        where: {
          email: 'new@example.com',
          accepted_at: null,
          revoked_at: null,
        },
        data: { revoked_at: expect.any(Date) as Date },
      });

      const message = send.mock.calls[0][0];
      const token = new URL(message.link).searchParams.get('token');
      expect(
        message.link.startsWith('https://app.example.com/accept-invite?'),
      ).toBe(true);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(created.data.token_hash).not.toContain(token as string);

      // 24h TTL from config
      const hours = (message.expires_at.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThanOrEqual(24);

      expect(result).toEqual({
        id: 'inv-1',
        email: 'new@example.com',
        role: 'admin',
        expires_at: message.expires_at,
        created_at: expect.any(Date) as Date,
      });
      expect(JSON.stringify(result)).not.toContain('token');
    });

    it('does not fail the request when delivery fails (logs instead)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.userInvitation.create.mockResolvedValue({
        id: 'inv-2',
        email: 'x@example.com',
        role: Role.user,
        expires_at: new Date(),
        created_at: new Date(),
      });
      send.mockRejectedValue(new Error('smtp down'));

      await expect(
        service.invite(actorOf(Role.admin), {
          email: 'x@example.com',
          role: Role.user,
        }),
      ).resolves.toMatchObject({ id: 'inv-2' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(logError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'invitation_send_failed' }),
        undefined,
        'Invitations',
      );
    });
  });

  describe('hierarchy and self-protection', () => {
    it.each([
      ['admin acting on admin', Role.admin, Role.admin],
      ['admin acting on superadmin', Role.admin, Role.superadmin],
      ['superadmin acting on superadmin', Role.superadmin, Role.superadmin],
    ])('forbids %s', async (_label, actorRole, targetRole) => {
      prisma.user.findFirst.mockResolvedValue(userOf({ role: targetRole }));
      for (const action of [
        () => service.update(actorOf(actorRole), ID, { name: 'x' }),
        () => service.activate(actorOf(actorRole), ID),
        () => service.deactivate(actorOf(actorRole), ID),
        () => service.forceLogout(actorOf(actorRole), ID),
        () => service.remove(actorOf(actorRole), ID),
      ]) {
        expect((await failure(action())).getStatus()).toBe(403);
      }
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('forbids acting on your own account', async () => {
      prisma.user.findFirst.mockResolvedValue(
        userOf({ id: ID, role: Role.user }),
      );
      const err = await failure(
        service.deactivate(actorOf(Role.superadmin, ID), ID),
      );
      expect(err.getStatus()).toBe(403);
      expect(err.message).toMatch(/own account/);
    });

    it('forbids non-admins outright', async () => {
      const err = await failure(service.deactivate(actorOf(Role.user), ID));
      expect(err.getStatus()).toBe(403);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => prisma.user.findFirst.mockResolvedValue(userOf()));

    it('changes name without touching token_version', async () => {
      prisma.user.update.mockResolvedValue(userOf({ name: 'Renamed' }));
      const actor = actorOf(Role.admin);
      await service.update(actor, ID, { name: 'Renamed' });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: { name: 'Renamed', updated_by: actor.id },
      });
    });

    it('bumps token_version when the role changes and checks assignability', async () => {
      prisma.user.update.mockResolvedValue(userOf({ role: Role.admin }));
      await service.update(actorOf(Role.superadmin), ID, { role: Role.admin });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: {
          role: 'admin',
          token_version: { increment: 1 },
          updated_by: expect.any(String) as string,
        },
      });

      const err = await failure(
        service.update(actorOf(Role.admin), ID, { role: Role.admin }),
      );
      expect(err.getStatus()).toBe(403);
    });
  });

  describe('access revocation', () => {
    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(userOf());
      prisma.user.update.mockResolvedValue(userOf({ is_active: false }));
    });

    it('deactivate revokes tokens and sessions and bumps token_version in one transaction', async () => {
      const actor = actorOf(Role.admin);
      const dto = await service.deactivate(actor, ID);
      expect(dto.is_active).toBe(false);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { user_id: ID, revoked_at: null },
        data: { revoked_at: expect.any(Date) as Date },
      });
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { user_id: ID, revoked_at: null },
        data: { revoked_at: expect.any(Date) as Date },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: {
          is_active: false,
          updated_by: actor.id,
          token_version: { increment: 1 },
        },
      });
    });

    it('force-logout revokes without deactivating', async () => {
      await service.forceLogout(actorOf(Role.admin), ID);
      const data = (prisma.user.update.mock.calls[0][0] as { data: object })
        .data;
      expect(data).not.toHaveProperty('is_active');
      expect(data).toMatchObject({ token_version: { increment: 1 } });
    });

    it('remove soft-deletes (deleted_at) and revokes', async () => {
      await service.remove(actorOf(Role.admin), ID);
      const data = (prisma.user.update.mock.calls[0][0] as { data: object })
        .data;
      expect(data).toMatchObject({
        is_active: false,
        deleted_at: expect.any(Date) as Date,
        token_version: { increment: 1 },
      });
    });

    it('activate clears lockout state', async () => {
      prisma.user.update.mockResolvedValue(userOf());
      await service.activate(actorOf(Role.admin), ID);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: {
          is_active: true,
          failed_login_attempts: 0,
          locked_until: null,
          updated_by: expect.any(String) as string,
        },
      });
    });
  });
});
