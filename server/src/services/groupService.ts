import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { Errors } from "../util/errors.js";
import { Rights, hasRight } from "@vyomdesk/shared";

/**
 * GroupService - device-group CRUD, membership and per-subject rights.
 * (Group rights concept adapted from MeshCentral mesh/device-groups,
 * Apache-2.0.)
 *
 * Effective rights for a user on a group:
 *   - users.role == "admin"          -> all rights (Admin bit)
 *   - group_permissions row (user)   -> that row's rights
 * Default group rights (device_groups.default_rights) apply to NEW
 * permissions created for users, not implicitly to everyone.
 */

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  default_rights: number;
  created_at: string;
  updated_at: string;
}

export interface GroupDTO {
  id: string;
  name: string;
  description: string | null;
  defaultRights: number;
  deviceCount: number;
  createdAt: string;
}

export interface PermissionRow {
  id: string;
  subject_type: string;
  subject_id: string;
  group_id: string;
  rights: number;
}

export class GroupService {
  constructor(private db: Knex) {}

  toDTO(row: GroupRow, deviceCount = 0): GroupDTO {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      defaultRights: row.default_rights,
      deviceCount,
      createdAt: row.created_at,
    };
  }

  async list(): Promise<Array<GroupDTO & { deviceCount: number }>> {
    const rows = (await this.db("device_groups")
      .whereNull("deleted_at")
      .orderBy("name")) as GroupRow[];
    const counts = await this.db("devices")
      .whereNotNull("group_id")
      .groupBy("group_id")
      .select("group_id")
      .count({ c: "*" });
    const cmap = new Map(counts.map((c: any) => [c.group_id, Number(c.c)]));
    return rows.map((r) => this.toDTO(r, cmap.get(r.id) ?? 0));
  }

  async get(id: string): Promise<GroupRow | undefined> {
    return this.db("device_groups").where({ id }).whereNull("deleted_at").first();
  }

  async create(p: { name: string; description?: string | null; ownerId?: string | null; defaultRights?: number }): Promise<GroupRow> {
    const name = p.name?.trim();
    if (!name) throw Errors.badRequest("group name required");
    if (name.length > 255) throw Errors.badRequest("group name too long");
    const dupe = await this.db("device_groups").where({ name }).whereNull("deleted_at").first();
    if (dupe) throw Errors.conflict("group name already exists");
    const id = randomUUID();
    await this.db("device_groups").insert({
      id,
      name,
      description: p.description ?? null,
      owner_user_id: p.ownerId ?? null,
      default_rights: p.defaultRights ?? 0,
    });
    return (await this.get(id))!;
  }

  async update(id: string, p: { name?: string; description?: string | null; defaultRights?: number }): Promise<void> {
    const row = await this.get(id);
    if (!row) throw Errors.notFound("Group");
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) {
      const name = p.name?.trim();
      if (!name) throw Errors.badRequest("group name cannot be empty");
      const dupe = await this.db("device_groups")
        .where({ name })
        .whereNull("deleted_at")
        .whereNot({ id })
        .first();
      if (dupe) throw Errors.conflict("group name already exists");
      patch.name = name;
    }
    if (p.description !== undefined) patch.description = p.description;
    if (p.defaultRights !== undefined) {
      if (!Number.isInteger(p.defaultRights) || p.defaultRights < 0 || p.defaultRights > 0xffffff)
        throw Errors.badRequest("defaultRights must be a 0..16777215 integer");
      patch.default_rights = p.defaultRights;
    }
    await this.db("device_groups").where({ id }).update(patch);
  }

  async remove(id: string): Promise<void> {
    const row = await this.get(id);
    if (!row) throw Errors.notFound("Group");
    const devices = await this.db("devices").where({ group_id: id }).count({ c: "*" });
    if (Number((devices[0] as any)?.c) > 0)
      throw Errors.conflict("group still has devices; move them first");
    await this.db("group_permissions").where({ group_id: id }).del();
    await this.db("device_groups").where({ id }).update({ deleted_at: this.db.fn.now() });
  }

  /** Assign/unassign a device to a group (null clears membership). */
  async setDeviceGroup(deviceId: string, groupId: string | null): Promise<void> {
    const n = await this.db("devices").where({ id: deviceId }).update({ group_id: groupId });
    if (!n) throw Errors.notFound("Device");
  }

  // ---- permissions ----

  async listPermissions(groupId: string): Promise<Array<PermissionRow & { email: string | null }>> {
    const rows = await this.db("group_permissions as gp")
      .where({ "gp.group_id": groupId })
      .leftJoin("users as u", "u.id", "gp.subject_id")
      .select("gp.*", "u.email");
    return rows as any;
  }

  async setPermission(groupId: string, userId: string, rights: number): Promise<void> {
    const group = await this.get(groupId);
    if (!group) throw Errors.notFound("Group");
    const user = await this.db("users").where({ id: userId }).first();
    if (!user) throw Errors.notFound("User");
    if (!Number.isInteger(rights) || rights < 0 || rights > 0xffffff)
      throw Errors.badRequest("rights must be a 0..16777215 integer");
    await this.db("group_permissions")
      .insert({ id: randomUUID(), subject_type: "user", subject_id: userId, group_id: groupId, rights })
      .onConflict(["subject_type", "subject_id", "group_id"])
      .merge({ rights });
  }

  async clearPermission(groupId: string, userId: string): Promise<void> {
    const n = await this.db("group_permissions")
      .where({ group_id: groupId, subject_id: userId, subject_type: "user" })
      .del();
    if (!n) throw Errors.notFound("Permission");
  }

  /**
   * Effective rights of a user over a group: Admin role -> all rights,
   * else the user's permission row (0 when none).
   */
  async effectiveRights(user: { id: string; role: string }, groupId: string): Promise<number> {
    if (user.role === "admin") return 0xffffff | Rights.Admin;
    const row = await this.db("group_permissions")
      .where({ group_id: groupId, subject_id: user.id, subject_type: "user" })
      .first();
    return row ? row.rights : 0;
  }

  /** Groups a user can see (admin: all; otherwise groups with a permission row). */
  async visibleGroups(user: { id: string; role: string }): Promise<GroupRow[]> {
    if (user.role === "admin")
      return this.db("device_groups").whereNull("deleted_at").orderBy("name");
    return this.db("device_groups as g")
      .join("group_permissions as gp", "gp.group_id", "g.id")
      .whereNull("g.deleted_at")
      .where({ "gp.subject_id": user.id, "gp.subject_type": "user" })
      .orderBy("g.name")
      .select("g.*");
  }

  /** Which devices in the given groups the user may act on (right bit filter). */
  async filterDevices<T extends { id: string; groupId: string | null }>(
    user: { id: string; role: string },
    devices: T[],
    bit: number,
  ): Promise<T[]> {
    if (user.role === "admin" || hasRight(0xffffff, Rights.Admin)) return devices;
    const rights = new Map<string, number>();
    const rows = await this.db("group_permissions").where({ subject_id: user.id, subject_type: "user" });
    for (const r of rows) rights.set(r.group_id, r.rights);
    return devices.filter((d) => {
      if (!d.groupId) return false;
      const r = rights.get(d.groupId) ?? 0;
      return hasRight(r, bit);
    });
  }
}