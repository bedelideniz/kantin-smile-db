// Shared module: connects to the user's external PostgreSQL via `pg` driver.
// Re-used by all edge functions that need to query the canteen DB.
import pg from "npm:pg@8.13.1";
const { Pool } = pg;
type Pool = InstanceType<typeof pg.Pool>;

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const connectionString = Deno.env.get("EXTERNAL_DB_URL");
  if (!connectionString) {
    throw new Error("EXTERNAL_DB_URL secret is not configured");
  }
  // Parse connection string manually so we can fully control SSL behavior
  // (pg driver's connectionString sslmode parsing can override ssl object).
  const url = new URL(connectionString);
  _pool = new Pool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    // Disable TLS entirely — server uses self-signed cert and `npm:pg` on Deno
    // does not honor rejectUnauthorized:false reliably. Requires `host` (not
    // `hostssl`) entry in pg_hba.conf.
    ssl: false,
    // Edge functions are short-lived & spawn many isolates concurrently.
    // Keep the pool tiny and aggressively close idle connections so we don't
    // exhaust the external DB's max_connections limit.
    max: 2,
    idleTimeoutMillis: 3_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  return _pool;
}

export async function query<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = getPool();
  const res = await pool.query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

export async function withTransaction<T>(
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
