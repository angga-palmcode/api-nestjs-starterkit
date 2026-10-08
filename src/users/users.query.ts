import { Prisma, Role } from '@prisma/client';
import {
  boolean,
  callback,
  dateRange,
  defineQuery,
  exact,
  oneOf,
  partial,
} from '../common/query';

/**
 * What `GET /users` accepts. One definition drives parsing, validation and the Swagger
 * parameters (`@ApiQueryFrom(userQuery)`):
 *   ?filter[role]=admin,user&filter[is_active]=true&filter[created_between]=2026-01-01,2026-01-31
 *   &search=ani&sort=-created_at,name&page=2&page_size=25
 */
export const userQuery = defineQuery<
  Prisma.UserWhereInput,
  Prisma.UserOrderByWithRelationInput,
  Prisma.UserInclude
>({
  filters: {
    id: exact({
      cast: 'uuid',
      example: '0f8fad5b-d9cb-469f-a165-70867728950e',
    }),
    email: partial({ example: 'ani@example.com' }),
    name: partial({ example: 'Ani' }),
    role: oneOf({ values: Object.values(Role) }),
    is_active: boolean(),
    email_verified: callback(
      (value) => ({
        email_verified_at: value === 'true' ? { not: null } : null,
      }),
      {
        description: 'Whether the email address is verified (true or false)',
        example: 'true',
        values: ['true', 'false'],
      },
    ),
    created_between: dateRange('created_at'),
  },
  sorts: ['name', 'email', 'created_at', 'last_login_at'],
  defaultSort: '-created_at',
  search: ['name', 'email'],
});
