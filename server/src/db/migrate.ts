import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Knex } from "knex";

/**
 * File-based migration source that works in both run modes:
 *  - dev (tsx from src/): migration files are .ts
 *  - prod (node from dist/): tsc-emitted .js files
 * Stored migration names are extension-less so the same database can be
 * migrated interchangeably from either mode (knex stores the file name
 * including extension by default, which breaks when switching modes).
 */
class FileMigrationSource {
  constructor(private dir: string) {}

  async getMigrations(): Promise<string[]> {
    return readdirSync(this.dir)
      .filter((f) => (f.endsWith(".js") || f.endsWith(".ts")) && !f.endsWith(".d.ts"))
      .sort();
  }

  getMigrationName(migration: string): string {
    return migration.replace(/\.(js|ts)$/, "");
  }

  async getMigration(migration: string): Promise<Knex.Migration> {
    return import(pathToFileURL(path.join(this.dir, migration)).href) as Promise<Knex.Migration>;
  }
}

export async function runMigrations(db: Knex): Promise<void> {
  const dir = fileURLToPath(new URL("./migrations/", import.meta.url));
  // One-time normalize: older builds stored names with a .ts/.js extension;
  // strip it so they match the extension-less names this source produces.
  if (await db.schema.hasTable("knex_migrations")) {
    await db.raw("UPDATE knex_migrations SET name = replace(name, '.ts', '') WHERE name LIKE '%.ts'");
    await db.raw("UPDATE knex_migrations SET name = replace(name, '.js', '') WHERE name LIKE '%.js'");
  }
  await db.migrate.latest({ migrationSource: new FileMigrationSource(dir) });
}
