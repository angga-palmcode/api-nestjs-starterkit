import { Prisma } from '@prisma/client';
import {
  boolean,
  dateRange,
  defineQuery,
  exact,
  partial,
} from '../common/query';

/**
 * One query definition per entity: the whitelist of filters/sorts, the search columns and
 * the paging limits. It parses and validates the URL, builds the Prisma arguments and
 * documents the parameters in Swagger (`@ApiQueryFrom(exampleQuery)`):
 *   ?filter[is_published]=true&filter[name]=report&search=q3&sort=-created_at&page=2
 */
export const exampleQuery = defineQuery<
  Prisma.ExampleItemWhereInput,
  Prisma.ExampleItemOrderByWithRelationInput,
  never // this model has no relations, so no `include`
>({
  filters: {
    id: exact({
      cast: 'uuid',
      example: '0f8fad5b-d9cb-469f-a165-70867728950e',
    }),
    name: partial({ example: 'report' }),
    is_published: boolean(),
    created_between: dateRange('created_at'),
  },
  sorts: ['name', 'created_at', 'updated_at'],
  defaultSort: '-created_at',
  search: ['name', 'description'],
});
