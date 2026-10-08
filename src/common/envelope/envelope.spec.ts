import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { EnvelopeInterceptor } from './envelope.interceptor';
import { buildPaginationMeta, paginated, toSkipTake } from './envelope.types';

describe('pagination helpers', () => {
  it('computes last_page, never below 1', () => {
    expect(buildPaginationMeta(1, 25, 0).last_page).toBe(1);
    expect(buildPaginationMeta(1, 25, 25).last_page).toBe(1);
    expect(buildPaginationMeta(1, 25, 26).last_page).toBe(2);
    expect(buildPaginationMeta(3, 10, 137)).toEqual({
      current_page: 3,
      page_size: 10,
      total: 137,
      last_page: 14,
    });
  });

  it('converts page/page_size to skip/take', () => {
    expect(toSkipTake(1, 25)).toEqual({ skip: 0, take: 25 });
    expect(toSkipTake(3, 10)).toEqual({ skip: 20, take: 10 });
  });

  it('paginated() carries data and meta', () => {
    const r = paginated(['a'], { page: 1, page_size: 25, total: 1 });
    expect(r.data).toEqual(['a']);
    expect(r.meta.total).toBe(1);
  });
});

describe('EnvelopeInterceptor', () => {
  const run = (
    value: unknown,
    opts: { skip?: boolean; type?: string } = {},
  ): Promise<unknown> => {
    const reflector = {
      getAllAndOverride: () => opts.skip ?? false,
    } as unknown as Reflector;
    const ctx = {
      getType: () => opts.type ?? 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(value) };
    return lastValueFrom(
      new EnvelopeInterceptor(reflector).intercept(ctx, next),
    );
  };

  it('wraps values in { data }', async () => {
    await expect(run({ a: 1 })).resolves.toEqual({ data: { a: 1 } });
    await expect(run([1, 2])).resolves.toEqual({ data: [1, 2] });
    await expect(run(null)).resolves.toEqual({ data: null });
    await expect(run(0)).resolves.toEqual({ data: 0 });
  });

  it('turns PaginatedResult into { data, meta }', async () => {
    const r = paginated([1], { page: 1, page_size: 25, total: 1 });
    await expect(run(r)).resolves.toEqual({ data: [1], meta: r.meta });
  });

  it('leaves undefined, streams and buffers untouched', async () => {
    await expect(run(undefined)).resolves.toBeUndefined();
    const file = new StreamableFile(Buffer.from('x'));
    await expect(run(file)).resolves.toBe(file);
    const buf = Buffer.from('x');
    await expect(run(buf)).resolves.toBe(buf);
  });

  it('skips when @SkipEnvelope or non-http', async () => {
    await expect(run({ a: 1 }, { skip: true })).resolves.toEqual({ a: 1 });
    await expect(run({ a: 1 }, { type: 'rpc' })).resolves.toEqual({ a: 1 });
  });
});
