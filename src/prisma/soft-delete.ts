/**
 * Soft delete helpers (Blueprint A10): domain tables have `deleted_at`; rows are
 * never removed ad hoc. Always filter reads with `notDeleted` and delete with
 * `softDeleteData(...)`:
 *
 *   prisma.user.findFirst({ where: { id, ...notDeleted } })
 *   prisma.user.update({ where: { id }, data: softDeleteData(actor.id) })
 *
 * The query builder (Phase 6) applies `notDeleted` by default.
 */
export const notDeleted = { deleted_at: null } as const;

export function softDeleteData(actorId?: string): {
  deleted_at: Date;
  updated_by?: string;
} {
  return {
    deleted_at: new Date(),
    ...(actorId ? { updated_by: actorId } : {}),
  };
}
