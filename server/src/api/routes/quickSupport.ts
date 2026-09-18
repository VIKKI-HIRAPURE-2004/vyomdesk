import type { FastifyInstance } from 'fastify';
import { Channel } from '@vyomdesk/shared';
import type { QuickSupportService } from '../../services/quickSupportService.js';
import type { AuditService } from '../../services/auditService.js';
import type { GroupService } from '../../services/groupService.js';
import { canCreateQuickSupport } from '../../services/quickSupportService.js';
import { Errors } from '../../util/errors.js';

/**
 * Quick-support REST routes.
 *  POST /api/v1/quick-support/:deviceId   (auth)   -> create a code (admin or RemoteControl right)
 *  GET  /api/v1/quick-support/:deviceId   (auth)   -> masked active codes
 *  POST /api/v1/quick-support/redeem      (public) -> burn code, get relay token
 *  DELETE /api/v1/quick-support/:deviceId (auth)   -> revoke a code
 * The redeem endpoint is intentionally unauthenticated: the 9-digit code +
 * optional password IS the credential (GetScreen-style ad-hoc support).
 */
export async function quickSupportRoutes(
  app: FastifyInstance,
  deps: {
    quick: QuickSupportService;
    audit: AuditService;
    groups?: GroupService;
  },
) {
  app.post('/api/v1/quick-support/:deviceId', { preHandler: [app.auth] }, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = (req.body ?? {}) as { password?: string; ttlMinutes?: number; rights?: number };
    if (body.password !== undefined && typeof body.password !== 'string') {
      throw Errors.badRequest('password must be a string');
    }
    if (body.password !== undefined && body.password.length > 0 && body.password.length < 4) {
      throw Errors.badRequest('password must be >= 4 chars');
    }
    // rights check: admin bypass; others need RemoteControl on the device's group
    if (deps.groups && req.user!.role !== 'admin') {
      const row = await deps.quick.deviceGroup(deviceId).catch(() => null);
      if (!row) throw Errors.notFound('Device');
      const rights = await deps.groups.effectiveRights(req.user!, row);
      if (!canCreateQuickSupport(req.user!.role, rights)) throw Errors.forbidden();
    }
    const created = await deps.quick.create(deviceId, req.user!.id, {
      password: body.password || undefined,
      ttlMinutes: body.ttlMinutes,
    });
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'quicksupport.create',
      targetType: 'device',
      targetId: deviceId,
      ip: req.ip,
    });
    reply.code(201);
    return created;
  });

  app.get('/api/v1/quick-support/:deviceId', { preHandler: [app.auth] }, async (req) => {
    const { deviceId } = req.params as { deviceId: string };
    const codes = await deps.quick.listForDevice(deviceId);
    return { codes };
  });

  app.delete('/api/v1/quick-support/:deviceId', { preHandler: [app.auth] }, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = (req.body ?? {}) as { code?: string };
    if (!body.code) throw Errors.badRequest('code required');
    await deps.quick.revoke(deviceId, body.code);
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'quicksupport.revoke',
      targetType: 'device',
      targetId: deviceId,
      ip: req.ip,
    });
    reply.code(204);
  });

  // PUBLIC redeem: code (+ optional password) -> one-time relay session token
  app.post('/api/v1/quick-support/redeem', async (req) => {
    const body = (req.body ?? {}) as {
      code?: string;
      password?: string;
      channel?: number;
    };
    if (!body.code || !/^\d{9}$/.test(body.code)) throw Errors.badRequest('code must be 9 digits');
    const channel = Number(body.channel ?? Channel.Desktop);
    if (!Object.values(Channel).includes(channel as never)) throw Errors.badRequest('invalid channel');
    const result = await deps.quick.redeem(body.code, body.password, channel);
    return {
      token: result.token,
      channel: result.channel,
      deviceId: result.deviceId,
      wsUrl: '/relay.ashx',
      expiresInMs: 60_000,
    };
  });
}