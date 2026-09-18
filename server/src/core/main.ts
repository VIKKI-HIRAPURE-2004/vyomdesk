import Fastify from "fastify";
import type { Server as HttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import { logger } from "../util/logger.js";
import { Errors } from "../util/errors.js";
import { getDb, closeDb } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { AuthService } from "../services/authService.js";
import { DeviceRegistry } from "../services/deviceRegistry.js";
import { AuditService } from "../services/auditService.js";
import { SessionManager } from "../services/sessionManager.js";
import { authRoutes } from "../api/routes/auth.js";
import { deviceRoutes } from "../api/routes/devices.js";
import { groupRoutes } from "../api/routes/groups.js";
import { agentDownloadRoutes } from "../api/routes/downloads.js";
import { GroupService } from "../services/groupService.js";
import { QuickSupportService } from "../services/quickSupportService.js";
import { quickSupportRoutes } from "../api/routes/quickSupport.js";
import { ShareLinkService } from "../services/shareLinkService.js";
import { shareLinkRoutes } from "../api/routes/shareLinks.js";
import { AlertService, HttpNotifier } from "../services/alertService.js";
import { alertRoutes } from "../api/routes/alerts.js";
import { RecordingService } from "../services/recordingService.js";
import { recordingRoutes } from "../api/routes/recordings.js";
import { AgentHub } from "../ws/agentHub.js";
import { registerAgentSocket } from "../ws/agentSocket.js";
import { registerBrowserEvents } from "../ws/browserEvents.js";
import { registerRelaySocket } from "../ws/relaySocket.js";
import { SlidingWindowLimiter, rateLimitPreHandler } from "../util/rateLimit.js";

export async function buildServer() {
  const config = loadConfig();
  // TLS: when cert+key are configured, serve HTTPS directly (wss for
  // agents and browsers). Termination via reverse proxy (Caddy) is the
  // alternative; this path covers standalone production deploys.
  let httpsOpts: { cert: Buffer; key: Buffer } | undefined;
  if (config.tls.cert && config.tls.key) {
    if (!existsSync(config.tls.cert) || !existsSync(config.tls.key)) {
      throw new Error(`TLS cert/key not found: ${config.tls.cert} / ${config.tls.key}`);
    }
    httpsOpts = {
      cert: readFileSync(config.tls.cert),
      key: readFileSync(config.tls.key),
    };
  }
  // Single generic keeps the app type uniform for all registrations;
  // runtime picks http vs https from the options (https.Server superset).
  const app = Fastify<HttpsServer>({
    logger: logger as any,
    bodyLimit: 1 * 1024 * 1024,
    ...(httpsOpts ? { https: httpsOpts } : {}),
  });
  const hub = new AgentHub();

  const db = getDb(config);
  await runMigrations(db);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true });

  const auth = new AuthService(db, config);
  const registry = new DeviceRegistry(db, hub);
  const audit = new AuditService(db);
  const groups = new GroupService(db);
  const sessions = new SessionManager(db, hub);
  const quick = new QuickSupportService(db, registry, sessions, hub);
  const share = new ShareLinkService(db, registry, sessions, hub);
  const alerts = new AlertService(db, hub, new HttpNotifier(config.smtp));
  await alerts.load();
  const recordings = new RecordingService(db, "./data");

  app.errors = Errors;
  app.decorate("auth", async (req: any) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw Errors.unauthorized();
    req.user = await auth.verifyToken(token);
  });

  // REST rate limiting: global /api/* bucket + stricter auth bucket.
  // Sliding windows, per-IP, in-memory; headers on every response.
  const apiLimiter = new SlidingWindowLimiter({
    windowMs: config.rateLimit.apiWindowMs,
    max: config.rateLimit.apiMax,
  });
  apiLimiter.startSweeping();
  const authLimiter = new SlidingWindowLimiter({
    windowMs: config.rateLimit.authWindowMs,
    max: config.rateLimit.authMax,
  });
  authLimiter.startSweeping();
  const apiRateLimit = rateLimitPreHandler(apiLimiter);
  const authRateLimit = rateLimitPreHandler(authLimiter);

  app.addHook("onRequest", async (req: any, reply: any) => {
    if (!req.url.startsWith("/api/")) return;
    await apiRateLimit(req, reply);
    if (req.url.startsWith("/api/v1/auth/login") || req.url.startsWith("/api/v1/auth/register")) {
      await authRateLimit(req, reply);
    }
  });

  await app.register(websocket);

  // Agent control socket (Ed25519 challenge-response handshake)
  registerAgentSocket(app, { hub, db, registry, audit, config, alerts });

  // Browser event stream (device online/offline, metrics ticks)
  registerBrowserEvents(app, hub);

  // Browser relay endpoint (terminal/desktop/files byte piping; optional recording tee)
  registerRelaySocket(app, { hub, db, sessions, registry, recordings });

  await authRoutes(app, auth);
  await deviceRoutes(app, { registry, hub, audit, sessions, groups });
  await groupRoutes(app, { groups, audit });
  await quickSupportRoutes(app, { quick, audit, groups });
  await shareLinkRoutes(app, { share, audit, groups });
  await alertRoutes(app, { alerts, audit });
  await recordingRoutes(app, { recordings, hub, audit });
  await agentDownloadRoutes(app, { hub, registry, audit });

  app.get("/api/v1/health", async () => ({
    status: "ok",
    agents: hub.size,
    version: "0.1.0",
  }));

  // Production: serve the built web UI (web/dist) with SPA fallback.
  // Dev keeps the Vite dev server (port 5173 proxying /api + WS to 4430).
  const webDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../web/dist",
  );
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
    });
    // SPA fallback: unknown non-API GETs -> index.html (React Router).
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
    });
    logger.info(`serving web UI from ${webDist}`);
  } else {
    logger.info("web/dist not found - API/WS only (dev mode; use the Vite dev server)");
  }

  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: { code: (err as any).code ?? "HTTP_ERROR", message: err.message },
      });
    }
    logger.error({ err }, "unhandled");
    reply.code(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
  });

  return { app, config, hub, registry, audit };
}

export async function main() {
  const { app, config } = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  logger.info(`VyomDesk server listening on ${config.publicUrl} (port ${config.port})`);
}

process.on("SIGINT", async () => {
  await closeDb();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeDb();
  process.exit(0);
});

const isDirectRun =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  main();
}