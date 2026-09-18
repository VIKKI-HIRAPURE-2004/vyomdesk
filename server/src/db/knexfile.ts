import type { Knex } from "knex";
import type { Config } from "../core/config.js";

/**
 * Migration location is resolved at migrate time (runMigrations) relative
 * to the running file, so it works both from src (dev, .ts migrations) and
 * from dist (prod, compiled .js migrations). Do not hardcode it here.
 */
export function buildKnex(config: Config): Knex.Config {
  if (config.db.client === "pg") {
    return {
      client: "pg",
      connection: config.db.url,
      pool: { min: 2, max: 10 },
    };
  }
  return {
    client: "better-sqlite3",
    connection: { filename: config.db.filename ?? "./data/vyomdesk.sqlite" },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
    acquireConnectionTimeout: 5000,
  };
}
