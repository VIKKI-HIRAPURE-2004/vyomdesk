import type { FastifyInstance } from "fastify";
import type { EnrollTokenService } from "../../services/enrollTokenService.js";
import type { AuditService } from "../../services/auditService.js";

/** Per-user agent enroll tokens: Add Device -> token -> agent download binding. */
export async function enrollRoutes(
  app: FastifyInstance,
  deps: { tokens: EnrollTokenService; audit: AuditService },
) {
  // Issue a one-time installation token bound to the logged-in user.
  app.post("/api/v1/devices/enroll-token", { preHandler: [app.auth] }, async (req) => {
    const { token, expiresAt } = await deps.tokens.issue(req.user!.id, req.user!.email ?? null);
    await deps.audit.log({
      actorType: "user",
      actorId: req.user!.id,
      action: "device.enroll_token.issue",
      ip: req.ip,
    });
    return { installToken: token, emailHint: req.user!.email ?? null, expiresAt: expiresAt.toISOString() };
  });

  // Revoke one of my tokens.
  app.post("/api/v1/devices/enroll-token/:id/revoke", { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deps.tokens.revoke(id, req.user!.id);
    if (!ok) throw app.errors.notFound("Token");
    reply.code(204);
  });
}
