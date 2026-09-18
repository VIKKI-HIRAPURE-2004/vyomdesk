import knex, { type Knex } from "knex";
import type { Config } from "../core/config.js";
import { buildKnex } from "./knexfile.js";

let db: Knex | null = null;

export function getDb(config: Config): Knex {
  if (!db) {
    db = knex(buildKnex(config));
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
  }
}
