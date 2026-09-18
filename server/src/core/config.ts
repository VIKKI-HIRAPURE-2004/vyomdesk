import dotenv from "dotenv";
dotenv.config();

export interface Config {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  publicUrl: string;
  db: {
    client: "sqlite3" | "pg";
    filename?: string;
    url?: string;
  };
  jwtSecret: string;
  encryptionKey: string;
  jwtTtl: number;
  agentPingInterval: number;
  /** REST rate limiting (per-IP sliding window) */
  rateLimit: {
    /** global /api/* bucket */
    apiWindowMs: number;
    apiMax: number;
    /** stricter login/register bucket */
    authWindowMs: number;
    authMax: number;
  };
  tls: { cert?: string; key?: string };
  brandName: string;
  /** SMTP for email alerts (P1.9). When unset, email-channel rules error at notify time. */
  smtp?: {
    host: string;
    port: number;
    user?: string;
    pass?: string;
    from: string;
  };
}

function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function loadConfig(): Config {
  const rawEnv = process.env.NODE_ENV ?? "development";
  const env: Config["env"] =
    rawEnv === "production" ? "production" : rawEnv === "test" ? "test" : "development";
  const dev = env !== "production";

  const jwtSecret = process.env.VYOM_JWT_SECRET ?? (dev ? "dev-secret-do-not-use-in-prod" : "");
  const encryptionKey =
    process.env.VYOM_ENCRYPTION_KEY ?? (dev ? "dev-enc-key-do-not-use-in-prod-32b" : "");

  if (!dev) {
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error("VYOM_JWT_SECRET required (>=32 chars) in production");
    }
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error("VYOM_ENCRYPTION_KEY required (>=32 chars) in production");
    }
  }

  const dbClient = process.env.VYOM_DB_CLIENT === "pg" ? "pg" : "sqlite3";

  const tlsCert = process.env.VYOM_TLS_CERT;
  const tlsKey = process.env.VYOM_TLS_KEY;
  if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
    throw new Error("VYOM_TLS_CERT and VYOM_TLS_KEY must be set together");
  }

  const smtpHost = process.env.VYOM_SMTP_HOST;
  const smtp = smtpHost
    ? {
        host: smtpHost,
        port: num(process.env.VYOM_SMTP_PORT, 587),
        user: process.env.VYOM_SMTP_USER,
        pass: process.env.VYOM_SMTP_PASS,
        from: process.env.VYOM_SMTP_FROM ?? "alerts@vyomdesk.local",
      }
    : undefined;

  return {
    env,
    host: process.env.HOST ?? "0.0.0.0",
    port: num(process.env.PORT, 4430),
    publicUrl: (process.env.VYOM_PUBLIC_URL ?? "http://localhost:4430").replace(/\/+$/, ""),
    db: {
      client: dbClient,
      filename: process.env.VYOM_DB_FILENAME ?? "./data/vyomdesk.sqlite",
      url: process.env.VYOM_DB_URL,
    },
    jwtSecret,
    encryptionKey,
    jwtTtl: num(process.env.VYOM_JWT_TTL, 86400),
    agentPingInterval: num(process.env.VYOM_AGENT_PING_INTERVAL, 30),
    rateLimit: {
      apiWindowMs: num(process.env.VYOM_RATELIMIT_API_WINDOW_MS, 60_000),
      apiMax: num(process.env.VYOM_RATELIMIT_API_MAX, 300),
      authWindowMs: num(process.env.VYOM_RATELIMIT_AUTH_WINDOW_MS, 60_000),
      authMax: num(process.env.VYOM_RATELIMIT_AUTH_MAX, 10),
    },
    tls: {
      cert: tlsCert,
      key: tlsKey,
    },
    /**
     * Agent TLS trust: when the server uses a self-signed/private CA cert,
     * agents need its PEM to verify. Agents set VYOM_TLS_CA_PEM (path) or
     * VYOM_TLS_INSECURE=1 to skip verification (dev only).
     */
    brandName: process.env.VYOM_BRAND_NAME ?? "VyomDesk",
    smtp,
  };
}