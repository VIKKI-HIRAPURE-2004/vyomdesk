import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Knex } from "knex";
import type { AgentHub } from "./agentHub.js";
import type { DeviceRegistry } from "../services/deviceRegistry.js";
import type { EnrollTokenService } from "../services/enrollTokenService.js";
import type { AuditService } from "../services/auditService.js";
import type { AlertService } from "../services/alertService.js";
import type { Config } from "../core/config.js";
import { logger } from "../util/logger.js";

/**
 * agentSocket — /agent.ashx control channel.
 * Handshake: hello → (new device: send publicKey, trust-on-first-use) → authOk.
 * Verified devices: Ed25519 challenge-response (nonce signed by agent key).
 * (Challenge-response concept adapted from MeshCentral agent auth, Apache-2.0.)
 */

interface HelloData {
  deviceId?: string;
  installToken?: string; // one-time per-user enroll token (first registration only)
  emailHint?: string; // display hint only, never trusted for ownership
  hostname?: string;
  version?: string;
  platform?: string;
  platformVersion?: string;
  arch?: string;
  hardwareId?: string;
  publicKey?: string; // hex, only accepted on first registration
}

interface PendingAuth {
  deviceId: string;
  nonce: Buffer;
  publicKey: string | null;
  hello: HelloData; // kept so challenge-response reconnects also refresh device info
  deadline: number;
}

const HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_METRICS_PER_MIN = 12;

