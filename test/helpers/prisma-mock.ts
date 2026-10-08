/**
 * Hand-rolled PrismaService stand-in for tests that must not need a database.
 * Delegates expose `jest.fn()`s; `$transaction([...])` resolves its (already
 * started) operations like the real array form does.
 */
const op = () => jest.fn<Promise<unknown>, [unknown?]>();

const delegate = () => ({
  findMany: op(),
  findFirst: op(),
  findUnique: op(),
  create: op(),
  update: op(),
  updateMany: op(),
  count: op(),
});

export function createPrismaMock() {
  return {
    user: delegate(),
    userInvitation: delegate(),
    userSession: delegate(),
    refreshToken: delegate(),
    auditLog: { create: op().mockResolvedValue({}) },
    $queryRaw: op().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };
}

export type PrismaMock = ReturnType<typeof createPrismaMock>;
