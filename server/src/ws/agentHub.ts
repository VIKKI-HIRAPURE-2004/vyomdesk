import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";

export interface AgentConnection {
  deviceId: string;
  ws: WebSocket;
  connectedAt: number;
  lastPong: number;
  meta: Record<string, unknown>;
}

/**
 * AgentHub - tracks connected agents (concept adapted from MeshCentral
 * meshagent.js, Apache-2.0). Maps deviceId -> live socket.
 * Also an EventEmitter: device.online / device.offline / metrics.
 */
export class AgentHub extends EventEmitter {
  private agents = new Map<string, AgentConnection>();

  constructor() {
    super();
    this.setMaxListeners(200);
  }

  add(conn: AgentConnection): void {
    const old = this.agents.get(conn.deviceId);
    if (old && old.ws !== conn.ws) old.ws.close(4000, "replaced");
    this.agents.set(conn.deviceId, { ...conn, connectedAt: Date.now(), lastPong: Date.now() });
  }

  remove(deviceId: string, ws?: WebSocket): void {
    const cur = this.agents.get(deviceId);
    if (!cur) return;
    if (ws && cur.ws !== ws) return; // stale socket
    this.agents.delete(deviceId);
  }

  get(deviceId: string): AgentConnection | undefined {
    return this.agents.get(deviceId);
  }

  isOnline(deviceId: string): boolean {
    return this.agents.has(deviceId);
  }

  /** Send JSON control envelope to one agent. */
  send(deviceId: string, env: object): boolean {
    const conn = this.agents.get(deviceId);
    if (!conn || conn.ws.readyState !== conn.ws.OPEN) return false;
    conn.ws.send(JSON.stringify(env));
    return true;
  }

  onlineDeviceIds(): string[] {
    return [...this.agents.keys()];
  }

  /** Broadcast an event to browser subscribers (via EventEmitter). */
  broadcast(type: string, data: unknown): void {
    this.emit(type, data);
  }

  get size(): number {
    return this.agents.size;
  }
}
