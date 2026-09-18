# 05 — Database Schema

DB: **SQLite** (default) / **PostgreSQL**. Knex migrations.

## Entity-Relationship Overview

```
users ──< user_group_members >── user_groups
  │                                 │
  ├──< sessions (login)             ├──< group_permissions >── device_groups
  ├──< api_keys                     │                          │
  ├──< audit_logs                   │                          ├──< devices
  ├──< shared_links ──> devices ◄───┴──────────────────────────┘
  │                    │
  │                    ├──< device_metrics
  │                    ├──< recordings
  │                    ├──< alert_rules >── alert_events
  │                    └──< session_logs
  └──< notifications
```

## Tables

### users
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| email | text unique | login identifier |
| name | text | |
| password_hash | text | argon2id, null if SSO-only |
| role | text | 'superadmin' / 'admin' / 'tech' / 'viewer' |
| totp_secret | text enc | encrypted at rest |
| webauthn_enabled | bool | |
| flags | int | bitfield: locked, must-change-pass, etc. |
| last_login | ts | |
| created_at / updated_at | ts | |

### user_groups
id, name, description, timestamps

### user_group_members
user_id fk, group_id fk, pk(user_id, group_id)

### device_groups
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| name | text | |
| owner_user_id | fk users | creator |
| consent_flags | int | desktop/terminal/file prompt bits |
| amt_enabled | bool | always false (no AMT in vYomDesk) |
| default_rights | int | bitmask for new members |
| deleted_at | ts nullable | soft delete |

### group_permissions
| Column | Type |
|--------|------|
| id | uuid pk |
| subject_type | 'user' \| 'user_group' |
| subject_id | fk |
| group_id | fk device_groups |
| rights | int bitmask (24+ bits, MeshCentral-inspired but own mapping) |

**Rights bitmask (VyomDesk own definition):**
```
0x000001 EditGroup        0x000002 ManageUsers
0x000004 ManageDevices    0x000008 RemoteControl
0x000010 Console          0x000020 ServerFiles
0x000040 WakeDevice       0x000080 SetNotes
0x000100 ViewOnlyDesktop  0x000200 NoTerminal
0x000400 NoFiles          0x000800 ChatNotify
0x001000 Uninstall        0x002000 NoDesktop
0x004000 RemoteCommand    0x008000 ResetOff
0x010000 GuestSharing     0x020000 DeviceDetails
0x040000 Relay            0x080000 NoRegistry
0x100000 LimitedInput     0x200000 LimitedEvents
0x800000 Admin (all)
```

### devices
| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | node id |
| group_id | fk device_groups | |
| name | text | hostname |
| agent_version | text | |
| platform | text | win/linux/mac/android |
| platform_version | text | |
| arch | text | |
| public_key | text | agent Ed25519 identity |
| hardware_id | text | stable fingerprint hash |
| last_seen | ts | heartbeat |
| last_ip | text | |
| geo | text | country/city opt |
| icon | text | os icon key |
| notes | text | |
| tags | json | |
| consent_flags | int | per-device override |
| created_at | ts | |

### device_metrics
| Column | Type | Notes |
|--------|------|-------|
| id | auto pk | |
| device_id | fk | |
| ts | ts idx | |
| cpu_pct | real | |
| mem_pct / mem_used_mb | real | |
| disks | json | [&#123;vol,pct,total_gb}] |
| net_rx_kb / net_tx_kb | real | |
| uptime_s | int | |

Retention: raw 7d → 5m rollup 30d → 1h rollup 1y (cron job).

### device_inventory
device_id fk pk-ish, json (CPU model, board, BIOS, NICs with MAC/IP, installed software list snapshot, os details) — updated daily / on-change.

### alert_rules
| Column | Type |
|--------|------|
| id | uuid |
| group_id fk nullable | null = global user rule |
| device_id fk nullable | null = group-wide |
| owner_user_id fk | |
| metric | 'cpu' \| 'mem' \| 'disk' \| 'offline' \| 'custom' |
| op | '>' \| '&lt;' |
| threshold | real |
| duration_s | int | must-breach window |
| channels | json | ['email','telegram','webhook'] |
| enabled | bool |

### alert_events
id, rule_id fk, device_id, value, started_at, resolved_at nullable, notified bool

### session_logs (remote sessions audit)
| Column | Type |
|--------|------|
| id | uuid |
| device_id fk | |
| user_id fk nullable | null = guest |
| guest_name | text nullable |
| protocol | int | 1=terminal 2=desktop 5=files 200=chat |
| started_at / ended_at | ts |
| bytes_in / bytes_out | bigint |
| recording_id fk nullable | |

### recordings
id, session_id fk, filepath, size, protocol, indexed bool, created_at

### shared_links (guest quick-access)
| Column | Type |
|--------|------|
| id | uuid |
| device_id fk | |
| created_by fk users | |
| public_id | text unique | short code |
| extra_key | text nullable | second factor |
| rights | int | limited bitmask |
| protocols | int | allowed: terminal/desktop/files bits |
| guest_name_req | bool | ask guest name |
| expire_at | ts | |
| uses | int / max_uses | |
| revoked | bool | |

### quick_support_codes (GetScreen-style)
| Column | Type |
|--------|------|
| code | text pk | 9-digit |
| device_id fk | ephemeral device |
| password_hash nullable | |
| expire_at | ts | 10 min default |
| used_by fk users nullable | |
| started_at | ts |

### users auth extras
- **webauthn_credentials**: user_id, cred_id, public_key, sign_count, transports
- **login_sessions**: id (token hash), user_id, ip, ua, created, expires, revoked
- **api_keys**: id, user_id, name, hash, prefix, last_used, created

### audit_logs
id, actor_type ('user'|'agent'|'system'), actor_id, action, target_type, target_id, meta json, ip, ts

### server_settings
key pk, value json — branding, terms, limits, feature flags

## Indexing Strategy

- devices(group_id), devices(last_seen), devices(name)
- device_metrics(device_id, ts desc)
- session_logs(device_id, started_at desc), session_logs(user_id)
- audit_logs(actor_id, ts desc), audit_logs(target_id)
- alert_events(rule_id, resolved_at)

## Migrations

Knex `migrations/` folder, sequential, reversible. Seed: superadmin bootstrap (random pass printed once).

## Data Protection

- TOTP secrets, shared-link extra keys: AES-256-GCM at rest (key from env VYOM_ENCRYPTION_KEY)
- Passwords: argon2id (m=64MB, t=3, p=4)
- All PII fields optional where possible; GDPR delete = hard delete + audit note.
