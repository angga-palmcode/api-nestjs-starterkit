import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/core/authenticated-user';
import { AppException } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaMock, PrismaMock } from '../../test/helpers/prisma-mock';
import { ExampleService } from './example.service';

const actor = (role: Role): AuthenticatedUser => ({
  id: 'a0000000-0000-4000-8000-000000000001',
  email: `${role}@example.com`,
  role,
  session_id: 'b0000000-0000-4000-8000-000000000002',
});

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const item = {
  id: ID,
  name: 'Report',
  description: null,
  is_published: true,
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-02T00:00:00Z'),
  deleted_at: null,
  created_by: null,
  updated_by: null,
};

/** Asserts the exact Prisma calls; behaviour over HTTP is in example.flow.spec.ts. */
describe('ExampleService (Prisma calls)', () => {
  let prisma: PrismaMock & { exampleItem: PrismaMock['user'] };
  let service: ExampleService;

  beforeEach(() => {
    const mock = createPrismaMock();
    prisma = Object.assign(mock, { exampleItem: mock.user });
    service = new ExampleService(prisma as unknown as PrismaService);
  });

  it('list: soft-delete filter always, scope only for plain users, one transaction', async () => {
    prisma.exampleItem.findMany.mockResolvedValue([]);
    prisma.exampleItem.count.mockResolvedValue(0);

    await service.list(actor(Role.admin), {});
    expect(prisma.exampleItem.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { AND: [{ deleted_at: null }] } }),
    );

    await service.list(actor(Role.user), {});
    const args = prisma.exampleItem.findMany.mock.calls.at(-1)?.[0] as {
      where: unknown;
    };
    expect(args.where).toEqual({
      AND: [{ is_published: true }, { deleted_at: null }],
    });
    expect(prisma.exampleItem.count).toHaveBeenLastCalledWith({
      where: args.where,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('get: id + soft delete (+ scope for plain users) in one query', async () => {
    prisma.exampleItem.findFirst.mockResolvedValue(item);
    await service.get(actor(Role.user), ID);
    expect(prisma.exampleItem.findFirst).toHaveBeenCalledWith({
      where: { id: ID, deleted_at: null, is_published: true },
    });
    await service.get(actor(Role.admin), ID);
    expect(prisma.exampleItem.findFirst).toHaveBeenLastCalledWith({
      where: { id: ID, deleted_at: null },
    });
  });

  it('get/update/remove: a missing row is a 404 AppException and nothing is written', async () => {
    prisma.exampleItem.findFirst.mockResolvedValue(null);
    for (const call of [
      () => service.get(actor(Role.admin), ID),
      () => service.update(actor(Role.admin), ID, { name: 'x' }),
      () => service.remove(actor(Role.admin), ID),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(AppException);
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(prisma.exampleItem.update).not.toHaveBeenCalled();
  });

  it('create stamps both audit fields; update stamps updated_by; remove is a soft delete', async () => {
    const admin = actor(Role.admin);
    prisma.exampleItem.create.mockResolvedValue(item);
    prisma.exampleItem.findFirst.mockResolvedValue(item);
    prisma.exampleItem.update.mockResolvedValue(item);

    await service.create(admin, { name: 'Report' });
    expect(prisma.exampleItem.create).toHaveBeenCalledWith({
      data: { name: 'Report', created_by: admin.id, updated_by: admin.id },
    });

    await service.update(admin, ID, { name: 'New' });
    expect(prisma.exampleItem.update).toHaveBeenLastCalledWith({
      where: { id: ID },
      data: { name: 'New', updated_by: admin.id },
    });

    await service.remove(admin, ID);
    expect(prisma.exampleItem.update).toHaveBeenLastCalledWith({
      where: { id: ID },
      data: { deleted_at: expect.any(Date) as Date, updated_by: admin.id },
    });
  });

  it('never returns Prisma rows: audit columns stay internal', async () => {
    prisma.exampleItem.findFirst.mockResolvedValue({
      ...item,
      updated_by: 'someone',
      deleted_at: null,
    });
    const dto = await service.get(actor(Role.admin), ID);
    expect(dto).not.toHaveProperty('updated_by');
    expect(dto).not.toHaveProperty('deleted_at');
  });
});
