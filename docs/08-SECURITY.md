# 08 — Security Plan

## Threat Model (STRIDE-lite)

| Threat | Vector | Mitigation |
|--------|--------|------------|
| Spoofed server | Agent MITM | Cert pinning (SHA-256 in binary), signed update channel |
| Spoofed agent | Forged deviceId | Ed25519 challenge-response; hardware fingerprint binding |
| Credential theft | DB breach | Argon2id; TOTP secrets AES-GCM at rest |
| Session hijack | sid leak | Short-lived (60s) one-time relay tokens, TLS-only |
| Privilege escalation | API bugs | Rights bitmask checked at every route + WS message |
| Consent bypass | Silent control | Server-enforced consent flags; agent-side dialog; audit |
| Malicious update | Supply chain | Signed manifests (Ed25519), hash check, staged rollout |
| Brute force | Login | Rate limit + exponential lockout + captcha (P2) |
| Traffic analysis | Relay sees all | TLS 1.3; optional E2E mode (P3) — server relays opaque ciphertext |
| Guest link abuse | Public sharing | Expiry, use caps, optional password, rights-limited, revocable |
| Recording leak | Disk access | Recordings encrypted at rest (server key), signed URLs, expiry |
| DoS | Flood agent/WS | Per-IP limits, WS message quotas, agent command rate-limits |

## Cryptography

| Purpose | Algo |
|---------|------|
| Passwords | Argon2id (m=64MB,t=3,p=4) |
| Agent identity | Ed25519 (device keypair) |
| Update signing | Ed25519 manifest |
| TLS | 1.2 min, 1.3 preferred, modern ciphers only |
| At-rest secrets | AES-256-GCM (env key) |
| Session tokens | Random 256-bit, HMAC-bound |
| Relay sid | Random 192-bit, single-use |
| E2E (P3) | X25519 + XChaCha20-Poly1305 per session |

## AuthZ Model

- Roles: superadmin / admin / tech / viewer (server scope)
- Group rights bitmask (see 05) enforced in middleware AND relay layer
- Guest links: subset rights only, time-boxed
- Every denied action → audit log

## Agent Hardening

- Runs as SYSTEM/root but command allowlist profile per deployment
- exec: output size cap, timeout cap, concurrent=1
- Uninstall password (hashed, checked agent-side)
- No listening ports (outbound only) — no new attack surface
- Crash-loop detection → safe mode (connect-only, no exec)

## Server Hardening

- Non-root Docker (read-only FS except data volumes)
- Headers: HSTS, CSP, X-Frame-Options DENY, Referrer-Policy
- Cookies: HttpOnly, Secure, SameSite=Strict (+ lax flows where needed)
- CORS allowlist
- Secrets via env / Docker secrets — never in repo
- Dependency audit (pnpm audit, go vuln check) in CI
- Backups encrypted (AES-256), tested restore monthly

## Privacy & Compliance

- Consent banner before remote control (configurable per group)
- Privacy bar (on-screen indicator) during sessions
- Recording only with explicit policy + indicator
- GDPR: export my data, delete account cascade, DPA template
- Logs retention policy: audit 1y, metrics rollup 1y, raw metrics 7d, recordings per-policy
- Public instance ToS + Privacy Policy (own legal review recommended)

## Bug Bounty / Disclosure

- security@vyomdesk.online (example)
- 90-day coordinated disclosure
- Hall of fame page
- CVE process via GitHub advisories

## Security Checklist (Release Gate)

- [ ] npm audit / go vuln: zero high
- [ ] TLS config A+ (SSL Labs)
- [ ] OWASP ASVS L2 review
- [ ] Pen-test (external, pre-launch)
- [ ] Secrets scan (gitleaks) clean
- [ ] Fuzz agent protocol parser (go-fuzz)
- [ ] Dependency pinning + lockfiles
