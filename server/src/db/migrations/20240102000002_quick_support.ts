import type { Knex } from 'knex';

// Quick-support codes: one-time 9-digit codes generated on an agent for
// ad-hoc support sessions (GetScreen-style quick connect). A code maps to
// a device + rights for a short TTL; any tech who knows the code (and
// optional password) gets a one-time relay session.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('quick_support_codes', (t) => {
    t.uuid('id').primary();
    t.string('code', 9).notNullable().unique();
    t.uuid('device_id').notNullable().references('id').inTable('devices');
    t.uuid('created_by').references('id').inTable('users');
    t.string('password_hash').nullable();
    t.integer('rights').notNullable().defaultTo(0);
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['code'], 'idx_qs_code');
    t.index(['expires_at'], 'idx_qs_expires');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('quick_support_codes');
}