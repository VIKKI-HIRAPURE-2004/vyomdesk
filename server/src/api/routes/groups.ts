import type { FastifyInstance } from "fastify";
import type { GroupService } from "../../services/groupService.js";
import type { AuditService } from "../../services/auditService.js";
import { Rights } from "@vyomdesk/shared";

/**
 * Group + permission REST routes. Admin-only management; non-admin users
 * can list groups they hold a permission row on (for filters).
 */
export async function groupRoutes(
  app: FastifyInstance,
  deps: { groups: GroupService; audit: AuditService },
) {
  const requireAdmin = async (req: any) => {
    if (req.user?.role !== "admin") throw app.errors.forbidden();
  };

  // Groups the caller can see (admin: all; others: permission rows only)
  app.get("/api/v1/groups", { preHandler: [app.auth] }, async (req) => {
    const groups = await deps.groups.visibleGroups(req.user!);
    const counts = await deps.groups.list();
    const cmap = new Map(counts.map((g) => [g.id, g.deviceCount]));
    return {
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        defaultRights: g.default_rights,
        deviceCount: cmap.get(g.id) ?? 0,
        createdAt: g.created_at,
      })),
    };
  });

  app.get("/api/v1/groups/:id", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const group = await deps.groups.get(id);
    if (!group) throw app.errors.notFound("Group");
    const rights = await deps.groups.effectiveRights(req.user!, id);
    if (!rights) throw app.errors.forbidden();
    const perms = (await deps.groups.listPermissions(id)).map((p) => ({
      userId: p.subject_id,
      email: p.email,
      rights: p.rights,
    }));
    reply.send({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        defaultRights: group.default_rights,
        createdAt: group.created_at,
      },
      rights,
      permissions: perms,
    });
  });

  app.post("/api/v1/groups", { preHandler: [app.auth, requireAdmin] }, async (req, reply) => {
    const body = req.body as { name?: string; description?: string; defaultRights?: number };
    const group = await deps.groups.create({
      name: body.name ?? "",
      description: body.description,
      ownerId: req.user!.id,
      defaultRights: body.defaultRights,
    });
    await deps.audit.log({
      actorType: "user",
      actorId: req.user!.id,
      action: "group.create",
      targetType: "group",
      targetId: group.id,
      meta: { name: group.name },
      ip: req.ip,
    });
    reply.code(201);
    return { group: { id: group.id, name: group.name, defaultRights: group.default_rights } };
  });

  app.patch("/api/v1/groups/:id", { preHandler: [app.auth, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string | null; defaultRights?: number };
    await deps.groups.update(id, body);
    await deps.audit.log({
      actorType: "user",
      actorId: req.user!.id,
      action: "group.update",
      targetType: "group",
      targetId: id,
      meta: { fields: Object.keys(body ?? {}) },
      ip: req.ip,
    });
    reply.code(204);
  });

  app.delete("/api/v1/groups/:id", { preHandler: [app.auth, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.groups.remove(id);
    await deps.audit.log({
      actorType: "user",
      actorId: req.user!.id,
      action: "group.delete",
      targetType: "group",
      targetId: id,
      ip: req.ip,
    });
    reply.code(204);
  });

  // ---- permissions ----

  app.get("/api/v1/groups/:id/permissions", { preHandler: [app.auth, requireAdmin] }, async (req) => {
    const { id } = req.params as { id: string };
    const group = await deps.groups.get(id);
    if (!group) throw app.errors.notFound("Group");
    const perms = await deps.groups.listPermissions(id);
    return {
      permissions: perms.map((p) => ({ userId: p.subject_id, email: p.email, rights: p.rights })),
    };
  });

  app.put(
    "/api/v1/groups/:id/permissions/:userId",
    { preHandler: [app.auth, requireAdmin] },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      const body = req.body as { rights?: number };
      await deps.groups.setPermission(id, userId, body?.rights ?? 0);
      await deps.audit.log({
        actorType: "user",
        actorId: req.user!.id,
        action: "group.permission.set",
        targetType: "group",
        targetId: id,
        meta: { userId, rights: body?.rights },
        ip: req.ip,
      });
      reply.code(204);
    },
  );

  app.delete(
    "/api/v1/groups/:id/permissions/:userId",
    { preHandler: [app.auth, requireAdmin] },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      await deps.groups.clearPermission(id, userId);
      await deps.audit.log({
        actorType: "user",
        actorId: req.user!.id,
        action: "group.permission.clear",
        targetType: "group",
        targetId: id,
        meta: { userId },
        ip: req.ip,
      });
      reply.code(204);
    },
  );

  // ---- device assignment ----

  app.patch(
    "/api/v1/groups/:id/devices",
    { preHandler: [app.auth, requireAdmin] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { deviceIds?: string[]; action?: "add" | "remove" };
      const group = await deps.groups.get(id);
      if (!group) throw app.errors.notFound("Group");
      if (!Array.isArray(body.deviceIds) || body.deviceIds.some((d) => typeof d !== "string"))
        throw app.errors.badRequest("deviceIds must be string[]");
      const set = body.action === "remove" ? null : id;
      for (const deviceId of body.deviceIds) {
        await deps.groups.setDeviceGroup(deviceId, set);
      }
      await deps.audit.log({
        actorType: "user",
        actorId: req.user!.id,
        action: body.action === "remove" ? "group.devices.remove" : "group.devices.add",
        targetType: "group",
        targetId: id,
        meta: { count: body.deviceIds.length },
        ip: req.ip,
      });
      reply.code(204);
    },
  );

  // rights metadata for the web UI (labels + bits)
  app.get("/api/v1/rights", { preHandler: [app.auth] }, async () => {
    const labels = (Object.keys(Rights) as Array<keyof typeof Rights>).map((k) => ({
      bit: Rights[k],
      name: k,
    }));
    return { rights: labels };
  });
}