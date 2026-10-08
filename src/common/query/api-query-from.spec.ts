import { Controller, Get } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ApiQueryFrom, boolean, defineQuery, oneOf, partial } from './index';

const def = defineQuery({
  filters: {
    name: partial(),
    status: oneOf({ values: ['draft', 'live'] }),
    active: boolean(),
  },
  sorts: ['name', 'created_at'],
  defaultSort: '-created_at',
  includes: ['owner'],
  search: ['name'],
});

const bare = defineQuery({ filters: {}, sorts: ['id'], softDelete: false });

@Controller('things')
class ThingsController {
  @Get()
  @ApiQueryFrom(def)
  list() {
    return [];
  }

  @Get('bare')
  @ApiQueryFrom(bare)
  listBare() {
    return [];
  }
}

interface Param {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  schema: { type: string; enum?: string[]; example?: unknown };
}

describe('@ApiQueryFrom', () => {
  let paths: Record<string, { get: { parameters: Param[] } }>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThingsController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    paths = SwaggerModule.createDocument(app, new DocumentBuilder().build())
      .paths as typeof paths;
    await app.close();
  });

  it('generates one optional query parameter per filter plus sort/page/search/include', () => {
    const params = paths['/things'].get.parameters;
    expect(params.map((p) => p.name)).toEqual([
      'filter[name]',
      'filter[status]',
      'filter[active]',
      'sort',
      'page',
      'page_size',
      'search',
      'include',
    ]);
    expect(params.every((p) => p.in === 'query' && p.required === false)).toBe(
      true,
    );
  });

  it('carries examples, enums and the real limits from the definition', () => {
    const params = paths['/things'].get.parameters;
    const by = (name: string) => params.find((p) => p.name === name)!;
    expect(by('filter[status]').schema).toMatchObject({
      example: 'draft,live',
    });
    expect(by('filter[status]').description).toContain('draft, live');
    expect(by('filter[status]').schema.enum).toBeUndefined();
    expect(by('filter[active]').schema.enum).toEqual(['true', 'false']);
    expect(by('sort').description).toContain('name, created_at');
    expect(by('sort').description).toContain('Default: -created_at');
    expect(by('page_size').description).toContain('capped at 100');
    expect(by('include').description).toContain('owner');
  });

  it('omits search and include when the definition has none', () => {
    expect(paths['/things/bare'].get.parameters.map((p) => p.name)).toEqual([
      'sort',
      'page',
      'page_size',
    ]);
  });
});
