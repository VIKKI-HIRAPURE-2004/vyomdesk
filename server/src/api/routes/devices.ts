import type { FastifyInstance } from "fastify";
import { Channel } from "@vyomdesk/shared";
import type { DeviceRegistry } from "../../services/deviceRegistry.js";
import type { AgentHub } from "../../ws/agentHub.js";
import type { AuditService } from "../../services/auditService.js";
import type { SessionManager } from "../../services/sessionManager.js";
import type { GroupService } from "../../services/groupService.js";
import { canUseChannel } from "@vyomdesk/shared";

export async function deviceRoutes(
  app: FastifyInstance,
  deps: {
    registry: DeviceRegistry;
    hub: AgentHub;
    audit: AuditService;
    sessions: SessionManager;
    groups?: GroupService;
  },
) {
  app.get("/api/v1/devices", { preHandler: [app.auth] }, async (req) => {
    const q = req.query as { groupId?: string; online?: string; q?: string };
    const isAdmin = req.user!.role === "admin";
    const devices = await deps.registry.list({
      ownerUserId: isAdmin ? undefined : req.user!.id,
      groupId: q.groupId,
      online: q.online === undefined ? undefined : q.online === "true",
      q: q.q,
    });
    return { devices, total: devices.length };
  });

  app.get("/api/v1/devices/:id", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await deps.registry.getOwned(id, req.user!.id, req.user!.role === "admin");
    if (!row) throw app.errors.notFound("Device");
    return { device: deps.registry.toDTO(row) };
  });

  app.get("/api/v1/devices/:id/metrics", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await deps.registry.getOwned(id, req.user!.id, req.user!.role === "admin");
    if (!row) throw app.errors.notFound("Device");
    const q = req.query as { from?: string; to?: string };
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 3600_000);
    const series = await deps.registry.metricsHistory(id, from, to);
    return { deviceId: id, from: from.toISOString(), to: to.toISOString(), samples: series };
  });

  app.patch("/api/v1/devices/:id", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; notes?: string | null; tags?: string[] };
    const row = await deps.registry.getOwned(id, req.user!.id, req.user!.role === "admin");
    if (!row) throw app.errors.notFound("Device");
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 255) {
        throw app.errors.badRequest("name must be 1-255 chars");
      }
      await deps.registry.rename(id, body.name.trim());
    }
    if (body.notes !== undefined) await deps.registry.setNotes(id, body.notes);
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string")) {
        throw app.errors.badRequest("tags must be string[]");
      }
      await deps.registry.setTags(id, body.tags.slice(0, 20));
    }
    await deps.audit.log({
      actorType: "user",
      actorId: req.user!.id,
      action: "device.update",
      targetType: "device",
      targetId: id,
      meta: { fields: Object.keys(body ?? {}) },
      ip: req.ip,
    });
    reply.code(204);
  });

  app.delete("/api/v1/devices/:id", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await deps.registry.getOwned(id, req.user!.id, req.user!.role === "admin");
    if (!row) throw app.errors.notFound("Device");
    await deps.registry.remove(id);
    await deps.audit.log({
      actorType: "user",
      actorId: req.user!.id,
      action: "device.delete",
      targetType: "device",
      targetId: id,
      ip: req.ip,
    });
    reply.code(204);
  });

  // Send a live command to an agent (metrics.poll etc.)
  app.post("/api/v1/devices/:id/poll", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await deps.registry.getOwned(id, req.user!.id, req.user!.role === "admin");
    if (!owned) throw app.errors.notFound("Device");
    if (!deps.hub.isOnline(id)) throw app.errors.badRequest("device offline");
    const ok = deps.hub.send(id, { v: 1, id: `srv-${Date.now()}`, cmd: "metrics.poll", ts: Date.now() });
    if (!ok) throw app.errors.badRequest("send failed");
    reply.code(202);
    return { queued: true };
  });

  // Create a relay session (one-time token) for a channel on a device
  app.post("/api/v1/devices/:id/sessions", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { channel?: number } | null;
    const channel = Number(body?.channel ?? Channel.Terminal);
    if (!Object.values(Channel).includes(channel as never)) {
      throw app.errors.badRequest("invalid channel");
    }
    const row = await deps.registry.getOwned(id, req.user!.id, req.user!.role === "admin");
    if (!row) throw app.errors.notFound("Device");
    // rights enforcement: admin bypasses, others need channel rights on the device's group
    let rights = 0;
    if (deps.groups && req.user!.role !== "admin" && row.group_id) {
      rights = await deps.groups.effectiveRights(req.user!, row.group_id);
      if (!canUseChannel(rights, channel)) throw app.errors.forbidden();
    }
    try {
      const session = await deps.sessions.create(id, channel, rights, req.user!.id);
      await deps.audit.log({
        actorType: "user",
        actorId: req.user!.id,
        action: "session.create",
        targetType: "device",
        targetId: id,
        meta: { channel },
        ip: req.ip,
      });
      return { token: session.token, channel: session.channel, expiresInMs: 60_000 };
    } catch (e) {
      throw app.errors.badRequest(e instanceof Error ? e.message : "session create failed");
    }
  });
}