export function registerAgentSocket(
  app: FastifyInstance,
  deps: { hub: AgentHub; db: Knex; registry: DeviceRegistry; enrollTokens: EnrollTokenService; audit: AuditService; config: Config; alerts: AlertService },
) {
  const pending = new Map<import("ws").WebSocket, PendingAuth>();
  const metricsRate = new Map<string, { count: number; windowStart: number }>();

  app.get("/agent.ashx", { websocket: true }, (socket, req) => {
    let authenticated = false;
    let deviceId = "";

    const fail = (reason: string) => {
      logger.warn({ reason, ip: req.ip }, "agent handshake failed");
      socket.close(4001, reason);
    };

    const finishAuth = async (devRow: { id: string }) => {
      authenticated = true;
      deviceId = devRow.id;
      deps.hub.add({
        deviceId,
        ws: socket as import("ws").WebSocket,
        connectedAt: Date.now(),
        lastPong: Date.now(),
        meta: {},
      });
      (socket as any).__deviceId = deviceId;
      await deps.registry.touch(deviceId, req.ip ?? null);
      deps.hub.broadcast("device.online", { deviceId });
      send(socket, { v: 1, id: "", cmd: "authOk", ts: Date.now(), data: { heartbeatSec: deps.config.agentPingInterval, metricsSec: 60 } });
      await deps.audit.log({
        actorType: "agent",
        actorId: deviceId,
        action: "agent.connected",
        targetType: "device",
        targetId: deviceId,
        ip: req.ip ?? null,
      });
    };

    const onMessage = async (raw: unknown) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return fail("bad json");
      }
      const { cmd, id } = msg ?? {};

      if (!authenticated) {
        if (cmd === "hello") {
          const d: HelloData = msg.data ?? {};
          if (!d.deviceId || typeof d.deviceId !== "string" || d.deviceId.length > 128) {
            return fail("invalid deviceId");
          }
          const row = await deps.registry.get(d.deviceId);
          if (row?.public_key) {
            // Known device: challenge-response
            const nonce = crypto.randomBytes(32);
            pending.set(socket as import("ws").WebSocket, {
              deviceId: d.deviceId,
              nonce,
              publicKey: row.public_key,
              hello: d,
              deadline: Date.now() + HANDSHAKE_TIMEOUT_MS,
            });
            send(socket, {
              v: 1,
              id: id ?? "",
              cmd: "challenge",
              ts: Date.now(),
              data: { nonce: nonce.toString("base64") },
            });
          } else {
            // First contact: requires a one-time per-user install token.
            // Resolves device ownership (devices.owner_user_id) and marks token used.
            if (!d.installToken || typeof d.installToken !== "string") {
              return fail("install token required");
            }
            const ownerUserId = await deps.enrollTokens.consume(d.installToken, d.deviceId);
            if (!ownerUserId) return fail("invalid or expired install token");
            const { row: newRow } = await deps.registry.upsertFromHello({
              deviceId: d.deviceId,
              hostname: d.hostname ?? "",
              agentVersion: d.version,
              platform: d.platform ?? "unknown",
              platformVersion: d.platformVersion,
              arch: d.arch,
              hardwareId: d.hardwareId,
              ip: req.ip ?? null,
              ownerUserId,
            });
            const pk = isHex(d.publicKey) ? d.publicKey : null;
            if (pk) await deps.registry.setPublicKey(newRow.id, pk);
            await finishAuth(newRow);
          }
        } else if (cmd === "auth") {
          const p = pending.get(socket as import("ws").WebSocket);
          if (!p) return fail("unexpected auth");
          pending.delete(socket as import("ws").WebSocket);
          if (Date.now() > p.deadline) return fail("auth timeout");
          const sig = Buffer.from(String(msg.data?.sig ?? ""), "base64");
          const pubKey = ed25519PublicKeyFromHex(p.publicKey!);
          if (!pubKey) return fail("bad public key");
          const ok = crypto.verify(null, p.nonce, pubKey, sig);
          if (!ok) {
            await deps.audit.log({
              actorType: "system",
              action: "agent.auth_failed",
              targetType: "device",
              targetId: p.deviceId,
              meta: { ip: req.ip ?? null },
            });
            return fail("bad signature");
          }
          const row = await deps.registry.get(p.deviceId);
          if (!row) return fail("device vanished");
          // refresh device info (version/hostname/agent fields) on
          // challenge-response reconnects too, not just first contact
          await deps.registry.upsertFromHello({
            deviceId: p.deviceId,
            hostname: p.hello.hostname ?? row.name,
            agentVersion: p.hello.version,
            platform: p.hello.platform ?? row.platform,
            platformVersion: p.hello.platformVersion,
            arch: p.hello.arch,
            hardwareId: p.hello.hardwareId,
            ip: req.ip ?? null,
          });
          await finishAuth(row);
        } else {
          return fail("auth required");
        }
        return;
      }

      // ----- authenticated commands -----
      switch (cmd) {
        case "ping":
          deps.hub.get(deviceId) && (deps.hub.get(deviceId)!.lastPong = Date.now());
          send(socket, { v: 1, id, cmd: "pong", ts: Date.now() });
          break;
        case "pong":
          if (deps.hub.get(deviceId)) deps.hub.get(deviceId)!.lastPong = Date.now();
          break;
        case "metrics.push": {
          // simple rate limit
          const now = Date.now();
          const r = metricsRate.get(deviceId) ?? { count: 0, windowStart: now };
          if (now - r.windowStart > 60_000) {
            r.count = 0;
            r.windowStart = now;
          }
          r.count++;
          metricsRate.set(deviceId, r);
          if (r.count > MAX_METRICS_PER_MIN) return; // drop silently
          const m = msg.data ?? {};
          await deps.registry.insertMetrics(deviceId, {
            cpuPct: num(m.cpuPct),
            memPct: num(m.memPct),
            memUsedMb: num(m.memUsedMb),
            netRxKb: num(m.netRxKb),
            netTxKb: num(m.netTxKb),
            uptimeS: m.uptimeS != null ? Number(m.uptimeS) : undefined,
          });
          deps.hub.broadcast("metrics", { deviceId, ...m });
          // P1.9: evaluate alert rules against this sample (best-effort;
          // rule errors never break the metrics pipeline). Agent sends
          // camelCase; rules use the DB's snake_case metric names.
          deps.alerts.evaluate(deviceId, {
            cpu_pct: num(m.cpuPct),
            mem_pct: num(m.memPct),
            mem_used_mb: num(m.memUsedMb),
            net_rx_kb: num(m.netRxKb),
            net_tx_kb: num(m.netTxKb),
          }).catch(() => {});
          break;
        }
        case "event": {
          deps.hub.broadcast(String(msg.data?.type ?? "event"), { deviceId, ...(msg.data ?? {}) });
          break;
        }
        case "relay.data": {
          // Agent -> browser tunnel bytes. Route via hub event to relaySocket.
          const b64 = String(msg.data?.b64 ?? "");
          const channel = Number(msg.data?.channel ?? 0);
          if (b64) deps.hub.emit("relay.agentData", { deviceId, channel, b64 });
          break;
        }
        case "relay.closed": {
          deps.hub.emit("relay.agentClosed", { deviceId, channel: Number(msg.data?.channel ?? 0) });
          break;
        }
        case "update.ack": {
          deps.hub.emit("agent.update.ack", { deviceId, to: String(msg.data?.to ?? "") });
          break;
        }
        case "update.failed": {
          deps.hub.emit("agent.update.failed", { deviceId, error: String(msg.data?.error ?? "unknown") });
          break;
        }
        default:
          send(socket, { v: 1, id, cmd: "err", ts: Date.now(), data: { code: "UNKNOWN_CMD", message: `unknown cmd ${cmd}` } });
      }
    };

    socket.on("message", (raw) => {
      onMessage(raw).catch((e) => logger.error({ err: e }, "agent msg handler error"));
    });

    socket.on("close", () => {
      pending.delete(socket as import("ws").WebSocket);
      if (deviceId) {
        deps.hub.remove(deviceId, socket as import("ws").WebSocket);
        deps.hub.broadcast("device.offline", { deviceId });
      }
    });

    // Handshake timeout guard
    setTimeout(() => {
      if (!authenticated) {
        try {
          socket.close(4002, "handshake timeout");
        } catch {
          /* already closed */
        }
      }
    }, HANDSHAKE_TIMEOUT_MS);
  });
}

function send(socket: import("ws").WebSocket, env: object) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(env));
}

/** Ed25519 SPKI DER prefix (12 bytes): SEQ(35) { SEQ(5) { OID 1.3.101.112 }, BITSTRING(32) } */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Accept stored public key hex as either:
 *  - raw Ed25519 key (32 bytes / 64 hex chars) — what the Go agent sends
 *  - SPKI DER (44 bytes / 88 hex chars) — what Node exports
 * Returns a KeyObject usable for crypto.verify, or null if invalid.
 */
function ed25519PublicKeyFromHex(hex: string): import("node:crypto").KeyObject | null {
  const b = Buffer.from(hex, "hex");
  if (b.length === 32) {
    return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, b]), format: "der", type: "spki" });
  }
  if (b.length === 44) {
    return crypto.createPublicKey({ key: b, format: "der", type: "spki" });
  }
  return null;
}

function isHex(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s) && s.length >= 64;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
