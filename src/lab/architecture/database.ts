import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

export function architecturePool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000, application_name: "experiments-architecture" });
  // Do not emit database credentials or private SQL parameters in error logs.
  pool.on("error", () => console.error("Architecture database connection failed"));
  return pool;
}
export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** Explicit administration command: the HTTP server never creates or migrates schemas. */
export async function migrateArchitecture(pool: Pool): Promise<void> {
  const sql = (await readFile(new URL("../../../migrations/architecture/001_portfolio.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const digest = createHash("sha256").update(sql).digest("hex");
  await transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(834010, 1)");
    await client.query("CREATE SCHEMA IF NOT EXISTS experiments_architecture");
    await client.query("REVOKE ALL ON SCHEMA experiments_architecture FROM PUBLIC");
    await client.query("CREATE TABLE IF NOT EXISTS experiments_architecture.schema_migrations(version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT version, sha256 FROM experiments_architecture.schema_migrations ORDER BY version");
    if (applied.rows.some(row => row.version !== 1 || row.sha256 !== digest)) throw new Error("Architecture migration checksum/version mismatch");
    if (applied.rowCount) return;
    await client.query(sql);
    await client.query("INSERT INTO experiments_architecture.schema_migrations(version,sha256) VALUES ($1,$2)", [1, digest]);
  });
}
