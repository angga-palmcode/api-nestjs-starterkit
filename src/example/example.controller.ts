import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../audit/audited.decorator';
import type { AuthenticatedUser } from '../auth/core/authenticated-user';
import { CurrentUser } from '../auth/core/current-user.decorator';
import { PaginatedResult } from '../common/envelope/envelope.types';
import { ApiQueryFrom, type RawQuery } from '../common/query';
import {
  ApiCreatedEnvelope,
  ApiErrorResponses,
  ApiOkEnvelope,
  ApiPaginatedEnvelope,
} from '../common/swagger/decorators';
import { Permissions } from '../rbac/rbac.decorators';
import {
  CreateExampleItemDto,
  UpdateExampleItemDto,
} from './dto/example-item-input.dto';
import { ExampleItemDto } from './dto/example-item.dto';
import { exampleQuery } from './example.query';
import { ExampleService } from './example.service';

/**
 * Reference controller: every route has `@ApiOperation` + a response decorator +
 * `@ApiErrorResponses`, a `@Permissions` line (one line!), and mutations are `@Audited`.
 * `test/swagger.e2e-spec.ts` and `test/rbac.e2e-spec.ts` fail if any of that is missing.
 */
@ApiTags('example')
@ApiBearerAuth()
@Controller('example-items')
export class ExampleController {
  constructor(private readonly example: ExampleService) {}

  @Get()
  @Permissions('example.read')
  @ApiOperation({
    summary: 'List items',
    description:
      'Filter, search, sort and paginate. Plain users only see published items.',
  })
  @ApiQueryFrom(exampleQuery)
  @ApiPaginatedEnvelope(ExampleItemDto)
  @ApiErrorResponses(400, 401, 403)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: RawQuery,
  ): Promise<PaginatedResult<ExampleItemDto>> {
    return this.example.list(actor, query);
  }

  @Get(':id')
  @Permissions('example.read')
  @ApiOperation({ summary: 'Get an item' })
  @ApiOkEnvelope(ExampleItemDto)
  @ApiErrorResponses(400, 401, 403, 404)
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExampleItemDto> {
    return this.example.get(actor, id);
  }

  @Post()
  @Permissions('example.create')
  @ApiOperation({ summary: 'Create an item' })
  @ApiCreatedEnvelope(ExampleItemDto)
  @ApiErrorResponses(401, 403, 422)
  @Audited('example.create', 'example_item')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateExampleItemDto,
  ): Promise<ExampleItemDto> {
    return this.example.create(actor, dto);
  }

  @Patch(':id')
  @Permissions('example.update')
  @ApiOperation({ summary: 'Update an item (partial)' })
  @ApiOkEnvelope(ExampleItemDto)
  @ApiErrorResponses(400, 401, 403, 404, 422)
  @Audited('example.update', 'example_item')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExampleItemDto,
  ): Promise<ExampleItemDto> {
    return this.example.update(actor, id, dto);
  }

  @Delete(':id')
  @Permissions('example.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an item',
    description: 'Soft delete: the row is kept with `deleted_at` set.',
  })
  @ApiNoContentResponse({ description: 'Item deleted' })
  @ApiErrorResponses(400, 401, 403, 404)
  @Audited('example.delete', 'example_item')
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.example.remove(actor, id);
  }
}
