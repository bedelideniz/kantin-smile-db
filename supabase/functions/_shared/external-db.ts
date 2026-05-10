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
    max: 1,
    idleTimeoutMillis: 1_500,
    // Keep connection attempts below the edge-function gateway timeout.
    // If the external DB is saturated, fail fast and let the caller retry.
    connectionTimeoutMillis: 6_000,
    allowExitOnIdle: true,
  });
  // Swallow background pool errors so a dropped idle connection doesn't crash the isolate.
  _pool.on("error", (err: unknown) => {
    console.warn("pg pool error:", err instanceof Error ? err.message : err);
  });
  return _pool;
}

const TRANSIENT_PATTERNS = [
  /too many clients/i,
  /remaining connection slots/i,
  /connection terminated/i,
  /Connection terminated unexpectedly/i,
  /timeout exceeded when trying to connect/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
];

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

async function recreatePool() {
  if (_pool) {
    const oldPool = _pool;
    _pool = null;
    await oldPool.end().catch(() => {});
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function query<T = any>(
  text: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pool = getPool();
      const res = await pool.query(text, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    } catch (e) {
      lastErr = e;
      if (!isTransient(e)) throw e;
      await recreatePool();
      // Short jitter keeps total function time below the gateway timeout.
      await sleep(250 + Math.floor(Math.random() * 150));
    }
  }
  throw lastErr;
}

export async function withTransaction<T>(
  fn: (client: any) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let client: any = null;
    try {
      const pool = getPool();
      client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      lastErr = e;
      // Only retry if we never got into the transaction body (i.e. connect failed).
      if (!client && isTransient(e)) {
        await recreatePool();
        await sleep(250 + Math.floor(Math.random() * 150));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
