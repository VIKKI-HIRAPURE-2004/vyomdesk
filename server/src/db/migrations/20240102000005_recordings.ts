import type { Knex } from 'knex';

// Session recordings (P1.10): server-side tee of desktop relay frames.
// When a recording is started for a device, every ch2 payload flowing
// through /relay.ashx is appended to a .vyomrec container on disk.
// Format: [magic "VYOMREC1"][ver:1][channel:1][reserved:2] then per frame
// [tsMs:8 LE u64][len:4 BE u32][payload]. Payloads are the desktop
// sub-protocol messages ([msgType:1][body]) so the player can filter
// JPEG frames (2) and meta (1).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('recordings', (t) => {
    t.uuid('id').primary();
    t.uuid('device_id').notNullable().references('id').inTable('devices');
    t.integer('channel').notNullable().defaultTo(2);
    t.uuid('user_id').references('id').inTable('users'); // who started it (null = system)
    t.string('path', 512).notNullable(); // relative to data dir
    t.bigInteger('bytes').notNullable().defaultTo(0);
    t.integer('frames').notNullable().defaultTo(0);
    t.timestamp('started_at').notNullable();
    t.timestamp('ended_at').nullable();
    t.index(['device_id', 'started_at'], 'idx_rec_device_started');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('recordings');
}