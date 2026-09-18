/** Shared DB/API model shapes (subset used by server + web). */

export interface User {
  id: string;
  email: string;
  name: string;
  role: "superadmin" | "admin" | "tech" | "viewer";
  totp_enabled: boolean;
  last_login: string | null;
  created_at: string;
}

export interface Device {
  id: string;
  group_id: string;
  name: string;
  agent_version: string;
  platform: "windows" | "linux" | "macos" | "android";
  platform_version: string;
  arch: string;
  last_seen: string;
  last_ip: string | null;
  online: boolean;
  tags: string[];
  notes: string | null;
}

export interface DeviceGroup {
  id: string;
  name: string;
  description: string | null;
  device_count: number;
  default_rights: number;
}

export interface DeviceMetrics {
  device_id: string;
  ts: string;
  cpu_pct: number;
  mem_pct: number;
  mem_used_mb: number;
  net_rx_kb: number;
  net_tx_kb: number;
  uptime_s: number;
}
