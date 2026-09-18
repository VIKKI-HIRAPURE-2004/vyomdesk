import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { Rights, hasRight } from '@vyomdesk/shared';
import { Errors } from '../util/errors.js';
import { logger } from '../util/logger.js';
import type { DeviceRegistry } from './deviceRegistry.js';
import type { SessionManager } from './sessionManager.js';
import type { AgentHub } from '../ws/agentHub.js';

/**
 * ShareLinkService - reusable guest share links (P1.8).
 * A tech creates a link for a device (admin or RemoteControl right);
 * guests open /share/:slug (+ optional password) and get a relay session
 * with the link's fixed rights until the link expires or is revoked.
 * Multi-use by design (unlike single-use quick-support codes).
 * (Guest-sharing concept from MeshCentral; implementation original.)
 */

const DEFAULT_RIGHTS = Rights.RemoteControl | Rights.ServerFiles | Rights.Console;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d cap
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export interface ShareLinkRow {
  id: string;
  slug: string;
  device_id: string;
  created_by: string | null;
  guest_name: string | null;
  password_hash: string | null;
  rights: number;
  expires_at: string;
  revoked_at: string | null;
  use_count: number;
  created_at: string;
}

export class ShareLinkService {
  constructor(
    private db: Knex,
    private registry: DeviceRegistry,
    private sessions: SessionManager,
    private hub: AgentHub,
  ) {}

  /** Create a share link for a device. Caller must have rights. */
  async create(
    deviceId: string,
    createdBy: string,
    opts: { password?: string; rights?: number; expiresAt?: string; guestName?: string } = {},
  ): Promise<{ slug: string; url: string; expiresAt: string; rights: number }> {
    const device = await this.registry.get(deviceId);
    if (!device) throw Errors.notFound('Device');
    if (!this.hub.isOnline(deviceId)) throw Errors.badRequest('device offline');
    // sweep expired/revoked links first (keep the table small)
    await this.db('share_links')
      .where('expires_at', '<', this.db.fn.now())
      .del();
    const slug = randomSlug(12);
    const id = randomUUID();
    const rights = opts.rights ?? DEFAULT_RIGHTS;
    let expiresAt: Date;
    if (opts.expiresAt) {
      const t = new Date(opts.expiresAt).getTime();
      if (Number.isNaN(t)) throw Errors.badRequest('invalid expiresAt');
      if (t <= Date.now()) throw Errors.badRequest('expiresAt must be in the future');
      if (t > Date.now() + MAX_TTL_MS) throw Errors.badRequest('expiresAt too far out (max 7d)');
      expiresAt = new Date(t);
    } else {
      expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
    }
    const passwordHash = opts.password ? await argon2.hash(opts.password, ARGON_OPTS) : null;
    await this.db('share_links').insert({
      id,
      slug,
      device_id: deviceId,
      created_by: createdBy,
      guest_name: opts.guestName?.trim() || null,
      password_hash: passwordHash,
      rights,
      expires_at: expiresAt.toISOString(),
    });
    logger.info({ deviceId, slug: '***' }, 'share link created');
    return { slug, url: `/share/${slug}`, expiresAt: expiresAt.toISOString(), rights };
  }

  /**
   * Resolve a slug: validates expiry + optional password, then creates a
   * relay session bound to the device (does NOT consume the link — multi-use).
   * Returns the one-time relay token (same shape as quick-support redeem).
   */
  async resolve(
    slug: string,
    password: string | undefined,
    channel: number,
  ): Promise<{ token: string; channel: number; deviceId: string; expiresAt: string }> {
    const row = (await this.db('share_links').where({ slug: cleanSlug(slug) }).first()) as
      | ShareLinkRow
      | undefined;
    if (!row) throw Errors.notFound('Share link');
    if (row.revoked_at) throw Errors.conflict('Share link revoked');
    if (new Date(row.expires_at).getTime() < Date.now()) throw Errors.conflict('Share link expired');
    if (row.password_hash) {
      const ok = password ? await argon2.verify(row.password_hash, password) : false;
      if (!ok) throw Errors.unauthorized();
    }
    if (!this.hub.isOnline(row.device_id)) throw Errors.conflict('Device offline');
    // multi-use: bump use counter (best-effort, non-blocking failure is fine)
    await this.db('share_links').where({ id: row.id }).increment('use_count', 1);
    const session = await this.sessions.create(row.device_id, channel, row.rights, null);
    return {
      token: session.token,
      channel: session.channel,
      deviceId: row.device_id,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  /** Resolve the group_id of a device (rights lookup helper for routes). */
  async deviceGroup(deviceId: string): Promise<string | null> {
    const row = await this.registry.get(deviceId);
    if (!row) throw Errors.notFound('Device');
    return row.group_id;
  }

  /** List links for a device (owner view; slug masked). */
  async listForDevice(deviceId: string): Promise<
    Array<{
      slug: string; expiresAt: string; revokedAt: string | null; useCount: number; hasPassword: boolean; guestName: string | null;
    }>
  > {
    const rows = (await this.db('share_links')
      .where({ device_id: deviceId })
      .orderBy('created_at', 'desc')
      .limit(20)) as ShareLinkRow[];
    return rows.map((r) => ({
      slug: r.slug.slice(0, 2) + '***' + r.slug.slice(-2), // masked
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      useCount: r.use_count,
      hasPassword: r.password_hash != null,
      guestName: r.guest_name,
    }));
  }

  /** Revoke (soft-delete) a link. Idempotent-ish: revoking twice is fine. */
  async revoke(deviceId: string, slug: string): Promise<void> {
    const n = await this.db('share_links')
      .where({ device_id: deviceId, slug: cleanSlug(slug), revoked_at: null })
      .update({ revoked_at: this.db.fn.now() as unknown as string });
    if (!n) throw Errors.notFound('Share link (or already revoked)');
  }
}

function cleanSlug(slug: string): string {
  return slug.toLowerCase().trim().slice(0, 16);
}

/** Crypto-safe unambiguous slug (no 0/o/1/l/i). */
function randomSlug(n: number): string {
  const alphabet = SLUG_ALPHABET;
  let out = '';
  const bytes = randomBytes(n);
  for (let i = 0; i < n; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function canCreateShareLink(role: string, rights: number): boolean {
  if (role === 'admin') return true;
  return hasRight(rights, Rights.GuestSharing | Rights.RemoteControl);
}