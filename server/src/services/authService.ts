import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { ApiError, Errors } from "../util/errors.js";
import type { Config } from "../core/config.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export class AuthService {
  private secret: Uint8Array;

  constructor(
    private db: Knex,
    private config: Config,
  ) {
    this.secret = new TextEncoder().encode(config.jwtSecret);
  }

  async register(email: string, name: string, password: string): Promise<AuthUser> {
    const existing = await this.db("users").where({ email }).first();
    if (existing) throw Errors.conflict("Email already registered");
    const hash = await argon2.hash(password, ARGON_OPTS);
    const id = randomUUID();
    // First registered user becomes admin (bootstrap); everyone else "tech".
    // Same bootstrap convention as MeshCentral (Apache-2.0): first user -> site admin.
    const countRows = (await this.db("users").count("* as n")) as Array<{ n: number | string }>;
    const role = Number(countRows[0]?.n ?? 0) === 0 ? "admin" : "tech";
    await this.db("users").insert({ id, email, name, password_hash: hash, role });
    return { id, email, name, role };
  }

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const row = await this.db("users").where({ email }).first();
    if (!row) throw Errors.unauthorized();
    const ok = await argon2.verify(row.password_hash, password);
    if (!ok) throw Errors.unauthorized();
    await this.db("users").where({ id: row.id }).update({ last_login: this.db.fn.now() });
    const user: AuthUser = { id: row.id, email: row.email, name: row.name, role: row.role };
    const token = await this.signToken(user);
    return { token, user };
  }

  async signToken(user: AuthUser): Promise<string> {
    return new SignJWT({ email: user.email, name: user.name, role: user.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setIssuer("vyomdesk")
      .setExpirationTime(Math.floor(Date.now() / 1000) + this.config.jwtTtl)
      .sign(this.secret);
  }

  async verifyToken(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: "vyomdesk" });
      return {
        id: String(payload.sub),
        email: String(payload.email ?? ""),
        name: String(payload.name ?? ""),
        role: String(payload.role ?? "tech"),
      };
    } catch {
      throw Errors.unauthorized();
    }
  }
}