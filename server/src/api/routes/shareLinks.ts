import type { FastifyInstance } from 'fastify';
import { Channel } from '@vyomdesk/shared';
import type { ShareLinkService } from '../../services/shareLinkService.js';
import type { AuditService } from '../../services/auditService.js';
import type { GroupService } from '../../services/groupService.js';
import { canCreateShareLink } from '../../services/shareLinkService.js';
import { Errors } from '../../util/errors.js';

/**
 * Guest share-link REST routes (P1.8).
 *  POST   /api/v1/share-links/:deviceId   (auth)   -> create a link (admin or RemoteControl+GuestSharing)
 *  GET    /api/v1/share-links/:deviceId   (auth)   -> masked links for the device
 *  DELETE /api/v1/share-links/:deviceId   (auth)   -> revoke a link by slug
 *  POST   /api/v1/share-links/resolve     (public) -> slug (+ password) -> relay session token
 * The resolve endpoint is intentionally unauthenticated: the slug + optional
 * password IS the credential (MeshCentral-style guest sharing).
 */
export async function shareLinkRoutes(
  app: FastifyInstance,
  deps: {
    share: ShareLinkService;
    audit: AuditService;
    groups?: GroupService;
  },
) {
  app.post('/api/v1/share-links/:deviceId', { preHandler: [app.auth] }, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = (req.body ?? {}) as {
      password?: string;
      expiresAt?: string;
      guestName?: string;
    };
    if (body.password !== undefined && typeof body.password !== 'string') {
      throw Errors.badRequest('password must be a string');
    }
    if (body.password !== undefined && body.password.length > 0 && body.password.length < 4) {
      throw Errors.badRequest('password must be >= 4 chars');
    }
    if (body.guestName !== undefined && typeof body.guestName !== 'string') {
      throw Errors.badRequest('guestName must be a string');
    }
    if (body.guestName && body.guestName.length > 120) {
      throw Errors.badRequest('guestName too long (max 120)');
    }
    // rights: admin bypass; others need RemoteControl+GuestSharing on the device's group
    if (deps.groups && req.user!.role !== 'admin') {
      const row = await deps.share.deviceGroup(deviceId).catch(() => null);
      if (!row) throw Errors.notFound('Device');
      const rights = await deps.groups.effectiveRights(req.user!, row);
      if (!canCreateShareLink(req.user!.role, rights)) throw Errors.forbidden();
    }
    const created = await deps.share.create(deviceId, req.user!.id, {
      password: body.password || undefined,
      expiresAt: body.expiresAt,
      guestName: body.guestName,
    });
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'sharelink.create',
      targetType: 'device',
      targetId: deviceId,
      meta: { slug: created.slug },
      ip: req.ip,
    });
    reply.code(201);
    return created;
  });

  app.get('/api/v1/share-links/:deviceId', { preHandler: [app.auth] }, async (req) => {
    const { deviceId } = req.params as { deviceId: string };
    const links = await deps.share.listForDevice(deviceId);
    return { links };
  });

  app.delete('/api/v1/share-links/:deviceId', { preHandler: [app.auth] }, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const body = (req.body ?? {}) as { slug?: string };
    if (!body.slug) throw Errors.badRequest('slug required');
    await deps.share.revoke(deviceId, body.slug);
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'sharelink.revoke',
      targetType: 'device',
      targetId: deviceId,
      ip: req.ip,
    });
    reply.code(204);
  });

  // PUBLIC resolve: slug (+ optional password) -> one-time relay session token.
  // Multi-use until expiry: each resolve mints a fresh session token.
  app.post('/api/v1/share-links/resolve', async (req) => {
    const body = (req.body ?? {}) as {
      slug?: string;
      password?: string;
      channel?: number;
    };
    if (!body.slug || typeof body.slug !== 'string') throw Errors.badRequest('slug required');
    const channel = Number(body.channel ?? Channel.Desktop);
    if (!Object.values(Channel).includes(channel as never)) throw Errors.badRequest('invalid channel');
    const result = await deps.share.resolve(body.slug, body.password, channel);
    return {
      token: result.token,
      channel: result.channel,
      deviceId: result.deviceId,
      wsUrl: '/relay.ashx',
      expiresInMs: 60_000,
    };
  });
}