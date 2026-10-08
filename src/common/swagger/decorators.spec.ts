import { Controller, Get } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  ApiCreatedEnvelope,
  ApiErrorResponses,
  ApiOkEnvelope,
  ApiPaginatedEnvelope,
  ERROR_EXAMPLES,
} from './decorators';

class ItemDto {
  @ApiProperty({ example: 'itm_123' })
  id!: string;
}

@Controller('items')
class ItemsController {
  @Get('one')
  @ApiOkEnvelope(ItemDto)
  @ApiErrorResponses(401, 404)
  one() {
    return null;
  }
  @Get('many')
  @ApiOkEnvelope(ItemDto, { isArray: true })
  many() {
    return null;
  }
  @Get('page')
  @ApiPaginatedEnvelope(ItemDto)
  @ApiErrorResponses(422)
  page() {
    return null;
  }
  @Get('make')
  @ApiCreatedEnvelope(ItemDto)
  make() {
    return null;
  }
}

interface Operation {
  responses: Record<string, { content: Record<string, { schema: unknown }> }>;
}

describe('swagger decorators', () => {
  let paths: Record<string, Record<string, Operation>>;
  let schemas: Record<string, unknown>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ItemsController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    await app.close();
    paths = doc.paths as typeof paths;
    schemas = doc.components?.schemas as typeof schemas;
  });

  const schemaOf = (path: string, status: string) =>
    paths[path].get.responses[status].content['application/json'].schema;

  it('wraps the model in { data }', () => {
    expect(schemaOf('/items/one', '200')).toMatchObject({
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/ItemDto' } },
    });
    expect(schemaOf('/items/many', '200')).toMatchObject({
      properties: { data: { type: 'array' } },
    });
    expect(schemaOf('/items/make', '201')).toMatchObject({
      properties: { data: { $ref: '#/components/schemas/ItemDto' } },
    });
  });

  it('paginated envelope has data[] and meta', () => {
    expect(schemaOf('/items/page', '200')).toMatchObject({
      required: ['data', 'meta'],
      properties: { meta: { $ref: '#/components/schemas/PaginationMeta' } },
    });
    expect(schemas).toHaveProperty('PaginationMeta');
  });

  it('error responses reference ErrorResponseDto with the status example', () => {
    expect(schemaOf('/items/one', '404')).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/ErrorResponseDto' }],
      example: ERROR_EXAMPLES[404].example,
    });
    expect(schemaOf('/items/page', '422')).toMatchObject({
      example: { error_code: 'VALIDATION_ERROR' },
    });
    expect(schemas).toHaveProperty('ErrorResponseDto');
    expect(Object.keys(paths['/items/one'].get.responses)).toEqual(
      expect.arrayContaining(['200', '401', '404']),
    );
  });
});
