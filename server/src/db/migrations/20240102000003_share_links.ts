import type { Knex } from 'knex';

// Guest share links (P1.8): reusable public URLs that grant guest access
// to a device's desktop for a bounded window. Unlike quick-support codes
// (single-use, tech-typed), a share link is pasted into chat/email and
// can be redeemed multiple times until it expires or is revoked.
// MeshCentral-style guest sharing; implementation original.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('share_links', (t) => {
    t.uuid('id').primary();
    t.string('slug', 16).notNullable().unique();
    t.uuid('device_id').notNullable().references('id').inTable('devices');
    t.uuid('created_by').references('id').inTable('users');
    t.string('guest_name', 120).nullable(); // suggested guest label for session logs
    t.string('password_hash').nullable();
    t.integer('rights').notNullable().defaultTo(0);
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.integer('use_count').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['slug'], 'idx_share_slug');
    t.index(['expires_at'], 'idx_share_expires');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('share_links');
}