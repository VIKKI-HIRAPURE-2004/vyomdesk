# 07 — API Specification

Base: `https://<server>/api/v1` — JSON, Bearer token (`Authorization: Bearer <api_key|session_jwt>`).

## Auth Endpoints

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | /auth/register | &#123;email, password, name} | &#123;userId, verifyEmailSent} |
| POST | /auth/login | &#123;email, password, totp?} | &#123;token, expiresAt, user} |
| POST | /auth/logout | — | 204 |
| POST | /auth/refresh | &#123;refreshToken} | &#123;token} |
| POST | /auth/forgot | &#123;email} | 202 (always) |
| POST | /auth/reset | &#123;token, newPassword} | 204 |
| POST | /auth/totp/setup | — | &#123;otpauthUrl, secret} |
| POST | /auth/totp/verify | &#123;code} | &#123;backupCodes[]} |
| POST | /auth/webauthn/register/begin | — | credential creation options |
| POST | /auth/webauthn/register/finish | &#123;attestation} | 204 |
| POST | /auth/webauthn/login/begin | &#123;email} | credential request |
| POST | /auth/webauthn/login/finish | &#123;assertion} | &#123;token} |

## Devices

| Method | Path | Notes |
|--------|------|-------|
| GET | /devices | list (filter: groupId, online, q, tag, page) |
| GET | /devices/:id | detail + inventory summary |
| PATCH | /devices/:id | rename, notes, tags, group move, consentFlags |
| DELETE | /devices/:id | remove + revoke agent |
| GET | /devices/:id/metrics?from&to&step | time-series |
| GET | /devices/:id/inventory | full inventory JSON |
| POST | /devices/:id/wake | WoL via peer agent |
| POST | /devices/:id/power | &#123;action: reboot\|shutdown\|safeboot} |
| POST | /devices/:id/exec | &#123;cmd, timeoutSec} → execId |
| WS  | /devices/:id/exec/:execId/stream | live output |
| GET | /devices/:id/processes | |
| POST | /devices/:id/processes/:pid/kill | |
| GET | /devices/:id/services | |
| POST | /devices/:id/services/:name | &#123;action:start\|stop\|restart} |
| GET | /devices/:id/files?path= | file list |
| POST | /devices/:id/files/upload | multipart / tus resumable |
| GET | /devices/:id/files/download?path= | stream |
| POST | /devices/:id/files/mkdir · /move · /delete · /rename | |

## Sessions (Remote Desktop/Terminal)

| Method | Path | Notes |
|--------|------|-------|
| POST | /sessions | &#123;deviceId, protocol: desktop\|terminal\|files} → &#123;sessionId, wsUrl, token} |
| GET | /sessions/active | my active sessions |
| GET | /sessions/history?deviceId&from&to | audit |
| DELETE | /sessions/:id | terminate |
| POST | /devices/:id/share-link | &#123;expireMin, rights, protocols, password?} → &#123;url, code} |
| POST | /quick-support | &#123;code, password?} → &#123;sessionId, wsUrl} (no auth) |

## Device Groups

CRUD `/groups`, members `/groups/:id/permissions` (subject user/userGroup + rights bitmask).

## Alerts

| Method | Path |
|--------|------|
| GET/POST | /alerts/rules |
| PATCH/DELETE | /alerts/rules/:id |
| GET | /alerts/events?resolved=false |
| POST | /alerts/test | &#123;channel, target} |

## Recordings

| Method | Path |
|--------|------|
| GET | /recordings?deviceId&from&to |
| GET | /recordings/:id/meta · /stream (range) · /thumb |
| DELETE | /recordings/:id |

## Users & Admin (admin role)

CRUD `/users`, roles, force-logout, unlock. `/settings` (branding, terms, limits, ipLists). `/audit-logs`. `/server/stats` (agents, sessions, traffic). `/server/backups`.

## WebSocket Streams

- `wss://server/ws` — browser events (device online/offline, metrics ticks, alerts, session state) — subscribed by scope
- `wss://server/relay.ashx?sid=...&token=...` — session pipe (protocol per 06 doc)

## Errors

```json
{ "error": { "code": "DEVICE_OFFLINE", "message": "...", "details": {} } }
```
Codes: VALIDATION, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, DEVICE_OFFLINE, AGENT_TIMEOUT, CONSENT_DENIED, QUOTA_EXCEEDED, INTERNAL.

## Rate Limits

- auth/*: 10/min/IP
- sessions create: 30/min/user
- exec: 10/min/device
- Default: 120/min/user

## Webhooks (P2)

Events: device.online, device.offline, alert.triggered, session.started, session.ended. HMAC-SHA256 signature header `X-Vyom-Signature`.
