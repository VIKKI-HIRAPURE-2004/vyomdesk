import { randomUUID } from "node:crypto";
import type { Knex } from "knex";

/**
 * AuditService — append-only audit trail.
 * (Audit logging pattern conceptually adapted from MeshCentral, Apache-2.0.)
 */
export class AuditService {
  constructor(private db: Knex) {}

  async log(p: {
    actorType: "user" | "agent" | "system";
    actorId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    meta?: Record<string, unknown> | null;
    ip?: string | null;
  }): Promise<void> {
    await this.db("audit_logs").insert({
      id: randomUUID(),
      actor_type: p.actorType,
      actor_id: p.actorId ?? null,
      action: p.action,
      target_type: p.targetType ?? null,
      target_id: p.targetId ?? null,
      meta: p.meta ? JSON.stringify(p.meta) : null,
      ip: p.ip ?? null,
      ts: Date.now(),
    });
  }

  async list(filter: { actorId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const q = this.db("audit_logs").select("*");
    if (filter.actorId) q.where({ actor_id: filter.actorId });
    return q.orderBy("ts", "desc").limit(limit);
  }
}
