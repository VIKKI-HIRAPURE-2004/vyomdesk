# 09 - Legal & Copyright Safety

## Core Rule (UPDATED - Apache 2.0 Derivative Strategy)

**VyomDesk is an Apache 2.0 licensed project that may legally use/port MeshCentral source code with proper attribution.**

### License Verification (Done)

- MeshCentral source (`D:\MeshCentral-master\LICENSE`) verified: **Apache License 2.0**, Copyright 2017-2025 Intel Corporation
- Apache 2.0 Section 2 grants: perpetual, worldwide, royalty-free, irrevocable rights to **use, reproduce, modify, distribute, sublicense** (including commercial use)
- Project owner decision: MeshCentral is open-source, code use is permitted, port proven code instead of clean-room rewrite

### Apache 2.0 Compliance (VyomDesk Follows ALL)

| Section | Requirement | VyomDesk Action |
|---------|-------------|-----------------|
| 4a | Give recipients a copy of the License | LICENSE file (Apache 2.0) in repo root |
| 4b | State changes made to modified files | Each ported/modified file gets header comment: `// Based on MeshCentral (Apache-2.0). Modified for VyomDesk: <changes>` |
| 4c | Retain copyright/patent/attribution notices | Original notices preserved verbatim in ported files |
| 4d | Include NOTICE attributions | NOTICE file: "VyomDesk includes software developed as part of MeshCentral (https://github.com/Ylianst/MeshCentral), licensed Apache 2.0" |
| 6 | No trademark grant | Product named **VyomDesk** - MeshCentral name used ONLY for factual attribution in NOTICE/docs, never in product branding/marketing |

## 1. SAFE to Use (Verified)

- MeshCentral source code - Apache 2.0 (with attribution per Section 4)
- MeshCentral architecture, patterns, protocol design
- Feature concepts from GetScreen.me (ideas/features are not copyrightable; their source is closed and never accessed)
- Industry-standard tech: WebSocket, WebRTC, TLS, VP9/AV1/JPEG codecs

## 2. NEVER Copy

| Item | Owner | Rule |
|------|-------|------|
| GetScreen.me code, UI artwork, logos, marketing text | Proprietary | Never accessed, never copied - feature inspiration only |
| "MeshCentral" trademark in product UI/marketing | Ylian S-H / Intel | Attribution in NOTICE file only (Apache 2.0 Section 6) |
| MeshCentral logo & official screenshots | Copyright owners | Not used in VyomDesk branding |
| GPL/AGPL-licensed dependencies | - | Avoided entirely (CI license-audit gate) |

## 3. VyomDesk Assets

| Asset | Status |
|-------|--------|
| Product name, logo, branding | 100% original ("VyomDesk", "VyomLink" agent) |
| Server (Node/TS) | Original + Apache-2.0-compliant ports from MeshCentral where proven (marked per 4b) |
| Web UI (React) | Original design & code (MeshCentral UI not ported - modern rewrite) |
| Database schema | Original design (MeshCentral-inspired rights bitmask retained: 23-bit system) |
| VyomLink protocol | Original envelope/framing; channel numbering aligned conceptually with MeshCentral relay (1=terminal, 2=desktop, 4=registry, 5=files, 200=chat) |
| Recording format (.vyomrec) | Original container (MeshCentral .mcrec format not reused) |
| NOTICE + LICENSE | Apache 2.0 Section 4 compliant |

## 4. Third-Party Dependencies (License-Checked)

| Dep | License | Use |
|-----|---------|-----|
| Node, Fastify, ws, Knex | MIT | Server |
| React, Vite, Tailwind, xterm.js | MIT | Web |
| libvpx, libaom | BSD | VP9/AV1 encode |
| libjpeg-turbo | BSD/IJG | JPEG fallback |
| Go stdlib + x/sys | BSD | Agent |
| Rust crates (BSD/MIT/Apache) | per-crate check in CI | Screen capture |
| uPlot | MIT | Charts |
| Inter / IBM Plex fonts | SIL OFL | UI |
| Lucide icons | ISC | UI |

**CI gate:** license-check job fails on GPL/AGPL/unknown licenses in dependency graph.

## 5. VyomDesk License

**Apache 2.0** - same as MeshCentral (perfect compatibility for porting):
- Permissive: anyone can use/self-host/build on it, free forever
- Explicit patent grant protects contributors & users
- Commercial-friendly (managed hosting allowed, must remain open)

## 6. Trademark Strategy

- "VyomDesk" + "VyomLink" - trademark search & register (India first, then Madrid protocol)
- Domains: vyomdesk.online (secured) / vyomdesk.in - consider later
- GitHub org: vyomdesk
- NEVER use "MeshCentral" in: product name, UI, marketing, domain names

## 7. Public Cloud Legal (vyomdesk.online)

| Requirement | Plan |
|-------------|------|
| Terms of Service | Signup-time acceptance; illegal remote-access use prohibited |
| Privacy Policy | GDPR + India DPDP Act 2023 compliant |
| Abuse Handling | abuse@vyomdesk.online, audit trail, rapid account/device ban |
| Log Retention | 90 days connection logs (configurable) |
| Jurisdiction | India + GDPR-ready |

## 8. Pre-Launch Compliance Checklist

- [ ] LICENSE (Apache 2.0) in repo root
- [ ] NOTICE file with MeshCentral attribution (4d)
- [ ] All ported files carry change-statement headers (4b)
- [ ] Original copyright notices retained (4c)
- [ ] Trademark search clear ("VyomDesk")
- [ ] Domains secured (vyomdesk.online secured; .in later)
- [ ] ToS + Privacy Policy live
- [ ] Original logo/branding assets (work-for-hire contract)
- [ ] Dependency license audit passing (no GPL/AGPL)
- [ ] gitleaks scan (no secrets in repo)
