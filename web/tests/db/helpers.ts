import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const FOLDER = "supabase/migrations";

/** Apply every migration in order, as the owner does in the SQL editor. */
export async function applyMigrations(db: PGlite): Promise<void> {
  for (const file of readdirSync(FOLDER).sort()) {
    await db.exec(readFileSync(path.join(FOLDER, file), "utf8"));
  }
}

/**
 * An in-process Postgres with the migration applied. `roles` first creates the
 * role names Supabase provides, so the migration's grants can be checked.
 */
export async function createTestDb(options: { roles?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  if (options.roles) {
    await db.exec("create role anon; create role authenticated; create role service_role;");
  }
  await applyMigrations(db);
  return db;
}
