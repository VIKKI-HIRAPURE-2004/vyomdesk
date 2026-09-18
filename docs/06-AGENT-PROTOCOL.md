# 06 — VyomLink Agent Protocol (v1)

Original wire protocol design. Relay channel numbering conceptually aligned with MeshCentral (Apache 2.0 — see docs/09 legal).

## Transport

- **WSS** (TLS 1.2+/1.3) to `wss://server/agent.ashx`
- Agent authenticates with **Ed25519 challenge-response**
- Server identity: **cert pinning** (SHA-256 of server cert embedded in agent build + update channel)
- Frames: JSON text (control) + Binary (tunnel data, typed headers)

## Message Envelope

```json
{ "v": 1, "id": "m-123", "cmd": "...", "ts": 1700000000, ... }
```
Responses reference `replyTo`.

## Handshake

```
S→A { cmd:"hello", serverVer:"1.0.0", nonce:"<32B b64>" }
A→S { cmd:"auth", deviceId:"<uuid>", hardwareId, agentVer:"1.0.0",
      sig:"<Ed25519(nonce | deviceId | agentVer) b64>" }
S→A { cmd:"authOk", config:{ heartbeatSec:30, metricsSec:60, consentFlags:0,
      serverTime:..., features:{...} } }
```
- Device keypair generated at first install; public key registered server-side.
- Hardware fingerprint = SHA-256(OS serial + board serial + primary MAC) — prevents duplicate identities.

## Core Commands

### Server → Agent
| cmd | Purpose |
|-----|---------|
| ping | keepalive (expect pong) |
| tunnel | open session pipe (below) |
| power | wake/reboot/shutdown/safe-mode |
| exec | run command (timeboxed, output streamed) |
| proc.list / proc.kill | process mgmt |
| svc.list / svc.control | services mgmt |
| file.* | file manager ops (list/read/write/mkdir/move/delete/perm) |
| metrics.poll | immediate metrics snapshot |
| inventory.update | full inventory refresh |
| toast | show notification to user |
| chat.msg | message to local user |
| update | self-update instruction (signed URL + hash) |
| uninstall | remove agent (password-protected) |

### Agent → Server
| cmd | Purpose |
|-----|---------|
| pong | keepalive reply |
| event | state changes (user session lock, screen change, etc.) |
| metrics.push | periodic metrics (cpu/mem/disk/net) |
| inventory.push | inventory diff/full |
| exec.stream | exec output chunks |
| tunnelData | (binary) session payload |
| console | agent console output (debug) |
| consentResult | user granted/denied consent prompt |
| update.status | self-update progress |

## Tunnel (Session) Sub-protocol

Desktop/terminal/file sessions multiplex over the **relay socket**, not the control socket:

```
S→A { cmd:"tunnel", protocol:2, sessionId:"s-1", relayUrl:"wss://server/relay.ashx?sid=s-1&as=agent",
      consent:{ required:true, msg:"Ravi requesting desktop" }, rights:0x8,
      user:{ name:"Ravi" }, guest:null }
A→S connect relayUrl (agent-side, signed) → piping starts
```

**Binary frame header (relay):**
```
byte 0:    channel (0=ctrl, 1=video, 2=audio, 3=input, 4=file, 5=clipboard)
byte 1:    flags  (0x01 = compressed, 0x02 = keyframe, 0x04 = last-fragment)
bytes 2-3: length (uint16 BE) — payload follows
```

### Desktop Stream (channel 1)
- Screen regions split into 16x16 tiles
- Changed tiles encoded VP9 (default) / AV1 / JPEG-fallback
- Keyframe every 2s or on demand (`{ctrl:"keyframe"}`)
- Quality ladder: `{ctrl:"quality", q:0..3}` (auto/manual)
- Cursor shape sent as separate PNG chunks when local cursor hidden

### Input (channel 3)
Binary packed events: mouse-move/down/up/scroll, key-down/up (scancodes + text), touch gestures.

### Clipboard (channel 5)
Event-based text sync both ways (length-capped 1MB).

### Files (channel 4)
Chunked transfer windows 64KB, ACK-based flow control, path-based ops over ctrl channel of tunnel.

## Consent Flow

```
S→A tunnel (consent.required=true)
A shows native dialog (30s default timeout)
  ├─ accepted → tunnel proceeds, "consentResult":"granted"
  └─ denied/timeout → tunnel closed, server notified, session logged
```

## Reconnect & Resume

- Agent backoff: 1s,2s,4s...60s cap + jitter
- Session resume token (ROT-valid 60s) — relay rejoins same session
- In-flight file transfers resume via offset ACK

## Versioning

- `v` field envelope; server supports N and N-1 minor
- Agent update rollout: staged (1% → 10% → 100%), signed manifest, hash-verified, rollback on crash-loop

## Security Properties

- All control traffic inside TLS; no secrets in URLs beyond one-time sid tokens
- Agent rejects unsigned updates (Ed25519 manifest signature)
- Rate limits: auth attempts, tunnels per device, exec runs
- Kill-switch: server can revoke device (device gets `revoke` → wipes keys, uninstalls)
