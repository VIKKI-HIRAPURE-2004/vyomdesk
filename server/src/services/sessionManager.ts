import { randomBytes } from "node:crypto";
import type { Knex } from "knex";
import { Channel } from "@vyomdesk/shared";
import { logger } from "../util/logger.js";
import type { AgentHub } from "../ws/agentHub.js";

/**
 * SessionManager - relay session lifecycle for browser <-> agent piping.
 * A session authorizes a browser WebSocket to one device for one channel
 * (terminal / desktop / files). The server never inspects relayed bytes.
 * (Relay concept adapted from MeshCentral relay.js, Apache-2.0.)
 */

export interface RelaySession {
  token: string;
  deviceId: string;
  userId: string | null;
  channel: number;
  rights: number;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

const SESSION_TTL_MS = 60_000; // token must be consumed within 60s
const MAX_SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000; // hard cap 4h

interface BrowserPipe {
  ws: import("ws").WebSocket;
  session: RelaySession;
  sessionLogId: string | null;
  bytesIn: number;
  bytesOut: number;
}

export class SessionManager {
  private sessions = new Map<string, RelaySession>();
  private pipes = new Map<string, BrowserPipe>(); // deviceId -> active browser pipe
  private sweeper: NodeJS.Timeout;

  constructor(
    private db: Knex,
    private hub: AgentHub,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  /** Create a session for a device+channel; returns the one-time relay token. */
  async create(deviceId: string, channel: number, rights: number, userId: string | null): Promise<RelaySession> {
    if (!this.hub.isOnline(deviceId)) {
      throw new Error("device offline");
    }
    if (!Object.values(Channel).includes(channel as never)) {
      channel = Channel.Terminal;
    }
    const token = randomBytes(24).toString("base64url");
    const s: RelaySession = {
      token,
      deviceId,
      channel,
      rights,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + MAX_SESSION_LIFETIME_MS,
      used: false,
    };
    this.sessions.set(token, s);
    logger.info({ deviceId, channel, userId }, "relay session created");
    return s;
  }

  /** Consume a one-time token: binds the browser socket to the session. */
  consume(token: string): RelaySession | null {
    const s = this.sessions.get(token);
    if (!s) return null;
    this.sessions.delete(token);
    if (Date.now() > s.expiresAt) return null;
    s.used = true;
    return s;
  }

  /** Register the browser-side pipe after token consumption. */
  bindBrowser(deviceId: string, pipe: BrowserPipe): void {
    this.pipes.set(deviceId, pipe);
  }

  getPipe(deviceId: string): BrowserPipe | undefined {
    return this.pipes.get(deviceId);
  }

  /** Remove a browser pipe (on socket close). */
  unbindBrowser(deviceId: string): void {
    this.pipes.delete(deviceId);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, s] of this.sessions) {
      if (!s.used && now - s.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(token);
      }
    }
  }
}