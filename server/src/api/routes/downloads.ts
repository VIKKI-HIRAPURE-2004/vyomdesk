import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { AgentHub } from "../../ws/agentHub.js";
import type { DeviceRegistry } from "../../services/deviceRegistry.js";
import type { AuditService } from "../../services/auditService.js";
import { Errors } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

/**
 * agentDownloads - serves agent binaries for self-update and first installs.
 * Binaries live in ./downloads/agent/<platform>-<arch>/vyomlink[.exe].
 * GET /downloads/agent/latest.json  -> { version, platforms: {...} }
 * GET /downloads/agent/<platform>-<arch>/<file> -> binary
 *
 * Update trigger: POST /api/v1/devices/:id/update (admin) sends the
 * agent.update envelope with url+sha256; the agent downloads, verifies,
 * swaps itself, acks and restarts.
 * (Update distribution concept adapted from MeshCentral, Apache-2.0.)
 */

const DOWNLOAD_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), // src/api/routes
  "../../../downloads/agent",                   // -> <server>/downloads/agent
);

interface PlatformEntry {
  version: string;
  file: string;
  sha256: string;
  size: number;
}

// latest.json layout:
// { "version": "0.2.0", "platforms": { "windows-amd64": { "file": "vyomlink.exe", "sha256": "...", "size": 123 } } }

export async function agentDownloadRoutes(
  app: FastifyInstance,
  deps: { hub: AgentHub; registry: DeviceRegistry; audit: AuditService },
) {
  // metadata
  app.get("/downloads/agent/latest.json", async (_req, reply) => {
    try {
      const raw = await readFile(path.join(DOWNLOAD_DIR, "latest.json"), "utf8");
      reply.type("application/json").send(raw);
    } catch {
      throw Errors.notFound("Agent downloads manifest");
    }
  });

  // binary download: /downloads/agent/windows-amd64/vyomlink.exe
  app.get("/downloads/agent/:platform/:file", async (req, reply) => {
    const { platform, file } = req.params as { platform: string; file: string };
    if (!/^[\w-]+$/.test(platform) || !/^[\w.]+$/.test(file)) {
      throw Errors.badRequest("bad platform or file");
    }
    const full = path.join(DOWNLOAD_DIR, platform, file);
    if (!full.startsWith(DOWNLOAD_DIR)) throw Errors.badRequest("bad path");
    try {
      const st = await stat(full);
      if (!st.isFile()) throw new Error("not a file");
      const buf = await readFile(full);
      reply.type("application/octet-stream");
      reply.header("content-length", st.size);
      reply.send(buf);
    } catch {
      throw Errors.notFound("Agent binary");
    }
  });

  // trigger an update on one device (admin-only)
  app.post(
    "/api/v1/devices/:id/update",
    { preHandler: [app.auth] },
    async (req, reply) => {
      if (req.user?.role !== "admin") throw app.errors.forbidden();
      const { id } = req.params as { id: string };
      const row = await deps.registry.get(id);
      if (!row) throw Errors.notFound("Device");
      if (!deps.hub.isOnline(id)) throw app.errors.badRequest("device offline");

      // read the manifest
      let manifest: { version?: string; platforms?: Record<string, PlatformEntry> };
      try {
        manifest = JSON.parse(await readFile(path.join(DOWNLOAD_DIR, "latest.json"), "utf8"));
      } catch {
        throw app.errors.badRequest("downloads/agent/latest.json missing; upload a build first");
      }
      const platKey = `${row.platform === "windows" ? "windows" : row.platform}-${row.arch ?? "amd64"}`;
      const entry = manifest.platforms?.[platKey];
      if (!entry) throw app.errors.badRequest(`no binary for platform ${platKey}`);

      const base = `${req.protocol === "https" ? "https" : "http"}://${req.hostname}`;
      const url = `${base}/downloads/agent/${platKey}/${entry.file}`;
      const ok = deps.hub.send(id, {
        v: 1,
        id: `upd-${Date.now()}`,
        cmd: "agent.update",
        ts: Date.now(),
        data: { url, sha256: entry.sha256, version: manifest.version ?? "" },
      });
      if (!ok) throw app.errors.badRequest("send failed");

      await deps.audit.log({
        actorType: "user",
        actorId: req.user!.id,
        action: "device.update.push",
        targetType: "device",
        targetId: id,
        meta: { version: manifest.version, platform: platKey },
        ip: req.ip,
      });
      logger.info({ deviceId: id, version: manifest.version }, "agent update pushed");
      reply.code(202);
      return { queued: true, version: manifest.version ?? "", platform: platKey };
    },
  );

  // agent ack/failed routing (from agentSocket)
  deps.hub.on("agent.update.ack", async (payload: { deviceId: string; to: string }) => {
    await deps.audit.log({
      actorType: "agent",
      actorId: payload.deviceId,
      action: "agent.update.ack",
      targetType: "device",
      targetId: payload.deviceId,
      meta: { version: payload.to },
    });
  });
  deps.hub.on("agent.update.failed", async (payload: { deviceId: string; error: string }) => {
    logger.warn({ ...payload }, "agent update failed");
    await deps.audit.log({
      actorType: "agent",
      actorId: payload.deviceId,
      action: "agent.update.failed",
      targetType: "device",
      targetId: payload.deviceId,
      meta: { error: payload.error },
    });
  });
}

export function downloadsDir(): string {
  return DOWNLOAD_DIR;
}