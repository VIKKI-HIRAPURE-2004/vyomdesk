/** Typed API client for the VyomDesk REST API (docs/07-API-SPEC.md). */

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function token(): string | null {
  return localStorage.getItem("vyom_token");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText);
  }
  return body as T;
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
  tags: string[];
  notes: string | null;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: { id: string; email: string; name: string; role: string } }>(
        "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      ),
    register: (email: string, name: string, password: string) =>
      request<{ user: { id: string; email: string } }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, name, password }),
      }),
    me: () => request<{ user: { id: string; email: string; name: string; role: string } }>("/auth/me"),
  },
  devices: {
    list: (params?: { groupId?: string; online?: string; q?: string }) => {
      const qs = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null) as [string, string][]).toString() : "";
      return request<{ devices: DeviceDTO[]; total: number }>(`/devices${qs}`);
    },
    get: (id: string) => request<{ device: DeviceDTO }>(`/devices/${id}`),
    metrics: (id: string) =>
      request<{ deviceId: string; samples: Array<{ ts: number; cpu_pct: number | null; mem_pct: number | null }> }>(
        `/devices/${id}/metrics`,
      ),
    update: (id: string, patch: { name?: string; notes?: string | null; tags?: string[] }) =>
      request<void>(`/devices/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    remove: (id: string) => request<void>(`/devices/${id}`, { method: "DELETE" }),
    poll: (id: string) => request<{ queued: boolean }>(`/devices/${id}/poll`, { method: "POST" }),
    createSession: (id: string, channel: number) =>
      request<{ token: string; channel: number; expiresInMs: number }>(`/devices/${id}/sessions`, {
        method: "POST",
        body: JSON.stringify({ channel }),
      }),
  },
  quickSupport: {
    create: (deviceId: string, opts?: { password?: string; ttlMinutes?: number }) =>
      request<{ code: string; expiresAt: string; rights: number }>(`/quick-support/${deviceId}`, {
        method: "POST",
        body: JSON.stringify(opts ?? {}),
      }),
    list: (deviceId: string) =>
      request<{ codes: Array<{ code: string; expiresAt: string; usedAt: string | null }> }>(`/quick-support/${deviceId}`),
    revoke: (deviceId: string, code: string) =>
      request<void>(`/quick-support/${deviceId}`, { method: "DELETE", body: JSON.stringify({ code }) }),
    redeem: (code: string, opts?: { password?: string; channel?: number }) =>
      request<{ token: string; channel: number; deviceId: string; wsUrl: string; expiresInMs: number }>(
        "/quick-support/redeem",
        { method: "POST", body: JSON.stringify({ code, ...opts }) },
      ),
  },
  shareLinks: {
    create: (deviceId: string, opts?: { password?: string; expiresAt?: string; guestName?: string }) =>
      request<{ slug: string; url: string; expiresAt: string; rights: number }>(`/share-links/${deviceId}`, {
        method: "POST",
        body: JSON.stringify(opts ?? {}),
      }),
    list: (deviceId: string) =>
      request<{ links: Array<{ slug: string; expiresAt: string; revokedAt: string | null; useCount: number; hasPassword: boolean; guestName: string | null }> }>(
        `/share-links/${deviceId}`,
      ),
    revoke: (deviceId: string, slug: string) =>
      request<void>(`/share-links/${deviceId}`, { method: "DELETE", body: JSON.stringify({ slug }) }),
    resolve: (slug: string, opts?: { password?: string; channel?: number }) =>
      request<{ token: string; channel: number; deviceId: string; wsUrl: string; expiresInMs: number }>(
        "/share-links/resolve",
        { method: "POST", body: JSON.stringify({ slug, ...opts }) },
      ),
  },
  groups: {
    list: () =>
      request<{ groups: Array<{ id: string; name: string; description: string | null; defaultRights: number; deviceCount: number; createdAt: string }> }>("/groups"),
    get: (id: string) =>
      request<{ group: { id: string; name: string; description: string | null; defaultRights: number; createdAt: string }; rights: number; permissions: Array<{ userId: string; email: string | null; rights: number }> }>(`/groups/${id}`),
    create: (g: { name: string; description?: string; defaultRights?: number }) =>
      request<{ group: { id: string; name: string } }>("/groups", {
        method: "POST",
        body: JSON.stringify(g),
      }),
    update: (id: string, patch: { name?: string; description?: string | null; defaultRights?: number }) =>
      request<void>(`/groups/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    remove: (id: string) => request<void>(`/groups/${id}`, { method: "DELETE" }),
    listPermissions: (id: string) =>
      request<{ permissions: Array<{ userId: string; email: string | null; rights: number }> }>(`/groups/${id}/permissions`),
    setPermission: (id: string, userId: string, rights: number) =>
      request<void>(`/groups/${id}/permissions/${userId}`, { method: "PUT", body: JSON.stringify({ rights }) }),
    clearPermission: (id: string, userId: string) =>
      request<void>(`/groups/${id}/permissions/${userId}`, { method: "DELETE" }),
    setDevices: (id: string, deviceIds: string[], action: "add" | "remove") =>
      request<void>(`/groups/${id}/devices`, { method: "PATCH", body: JSON.stringify({ deviceIds, action }) }),
    rights: () =>
      request<{ rights: Array<{ bit: number; name: string }> }>("/rights"),
  },
  alerts: {
    listRules: () =>
      request<{ rules: Array<{ id: string; name: string; device_id: string | null; metric: string; operator: string; threshold: number; duration_s: number; channel: string; webhook_url: string | null; email_to: string | null; enabled: boolean; created_at: string }> }>(
        "/alerts/rules",
      ),
    createRule: (rule: { name: string; deviceId?: string | null; metric: string; operator: string; threshold: number; durationS?: number; channel?: string; webhookUrl?: string; emailTo?: string }) =>
      request<{ rule: { id: string } }>("/alerts/rules", {
        method: "POST",
        body: JSON.stringify(rule),
      }),
    updateRule: (id: string, patch: { name?: string; enabled?: boolean; channel?: string; webhookUrl?: string | null; emailTo?: string | null }) =>
      request<{ ok: boolean }>(`/alerts/rules/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    deleteRule: (id: string) => request<void>(`/alerts/rules/${id}`, { method: "DELETE" }),
    listEvents: (params?: { unresolvedOnly?: boolean; limit?: number }) => {
      const qs = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]) as [string, string][]).toString() : "";
      return request<{ events: Array<{ id: string; rule_id: string; device_id: string; value: number; started_at: string; resolved_at: string | null; notified: number }> }>(
        `/alerts/events${qs}`,
      );
    },
    testRule: (id: string) => request<{ ok: boolean }>(`/alerts/rules/${id}/test`, { method: "POST" }),
  },  recordings: {
    start: (deviceId: string) =>
      request<{ recording: { id: string; device_id: string; started_at: string } }>(`/recordings/${deviceId}/start`, {
        method: "POST",
        body: "{}",
      }),
    stop: (deviceId: string) =>
      request<{ ok: boolean }>(`/recordings/${deviceId}/stop`, { method: "POST", body: "{}" }),
    list: (deviceId?: string) => {
      const qs = deviceId ? `?deviceId=${deviceId}` : "";
      return request<{ recordings: Array<{ id: string; device_id: string; channel: number; bytes: number; frames: number; started_at: string; ended_at: string | null }> }>(
        `/recordings${qs}`,
      );
    },
    downloadUrl: (id: string) => `/api/v1/recordings/${id}/download`,
    remove: (id: string) => request<void>(`/recordings/${id}`, { method: "DELETE" }),
  },  health: () => request<{ status: string; agents: number; version: string }>("/health"),
};