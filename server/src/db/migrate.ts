import type { Knex } from "knex";

export async function runMigrations(db: Knex): Promise<void> {
  await db.migrate.latest({
    directory: new URL("./migrations/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    extension: "ts",
  });
}
