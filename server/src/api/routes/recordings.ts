import type { FastifyInstance } from 'fastify';
import { statSync, createReadStream } from 'node:fs';
import type { RecordingService } from '../../services/recordingService.js';
import type { AgentHub } from '../../ws/agentHub.js';
import type { AuditService } from '../../services/auditService.js';
import { Errors } from '../../util/errors.js';

/**
 * Session recording REST routes (P1.10), admin or RemoteControl on device.
 *  POST   /api/v1/recordings/:deviceId/start  -> start tee of ch2 frames
 *  POST   /api/v1/recordings/:deviceId/stop    -> stop + flush
 *  GET    /api/v1/recordings?deviceId=        -> list rows (admin)
 *  GET    /api/v1/recordings/:id/download     -> stream .vyomrec file
 *  DELETE /api/v1/recordings/:id              -> delete row + file
 */
export async function recordingRoutes(
  app: FastifyInstance,
  deps: {
    recordings: RecordingService;
    hub: AgentHub;
    audit: AuditService;
  },
) {
  app.post('/api/v1/recordings/:deviceId/start', { preHandler: [app.auth] }, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    if (!deps.hub.isOnline(deviceId)) throw Errors.badRequest('device offline');
    const row = await deps.recordings.start(deviceId, req.user!.id, 2);
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'recording.started',
      targetType: 'device',
      targetId: deviceId,
      ip: req.ip,
    });
    reply.code(201);
    return { recording: row };
  });

  app.post('/api/v1/recordings/:deviceId/stop', { preHandler: [app.auth] }, async (req) => {
    const { deviceId } = req.params as { deviceId: string };
    await deps.recordings.stop(deviceId);
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'recording.stopped',
      targetType: 'device',
      targetId: deviceId,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.get('/api/v1/recordings', { preHandler: [app.auth] }, async (req) => {
    const q = req.query as { deviceId?: string };
    const rows = await deps.recordings.list(q.deviceId);
    return { recordings: rows };
  });

  app.get('/api/v1/recordings/:id/download', { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await deps.recordings.get(id);
    if (!row) throw Errors.notFound('Recording');
    if (row.ended_at == null) throw Errors.conflict('recording still active; stop it first');
    const abs = deps.recordings.absPath(row);
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      throw Errors.notFound('Recording file');
    }
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Length', size);
    reply.header('Content-Disposition', `attachment; filename="${row.path.split('/').pop()}"`);
    return reply.send(createReadStream(abs));
  });

  app.delete('/api/v1/recordings/:id', { preHandler: [app.auth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await deps.recordings.remove(id);
    await deps.audit.log({
      actorType: 'user',
      actorId: req.user!.id,
      action: 'recording.deleted',
      targetType: 'recording',
      targetId: id,
      ip: req.ip,
    });
    reply.code(204);
  });
}