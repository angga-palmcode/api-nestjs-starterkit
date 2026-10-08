import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

const parse = (query: object) => plainToInstance(PaginationQueryDto, query);

describe('PaginationQueryDto', () => {
  it('defaults to page 1, page_size 25', async () => {
    const dto = parse({});
    expect(dto).toMatchObject({ page: 1, page_size: 25 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('coerces query strings to numbers', async () => {
    const dto = parse({ page: '3', page_size: '50' });
    expect(dto).toMatchObject({ page: 3, page_size: 50 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { page_size: '0' },
    { page_size: '101' },
  ])('rejects %j', async (query) => {
    expect((await validate(parse(query))).length).toBeGreaterThan(0);
  });
});
