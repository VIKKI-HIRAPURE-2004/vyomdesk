import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Knex } from "knex";

export interface InstallTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  email_hint: string | null;
  status: "active" | "used" | "revoked" | "expired";
  expires_at: string;
  used_at: string | null;
  used_device_id: string | null;
}

function sha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function formatToken(buf: Buffer): string {
  return `VD-${buf.subarray(0, 2).toString("hex").toUpperCase()}-${buf.subarray(2, 4).toString("hex").toUpperCase()}-${buf.subarray(4, 6).toString("hex").toUpperCase()}`;
}

/** One-time installation tokens binding an agent download to a user. */
export class EnrollTokenService {
  constructor(private db: Knex) {}

  async issue(userId: string, emailHint: string | null, ttlHours = 24): Promise<{ token: string; expiresAt: Date }> {
    const token = formatToken(randomBytes(6));
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
    await this.db("installation_tokens").insert({
      id: randomUUID(),
      user_id: userId,
      token_hash: sha256(token),
      email_hint: emailHint,
      status: "active",
      expires_at: expiresAt,
    });
    return { token, expiresAt };
  }

  /** Validate + consume a token. Returns owner user_id, or null if invalid. */
  async consume(token: string, deviceId: string): Promise<string | null> {
    const row = await this.db<InstallTokenRow>("installation_tokens")
      .where({ token_hash: sha256(token.trim()) })
      .first();
    if (!row || row.status !== "active") return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.db("installation_tokens").where({ id: row.id }).update({ status: "expired" });
      return null;
    }
    await this.db("installation_tokens").where({ id: row.id }).update({
      status: "used",
      used_at: this.db.fn.now(),
      used_device_id: deviceId,
    });
    return row.user_id;
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const n = await this.db("installation_tokens").where({ id, user_id: userId }).update({ status: "revoked" });
    return n > 0;
  }
}
