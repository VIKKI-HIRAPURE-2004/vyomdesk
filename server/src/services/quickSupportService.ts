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
 * QuickSupportService - 9-digit one-time quick-connect codes.
 * A tech generates a code on a device they control (admin or with
 * RemoteControl rights); the code grants ONE session with fixed rights
 * for a short window. Optional password check on redeem.
 * (Quick-connect concept inspired by commercial remote-support tools;
 * implementation original, aligned with the VyomLink relay session model.)
 */

const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_RIGHTS = Rights.RemoteControl | Rights.ServerFiles | Rights.Console;

export interface QuickCodeRow {
  id: string;
  code: string;
  device_id: string;
  created_by: string | null;
  password_hash: string | null;
  rights: number;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // lighter than login: short-lived codes, high churn
  timeCost: 2,
  parallelism: 1,
};

export class QuickSupportService {
  constructor(
    private db: Knex,
    private registry: DeviceRegistry,
    private sessions: SessionManager,
    private hub: AgentHub,
  ) {}

  /** Generate a fresh 9-digit code for a device. Caller must have rights. */
  async create(
    deviceId: string,
    createdBy: string,
    opts: { password?: string; rights?: number; ttlMinutes?: number } = {},
  ): Promise<{ code: string; expiresAt: string; rights: number }> {
    if (!this.hub.isOnline(deviceId)) throw Errors.badRequest('device offline');
    const ttl =
      opts.ttlMinutes && opts.ttlMinutes > 0 && opts.ttlMinutes <= 60
        ? opts.ttlMinutes
        : CODE_TTL_MS / 60_000;
    // sweep expired codes for this device first (keep the table small)
    await this.db('quick_support_codes')
      .where('expires_at', '<', this.db.fn.now())
      .del();
    const code = randomDigits(9);
    const id = randomUUID();
    const rights = opts.rights ?? DEFAULT_RIGHTS;
    const passwordHash = opts.password ? await argon2.hash(opts.password, ARGON_OPTS) : null;
    await this.db('quick_support_codes').insert({
      id,
      code,
      device_id: deviceId,
      created_by: createdBy,
      password_hash: passwordHash,
      rights,
      expires_at: new Date(Date.now() + ttl * 60 * 1000).toISOString(),
    });
    logger.info({ deviceId, code: '***' }, 'quick-support code created');
    return {
      code,
      expiresAt: new Date(Date.now() + ttl * 60 * 1000).toISOString(),
      rights,
    };
  }

  /** Redeem a code: validates TTL + optional password, burns the code and
   *  creates a relay session bound to the device. Returns the one-time
   *  relay token (same shape as POST /devices/:id/sessions). */
  async redeem(
    code: string,
    password: string | undefined,
    channel: number,
  ): Promise<{ token: string; channel: number; deviceId: string; expiresAt: string }> {
    const row = (await this.db('quick_support_codes').where({ code: cleanCode(code) }).first()) as
      | QuickCodeRow
      | undefined;
    if (!row) throw Errors.notFound('Quick-support code');
    if (row.used_at) throw Errors.conflict('Code already used');
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.db('quick_support_codes').where({ id: row.id }).del();
      throw Errors.conflict('Code expired');
    }
    if (row.password_hash) {
      const ok = password ? await argon2.verify(row.password_hash, password) : false;
      if (!ok) throw Errors.unauthorized();
    }
    if (!this.hub.isOnline(row.device_id)) throw Errors.conflict('Device offline');
    // burn the code (single use)
    const n = await this.db('quick_support_codes')
      .where({ id: row.id, used_at: null })
      .update({ used_at: this.db.fn.now() as unknown as string });
    if (!n) throw Errors.conflict('Code already used');
    // channel must be within the code's rights
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

  /** List active codes for a device (admin view; codes masked). */
  async listForDevice(deviceId: string): Promise<Array<{ code: string; expiresAt: string; usedAt: string | null }>> {
    const rows = (await this.db('quick_support_codes')
      .where({ device_id: deviceId })
      .orderBy('created_at', 'desc')
      .limit(20)) as QuickCodeRow[];
    return rows.map((r) => ({
      code: r.code.slice(0, 2) + '***' + r.code.slice(-2), // masked
      expiresAt: r.expires_at,
      usedAt: r.used_at,
    }));
  }

  /** Revoke (delete) a code before it is used. */
  async revoke(deviceId: string, code: string): Promise<void> {
    const n = await this.db('quick_support_codes')
      .where({ device_id: deviceId, code: cleanCode(code), used_at: null })
      .del();
    if (!n) throw Errors.notFound('Quick-support code');
  }
}

function cleanCode(code: string): string {
  return code.replace(/\D/g, '').slice(0, 9);
}

/** Crypto-safe 9-digit numeric string (100000000..999999999). */
function randomDigits(n: number): string {
  const max = 10 ** n;
  const v = parseInt(randomBytes(6).toString('hex'), 16) % (max - 10 ** (n - 1)) + 10 ** (n - 1);
  return String(v).padStart(n, '0');
}

export function canCreateQuickSupport(role: string, rights: number): boolean {
  if (role === 'admin') return true;
  return hasRight(rights, Rights.RemoteControl);
}