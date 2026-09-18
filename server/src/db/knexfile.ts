import type { Knex } from "knex";
import type { Config } from "../core/config.js";

export function buildKnex(config: Config): Knex.Config {
  if (config.db.client === "pg") {
    return {
      client: "pg",
      connection: config.db.url,
      pool: { min: 2, max: 10 },
      migrations: { directory: "./src/db/migrations", extension: "ts" },
    };
  }
  return {
    client: "better-sqlite3",
    connection: { filename: config.db.filename ?? "./data/vyomdesk.sqlite" },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
    migrations: { directory: "./src/db/migrations", extension: "ts" },
    acquireConnectionTimeout: 5000,
  };
}
