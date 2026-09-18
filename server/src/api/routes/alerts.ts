import type { FastifyInstance } from 'fastify';
import type { AlertService } from '../../services/alertService.js';
import type { AuditService } from '../../services/auditService.js';
import { Errors } from '../../util/errors.js';

/**
 * Alert rules REST routes (P1.9), admin-only (alert rules are tenant-wide).
 *  GET    /api/v1/alerts/rules          -> list rules
 *  POST   /api/v1/alerts/rules          -> create rule
 *  PATCH  /api/v1/alerts/rules/:id      -> patch (name/enabled/channel/webhookUrl/emailTo)
 *  DELETE /api/v1/alerts/rules/:id     -> delete rule (+ its events)
 *  GET    /api/v1/alerts/events         -> list events (query: unresolvedOnly, limit)
 *  POST   /api/v1/alerts/rules/:id/test -> fire notifier once (admin)
 */
export async function alertRoutes(
  app: FastifyInstance,
  deps: {
    alerts: AlertService;
    audit: AuditService;
  },
) {
  const requireAdmin = (req: any) => {
    if (req.user!.role !== 'admin') throw Errors.forbidden();
  };

  app.get('/api/v1/alerts/rules', { preHandler: [app.auth] }, async (req) => {
    requireAdmin(req);
    const rules = await deps.alerts.listRules();
    return { rules };
  });

  app.post('/api/v1/alerts/rules', { preHandler: [app.auth] }, async (req, reply) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as {
      name?: string;
      deviceId?: string | null;
      metric?: string;
      operator?: string;
      threshold?: number;
      durationS?: number;
      channel?: string;
      webhookUrl?: string;
      emailTo?: string;
    };
    const rule = await deps.alerts.createRule({
      name: body.name ?? '',
      deviceId: body.deviceId ?? null,
      metric: body.metric ?? '',
      operator: body.operator ?? '',
      threshold: Number(body.threshold),
      durationS: body.durationS,
      channel: body.channel,
      webhookUrl: body.webhookUrl,
      emailTo: body.emailTo,
      createdBy: req.user!.id,
    });
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'alert.rule.created',
      targetType: 'alertrule',
      targetId: rule.id,
      meta: { name: rule.name },
      ip: req.ip,
    });
    reply.code(201);
    return { rule };
  });

  app.patch('/api/v1/alerts/rules/:id', { preHandler: [app.auth] }, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      name?: string; enabled?: boolean; channel?: string; webhookUrl?: string | null; emailTo?: string | null;
    };
    await deps.alerts.updateRule(id, body);
    return { ok: true };
  });

  app.delete('/api/v1/alerts/rules/:id', { preHandler: [app.auth] }, async (req, reply) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    await deps.alerts.deleteRule(id);
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'alert.rule.deleted',
      targetType: 'alertrule',
      targetId: id,
      ip: req.ip,
    });
    reply.code(204);
  });

  app.get('/api/v1/alerts/events', { preHandler: [app.auth] }, async (req) => {
    requireAdmin(req);
    const q = req.query as { unresolvedOnly?: string; limit?: string };
    const events = await deps.alerts.listEvents({
      unresolvedOnly: q.unresolvedOnly === 'true',
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { events };
  });

  app.post('/api/v1/alerts/rules/:id/test', { preHandler: [app.auth] }, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    await deps.alerts.testNotify(id);
    return { ok: true };
  });
}