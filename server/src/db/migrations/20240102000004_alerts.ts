import type { Knex } from 'knex';

// Alert rules engine (P1.9): user-defined threshold rules evaluated
// against incoming device metrics (metrics.push). Rules track an active
// alert_event until the metric falls back below threshold (resolve).
// Notification channels: webhook (POST JSON) + email (SMTP, config-gated).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('alert_rules', (t) => {
    t.uuid('id').primary();
    t.string('name', 120).notNullable();
    t.uuid('device_id').references('id').inTable('devices'); // null = all devices
    t.string('metric', 20).notNullable(); // cpu_pct | mem_pct | mem_used_mb | net_rx_kb | net_tx_kb
    t.string('operator', 4).notNullable(); // > | >= | <
    t.float('threshold').notNullable();
    t.integer('duration_s').notNullable().defaultTo(0); // must hold for N sec (0 = immediate)
    t.string('channel', 20).notNullable().defaultTo('webhook'); // webhook | email | none
    t.text('webhook_url').nullable();
    t.string('email_to', 255).nullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.uuid('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['enabled'], 'idx_rules_enabled');
    t.index(['device_id'], 'idx_rules_device');
  });

  await knex.schema.createTable('alert_events', (t) => {
    t.uuid('id').primary();
    t.uuid('rule_id').notNullable().references('id').inTable('alert_rules');
    t.uuid('device_id').notNullable().references('id').inTable('devices');
    t.float('value').notNullable();
    t.timestamp('started_at').notNullable();
    t.timestamp('resolved_at').nullable();
    t.boolean('notified').notNullable().defaultTo(false);
    t.index(['rule_id', 'resolved_at'], 'idx_events_rule_resolved');
    t.index(['device_id'], 'idx_events_device');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('alert_events');
  await knex.schema.dropTableIfExists('alert_rules');
}