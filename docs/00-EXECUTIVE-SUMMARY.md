# 00 — Executive Summary

## Vision

**VyomDesk** = free, open, publicly hostable remote monitoring + remote desktop platform for everyone.

Ek hi product mein:

1. **MeshCentral jaisa power** — full RMM: device groups, terminal, files, wake-on-lan, monitoring, multi-user, self-hosted.
2. **GetScreen jaisi simplicity** — quick connect, browser-based, no configuration, agent optional (one-time link).

Sab kuch **free**, **Apache 2.0**, **no feature locks**.

## Problem Statement

| Problem | VyomDesk Solution |
|---------|-------------------|
| TeamViewer/AnyDesk expensive, suspicious of free tier | 100% free, self-hostable, no account limits |
| MeshCentral powerful but UX dated, mobile weak | Modern UI, mobile-first, quick-connect UX |
| GetScreen simple but closed-source, cloud-only | Open-source, self-host OR public cloud |
| Chrome Remote Desktop no management features | Full RMM: monitoring, alerts, inventory |
| ScreenConnect/ConnectWise expensive per-tech license | Unlimited techs, unlimited devices, free |

## Core Principles

1. **Free Forever** — no paid tiers, no device limits, no user limits.
2. **Open Source** — Apache 2.0, code public on GitHub.
3. **Apache 2.0 Compliant** — MeshCentral (open-source, Apache 2.0, verified) ka code legally use/port with full attribution. GetScreen kabhi copy nahi (closed source - sirf ideas). Original branding: VyomDesk, VyomLink.
4. **WAN-First** — agent outbound connections only, NAT traversal built-in, no port forwarding needed (GetScreen jaise).
5. **Self-Host or Cloud** — ek hi codebase, dono modes.
6. **Privacy First** — E2E encryption optional, session recording with consent, GDPR-friendly.
7. **Multi-platform** — Windows, Linux, macOS, Android agent + browser client kisi bhi device se.

## Product Pillars

| Pillar | Description |
|--------|-------------|
| 🖥️ Remote Desktop | Low-latency KVM, multi-monitor, clipboard, sound |
| 🛠️ Remote Management | Terminal, files, registry, services, processes |
| 📊 Monitoring & Alerts | CPU/RAM/disk/network metrics, email/Telegram alerts |
| 👥 Team Collaboration | Multi-tech simultaneous sessions, chat, guest sharing |
| 🔐 Security & Compliance | 2FA, SSO, audit logs, session recording, E2E option |
| ☁️ Cloud + Self-Host | Public instance free, Docker 1-command self-host |

## Target Users

- MSPs (Managed Service Providers) — small teams
- IT departments (schools, NGOs, companies)
- Individual techs / freelancers
- Open-source community (self-hosters)
- Family/friends remote support

## Success Metrics (v1)

- Working remote desktop &lt; 200ms latency on same region
- Agent install &lt; 60 seconds
- 10k+ devices per server node
- Docker deploy &lt; 5 minutes
- Public signup working, free

## Non-Goals (v1)

- Intel AMT support (MeshCentral ka niche feature, patent-heavy)
- VoIP/video calling (chat only)
- Mobile agent control of other mobiles (view-only Android initially)
- On-prem enterprise SSO customization (standard OIDC enough)
