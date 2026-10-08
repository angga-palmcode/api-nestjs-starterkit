import { Injectable } from '@nestjs/common';
import { ExampleItem, Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/core/authenticated-user';
import { PaginatedResult } from '../common/envelope/envelope.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-code';
import type { RawQuery } from '../common/query';
import { PrismaService } from '../prisma/prisma.service';
import { notDeleted, softDeleteData } from '../prisma/soft-delete';
import {
  CreateExampleItemDto,
  UpdateExampleItemDto,
} from './dto/example-item-input.dto';
import { ExampleItemDto, toExampleItemDto } from './dto/example-item.dto';
import { exampleQuery } from './example.query';

/**
 * Reference service. The pattern to copy:
 *  - reads go through the query definition (`exampleQuery.parse`) and a `$transaction([rows, count])`;
 *  - row-level visibility is a `scope` (here: plain users only see published items), applied
 *    to lists AND to single-row lookups so it cannot be bypassed by guessing an id;
 *  - writes stamp `created_by` / `updated_by`; deletes are soft (`softDeleteData`);
 *  - expected failures throw `AppException`; rows are mapped to DTOs, never returned raw.
 * Authorization by permission lives on the controller (`@Permissions`), not here.
 */
@Injectable()
export class ExampleService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: AuthenticatedUser,
    raw: RawQuery,
  ): Promise<PaginatedResult<ExampleItemDto>> {
    const q = exampleQuery.parse(raw, { scope: this.visibleTo(actor) });
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.exampleItem.findMany(q.args),
      this.prisma.exampleItem.count({ where: q.where }),
    ]);
    return q.paginate(rows.map(toExampleItemDto), total);
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ExampleItemDto> {
    return toExampleItemDto(await this.findOrFail(actor, id));
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateExampleItemDto,
  ): Promise<ExampleItemDto> {
    const item = await this.prisma.exampleItem.create({
      data: { ...dto, created_by: actor.id, updated_by: actor.id },
    });
    return toExampleItemDto(item);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateExampleItemDto,
  ): Promise<ExampleItemDto> {
    await this.findOrFail(actor, id);
    const item = await this.prisma.exampleItem.update({
      where: { id },
      data: { ...dto, updated_by: actor.id },
    });
    return toExampleItemDto(item);
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    await this.findOrFail(actor, id);
    await this.prisma.exampleItem.update({
      where: { id },
      data: softDeleteData(actor.id),
    });
  }

  /** Row-level scope: plain users see published items only; admins see everything. */
  private visibleTo(
    actor: AuthenticatedUser,
  ): Prisma.ExampleItemWhereInput | undefined {
    return actor.role === Role.user ? { is_published: true } : undefined;
  }

  private async findOrFail(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<ExampleItem> {
    const item = await this.prisma.exampleItem.findFirst({
      where: { id, ...notDeleted, ...this.visibleTo(actor) },
    });
    // A hidden row looks exactly like a missing one.
    if (!item) throw new AppException(ErrorCode.NOT_FOUND, 'Item not found');
    return item;
  }
}
