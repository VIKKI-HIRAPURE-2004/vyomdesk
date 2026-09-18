import type { Knex } from "knex";

// Initial schema: users, groups, devices, permissions, metrics, sessions, audit
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (t) => {
    t.uuid("id").primary();
    t.string("email", 255).notNullable().unique();
    t.string("name", 255).notNullable();
    t.string("password_hash").notNullable();
    t.string("role", 20).notNullable().defaultTo("tech");
    t.text("totp_secret").nullable();
    t.boolean("totp_enabled").notNullable().defaultTo(false);
    t.integer("flags").notNullable().defaultTo(0);
    t.timestamp("last_login").nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable("device_groups", (t) => {
    t.uuid("id").primary();
    t.string("name", 255).notNullable();
    t.text("description").nullable();
    t.uuid("owner_user_id").references("id").inTable("users");
    t.integer("consent_flags").notNullable().defaultTo(0);
    t.integer("default_rights").notNullable().defaultTo(0);
    t.timestamp("deleted_at").nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable("group_permissions", (t) => {
    t.uuid("id").primary();
    t.string("subject_type", 10).notNullable();
    t.uuid("subject_id").notNullable();
    t.uuid("group_id").notNullable().references("id").inTable("device_groups");
    t.integer("rights").notNullable().defaultTo(0);
    t.unique(["subject_type", "subject_id", "group_id"]);
    t.index(["group_id"], "idx_gperm_group");
  });

  await knex.schema.createTable("devices", (t) => {
    t.uuid("id").primary();
    t.uuid("group_id").references("id").inTable("device_groups");
    t.string("name", 255).notNullable();
    t.string("agent_version", 40).nullable();
    t.string("platform", 20).notNullable();
    t.string("platform_version", 80).nullable();
    t.string("arch", 20).nullable();
    t.text("public_key").nullable();
    t.string("hardware_id", 128).nullable();
    t.timestamp("last_seen").nullable();
    t.string("last_ip", 64).nullable();
    t.json("tags").nullable();
    t.text("notes").nullable();
    t.integer("consent_flags").notNullable().defaultTo(0);
    t.boolean("approved").notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.index(["group_id"], "idx_devices_group");
    t.index(["last_seen"], "idx_devices_last_seen");
  });

  await knex.schema.createTable("device_metrics", (t) => {
    t.uuid("id").primary();
    t.uuid("device_id").notNullable().references("id").inTable("devices");
    t.timestamp("ts").notNullable();
    // .float() maps to REAL on sqlite and float on pg
    t.float("cpu_pct");
    t.float("mem_pct");
    t.float("mem_used_mb");
    t.float("net_rx_kb");
    t.float("net_tx_kb");
    t.integer("uptime_s");
    t.index(["device_id", "ts"], "idx_metrics_dev_ts");
  });

  await knex.schema.createTable("session_logs", (t) => {
    t.uuid("id").primary();
    t.uuid("device_id").references("id").inTable("devices");
    t.uuid("user_id").references("id").inTable("users");
    t.string("guest_name", 120).nullable();
    t.integer("protocol").notNullable();
    t.timestamp("started_at").notNullable();
    t.timestamp("ended_at").nullable();
    t.bigInteger("bytes_in").notNullable().defaultTo(0);
    t.bigInteger("bytes_out").notNullable().defaultTo(0);
  });

  await knex.schema.createTable("audit_logs", (t) => {
    t.uuid("id").primary();
    t.string("actor_type", 10).notNullable();
    t.uuid("actor_id").nullable();
    t.string("action", 80).notNullable();
    t.string("target_type", 40).nullable();
    t.uuid("target_id").nullable();
    t.json("meta").nullable();
    t.string("ip", 64).nullable();
    t.timestamp("ts").notNullable();
    t.index(["actor_id", "ts"], "idx_audit_actor_ts");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("audit_logs");
  await knex.schema.dropTableIfExists("session_logs");
  await knex.schema.dropTableIfExists("device_metrics");
  await knex.schema.dropTableIfExists("devices");
  await knex.schema.dropTableIfExists("group_permissions");
  await knex.schema.dropTableIfExists("device_groups");
  await knex.schema.dropTableIfExists("users");
}
