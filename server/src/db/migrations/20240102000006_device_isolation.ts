import type { Knex } from "knex";

// Per-user agent registration & device isolation:
// - devices.owner_user_id -> users.id (device owner, never null after backfill)
// - installation_tokens: one-time, expirable, revocable enroll tokens (sha256 hash stored)
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("devices", (t) => {
    t.string("owner_user_id", 36).nullable();
  });
  await knex.schema.createTable("installation_tokens", (t) => {
    t.uuid("id").primary();
    t.string("user_id", 36).notNullable();
    t.string("token_hash", 64).notNullable().unique();
    t.string("email_hint", 255).nullable();
    t.string("status", 20).notNullable().defaultTo("active");
    t.timestamp("expires_at").notNullable();
    t.timestamp("used_at").nullable();
    t.string("used_device_id", 36).nullable();
    t.timestamps(true, true);
    t.index(["user_id"], "idx_install_tokens_user");
    t.index(["status"], "idx_install_tokens_status");
  });

  // Backfill: existing devices with no owner -> oldest admin, else oldest user.
  const admin = await knex("users").where({ role: "admin" }).orderBy("created_at").first();
  const fallback = admin ?? (await knex("users").orderBy("created_at").first());
  if (fallback) {
    await knex("devices").whereNull("owner_user_id").update({ owner_user_id: fallback.id });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("installation_tokens");
  await knex.schema.alterTable("devices", (t) => {
    t.dropColumn("owner_user_id");
  });
}
