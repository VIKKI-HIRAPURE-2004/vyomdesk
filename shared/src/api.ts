/** API request/response DTO shapes (see docs/07-API-SPEC.md). */

export interface LoginRequest {
  email: string;
  password: string;
  totp?: string;
}

export interface LoginResponse {
  token: string;
  user: import("./models.js").User;
}

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface DeviceListResponse {
  devices: import("./models.js").Device[];
  total: number;
}

export interface HeartbeatAck {
  ok: true;
  next_interval_s: number;
}
