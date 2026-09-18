import type { FastifyInstance } from "fastify";
import type { Knex } from "knex";
import { randomUUID } from "node:crypto";
import { Channel, FrameFlag, FRAME_HEADER_SIZE } from "@vyomdesk/shared";
import { logger } from "../util/logger.js";
import type { AgentHub } from "../ws/agentHub.js";
import type { SessionManager } from "../services/sessionManager.js";
import type { DeviceRegistry } from "../services/deviceRegistry.js";
import type { RecordingService } from "../services/recordingService.js";
import { Errors } from "../util/errors.js";

/**
 * relaySocket - /relay.ashx browser relay endpoint.
 * Browser connects with a one-time session token (query param), the server
 * verifies it, asks the agent to open the channel, then pipes raw bytes
 * both directions. The server never inspects relayed payloads.
 * (Relay concept adapted from MeshCentral relay.js, Apache-2.0.)
 *
 * Wire format browser<->server (binary WS frames):
 *   [channel:1][flags:1][len:2 BE][payload]
 * Same framing is sent to the agent control socket as cmd=relay.data
 * envelope? No - for now we tunnel via the agent control socket using
 * cmd "relay.open" / "relay.data" / "relay.close" with base64 payload.
 * (A dedicated agent relay socket can replace this later.)
 */

const MAX_FRAME = 64 * 1024;

export function registerRelaySocket(
  app: FastifyInstance,
  deps: { hub: AgentHub; db: Knex; sessions: SessionManager; registry: DeviceRegistry; recordings?: RecordingService },
) {
  app.get("/relay.ashx", { websocket: true }, (socket, req) => {
    let bound = false;
    let deviceId = "";
    let sessionLogId: string | null = null;
    let bytesIn = 0;
    let bytesOut = 0;

    const cleanup = () => {
      if (bound) {
        deps.sessions.unbindBrowser(deviceId);
        // tell agent to close the channel
        deps.hub.send(deviceId, {
          v: 1, id: "", cmd: "relay.close", ts: Date.now(),
          data: { channel: currentChannel },
        });
      }
      if (sessionLogId) {
        deps.db("session_logs").where({ id: sessionLogId }).update({
          ended_at: deps.db.fn.now(),
          bytes_in: bytesIn,
          bytes_out: bytesOut,
        }).catch(() => {});
      }
    };

    const fail = (code: number, reason: string) => {
      logger.warn({ reason, ip: req.ip }, "relay connect failed");
      try { socket.close(code, reason); } catch { /* noop */ }
    };

    let currentChannel = 0;

    socket.on("message", (raw: Buffer, isBinary: boolean) => {
      // Phase 1: auth via first text message or query token
      if (!bound) {
        const token = String(raw.toString().trim());
        const session = deps.sessions.consume(token);
        if (!session) return fail(4001, "invalid or expired token");
        const agent = deps.hub.get(session.deviceId);
        if (!agent || agent.ws.readyState !== agent.ws.OPEN) return fail(4002, "device offline");
        deviceId = session.deviceId;
        currentChannel = session.channel;
        bound = true;
        // ask agent to open channel
        const ok = deps.hub.send(deviceId, {
          v: 1, id: "", cmd: "relay.open", ts: Date.now(),
          data: { channel: session.channel, rights: session.rights },
        });
        if (!ok) return fail(4002, "agent unreachable");
        deps.sessions.bindBrowser(session.deviceId, {
          ws: socket as import("ws").WebSocket,
          session,
          sessionLogId: null,
          bytesIn: 0,
          bytesOut: 0,
        });
        // start session log
        const logId = randomUUID();
        deps.db("session_logs").insert({
          id: logId,
          device_id: session.deviceId,
          user_id: session.userId,
          protocol: session.channel,
          started_at: deps.db.fn.now(),
        }).then(() => { sessionLogId = logId; }).catch(() => {});
        logger.info({ deviceId, channel: session.channel }, "relay pipe bound");
        // send open-ack frame so the browser knows the channel is live:
        // [channel:1][flags=0x01 Open][len:0]
        const ack = Buffer.alloc(FRAME_HEADER_SIZE);
        ack[0] = session.channel;
        ack[1] = FrameFlag.Open;
        ack[2] = 0;
        ack[3] = 0;
        (socket as import("ws").WebSocket).send(ack, { binary: true });
        return;
      }

      // Phase 2: binary frame routing browser -> agent
      if (isBinary) {
        if (raw.length < FRAME_HEADER_SIZE || raw.length > MAX_FRAME) return;
        // Parse [channel][flags][len:2 BE] and forward only the payload.
        const channel = raw[0]!;
        const length = (raw[2]! << 8) | raw[3]!;
        const payload = raw.subarray(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + length);
        bytesIn += payload.length;
        deps.hub.send(deviceId, {
          v: 1, id: "", cmd: "relay.data", ts: Date.now(),
          data: { channel, b64: payload.toString("base64") },
        });
      }
    });

    socket.on("close", () => cleanup());
    socket.on("error", () => cleanup());
  });

  // Agent-side relay ack/data routing (called from agentSocket on relay.* cmds)
  deps.hub.on("relay.agentData", (payload: { deviceId: string; channel: number; b64: string }) => {
    const pipe = deps.sessions.getPipe(payload.deviceId);
    if (!pipe || pipe.ws.readyState !== pipe.ws.OPEN) return;
    const data = Buffer.from(payload.b64, "base64");
    // P1.10: tee into the active recording (if any) BEFORE framing
    if (deps.recordings && payload.channel === 2) {
      deps.recordings.recordFrame(payload.deviceId, data);
    }
    // Wrap agent bytes in a tunnel frame: [channel][flags=Data][len:2 BE][payload]
    const frame = Buffer.alloc(FRAME_HEADER_SIZE + data.length);
    frame[0] = payload.channel & 0xff;
    frame[1] = FrameFlag.Data;
    frame[2] = (data.length >> 8) & 0xff;
    frame[3] = data.length & 0xff;
    data.copy(frame, FRAME_HEADER_SIZE);
    pipe.ws.send(frame, { binary: true });
    pipe.bytesOut += data.length;
  });

  deps.hub.on("relay.agentClosed", (payload: { deviceId: string; channel: number }) => {
    const pipe = deps.sessions.getPipe(payload.deviceId);
    if (!pipe) return;
    try { pipe.ws.close(4000, "agent closed channel"); } catch { /* noop */ }
  });
}