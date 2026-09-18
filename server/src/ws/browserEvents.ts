import type { FastifyInstance } from "fastify";
import type { AgentHub } from "./agentHub.js";
import { logger } from "../util/logger.js";

/**
 * browserEvents — /api/v1/events browser WebSocket.
 * Auth via `?token=` query (JWT). Broadcasts hub events to subscribed browsers.
 */
export function registerBrowserEvents(app: FastifyInstance, hub: AgentHub) {
  app.get("/api/v1/events", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, "http://x");
    const token = url.searchParams.get("token") ?? "";
    const auth = (req as any).serverLite as { verifyToken?: (t: string) => Promise<unknown> } | undefined;

    if (!token) {
      socket.close(4001, "token required");
      return;
    }
    // Verify JWT out-of-band via app.auth decorated verify (jose)
    void (async () => {
      try {
        const { jwtVerify } = await import("jose");
        const secret = new TextEncoder().encode(process.env.VYOM_JWT_SECRET ?? "dev-secret-do-not-use-in-prod");
        await jwtVerify(token, secret, { issuer: "vyomdesk" });
      } catch {
        socket.close(4001, "invalid token");
        return;
      }
      const sub = (t: string, data: unknown) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: t, data, ts: Date.now() }));
      };
      hub.on("device.online", (d) => sub("device.online", d));
      hub.on("device.offline", (d) => sub("device.offline", d));
      hub.on("metrics", (d) => sub("metrics", d));
      sub("hello", { online: hub.onlineDeviceIds() });
    })();
  });
}
