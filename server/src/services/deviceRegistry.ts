import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { Errors } from "../util/errors.js";
import { logger } from "../util/logger.js";
import type { AgentHub } from "../ws/agentHub.js";

export interface DeviceRow {
  id: string;
  group_id: string | null;
  name: string;
  agent_version: string | null;
  platform: string;
  platform_version: string | null;
  arch: string | null;
  public_key: string | null;
  hardware_id: string | null;
  last_seen: string | null;
  last_ip: string | null;
  tags: string | null;
  notes: string | null;
  approved: number;
  created_at: string;
  updated_at: string;
}

export interface DeviceDTO {
  id: string;
  groupId: string | null;
  name: string;
  agentVersion: string | null;
  platform: string;
  platformVersion: string | null;
  arch: string | null;
  lastSeen: string | null;
  lastIp: string | null;
  online: boolean;
  approved: boolean;
  tags: string[];
  notes: string | null;
}

export interface MetricsSample {
  cpuPct?: number;
  memPct?: number;
  memUsedMb?: number;
  netRxKb?: number;
  netTxKb?: number;
  uptimeS?: number;
}

/**
 * DeviceRegistry — device CRUD + registration state.
 * (Registry pattern conceptually adapted from MeshCentral, Apache-2.0.)
 */
export class DeviceRegistry {
  constructor(
    private db: Knex,
    private hub: AgentHub,
  ) {}

  toDTO(row: DeviceRow): DeviceDTO {
    let tags: string[] = [];
    try {
      const parsed = row.tags ? JSON.parse(row.tags) : [];
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      tags = [];
    }
    return {
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      agentVersion: row.agent_version,
      platform: row.platform,
      platformVersion: row.platform_version,
      arch: row.arch,
      lastSeen: row.last_seen,
      lastIp: row.last_ip,
      online: this.hub.isOnline(row.id),
      approved: !!row.approved,
      tags,
      notes: row.notes,
    };
  }

  async get(id: string): Promise<DeviceRow | undefined> {
    return this.db("devices").where({ id }).first();
  }

  async list(filter: { groupId?: string; online?: boolean; q?: string } = {}): Promise<DeviceDTO[]> {
    const q = this.db("devices").select("*");
    if (filter.groupId) q.where({ group_id: filter.groupId });
    if (filter.q) q.where("name", "like", `%${filter.q}%`);
    const rows = await q.orderBy("name");
    const dtos = rows.map((r: DeviceRow) => this.toDTO(r));
    return filter.online === undefined ? dtos : dtos.filter((d) => d.online === filter.online);
  }

  /**
   * Create or refresh a device from an agent hello.
   * Returns { row, isNew }.
   */
  async upsertFromHello(p: {
    deviceId: string;
    hostname: string;
    agentVersion?: string;
    platform: string;
    platformVersion?: string;
    arch?: string;
    hardwareId?: string;
    ip: string | null;
  }): Promise<{ row: DeviceRow; isNew: boolean }> {
    const existing = await this.get(p.deviceId);
    const patch = {
      name: p.hostname || "unknown",
      agent_version: p.agentVersion ?? null,
      platform: p.platform || "unknown",
      platform_version: p.platformVersion ?? null,
      arch: p.arch ?? null,
      hardware_id: p.hardwareId ?? null,
      last_seen: this.db.fn.now() as unknown as string,
      last_ip: p.ip,
    };
    if (existing) {
      await this.db("devices").where({ id: p.deviceId }).update(patch);
      const row = (await this.get(p.deviceId))!;
      return { row, isNew: false };
    }
    // Duplicate hardware fingerprint check (same machine re-installed)
    if (p.hardwareId) {
      const dupe = await this.db("devices").where({ hardware_id: p.hardwareId }).first();
      if (dupe) {
        await this.db("devices").where({ id: dupe.id }).update({ ...patch });
        const row = (await this.get(dupe.id))!;
        return { row, isNew: false };
      }
    }
    await this.db("devices").insert({
      id: p.deviceId,
      ...patch,
      approved: 1,
      tags: JSON.stringify([]),
    });
    logger.info({ deviceId: p.deviceId, name: patch.name }, "device registered");
    const row = (await this.get(p.deviceId))!;
    return { row, isNew: true };
  }

  async setPublicKey(deviceId: string, publicKeyHex: string): Promise<void> {
    await this.db("devices").where({ id: deviceId }).update({ public_key: publicKeyHex });
  }

  async touch(deviceId: string, ip: string | null): Promise<void> {
    await this.db("devices")
      .where({ id: deviceId })
      .update({ last_seen: this.db.fn.now() as unknown as string, last_ip: ip });
  }

  async rename(deviceId: string, name: string): Promise<void> {
    await this.db("devices").where({ id: deviceId }).update({ name });
  }

  async setNotes(deviceId: string, notes: string | null): Promise<void> {
    await this.db("devices").where({ id: deviceId }).update({ notes });
  }

  async setTags(deviceId: string, tags: string[]): Promise<void> {
    await this.db("devices").where({ id: deviceId }).update({ tags: JSON.stringify(tags) });
  }

  async remove(deviceId: string): Promise<void> {
    // Child rows first — FKs have no ON DELETE CASCADE (device_metrics, session_logs).
    await this.db("device_metrics").where({ device_id: deviceId }).del();
    await this.db("session_logs").where({ device_id: deviceId }).del();
    const n = await this.db("devices").where({ id: deviceId }).del();
    if (!n) throw Errors.notFound("Device");
  }

  async insertMetrics(deviceId: string, m: MetricsSample): Promise<void> {
    await this.db("device_metrics").insert({
      id: randomUUID(),
      device_id: deviceId,
      ts: Date.now(),
      cpu_pct: clamp(m.cpuPct),
      mem_pct: clamp(m.memPct),
      mem_used_mb: clamp(m.memUsedMb),
      net_rx_kb: clamp(m.netRxKb),
      net_tx_kb: clamp(m.netTxKb),
      uptime_s: m.uptimeS != null ? Math.max(0, Math.round(m.uptimeS)) : null,
    });
  }

  async metricsHistory(
    deviceId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ ts: number; cpu_pct: number | null; mem_pct: number | null; mem_used_mb: number | null; net_rx_kb: number | null; net_tx_kb: number | null; uptime_s: number | null }>> {
    return this.db("device_metrics")
      .where({ device_id: deviceId })
      .where("ts", ">=", from.getTime())
      .where("ts", "<=", to.getTime())
      .orderBy("ts")
      .select("ts", "cpu_pct", "mem_pct", "mem_used_mb", "net_rx_kb", "net_tx_kb", "uptime_s");
  }
}

function clamp(v: number | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100000, v));
}
