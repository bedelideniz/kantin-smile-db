// Shared module: connects to the user's external PostgreSQL via `pg` driver.
// Re-used by all edge functions that need to query the canteen DB.
import pg from "npm:pg@8.13.1";
const { Pool } = pg;
type Pool = InstanceType<typeof pg.Pool>;

let _pool: Pool | null = null;

export class DbConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbConnectionError";
  }
}

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
    // Never keep a PostgreSQL backend session around after it has served a
    // request. This avoids stale catalog/relcache state after external DB
    // migrations, restores, or constraint recreation.
    maxUses: 1,
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
  // Best-effort safety for pooled physical connections. Transaction code below
  // also awaits DISCARD ALL before BEGIN, because pool events are not awaitable.
  _pool.on("connect", (client: any) => {
    client.query("DISCARD ALL").catch(() => {});
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
  // Stale relcache after a concurrent DDL — recycling the pool fixes it.
  /cache lookup failed/i,
];

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

export function isDbConnectionError(err: unknown): boolean {
  return err instanceof DbConnectionError || isTransient(err);
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
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new DbConnectionError(msg || "External database connection failed");
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
        // Await a full session reset before starting the transaction. This is
        // the reliable fix for stale constraint OIDs such as
        // "cache lookup failed for constraint 16712".
        await client.query("DISCARD ALL");
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        throw e;
      } finally {
        // Destroy transaction connections instead of returning them to the pool;
        // write paths must never reuse a backend that may hold stale relcache.
        client.release(true);
      }
    } catch (e) {
      lastErr = e;
      // Retry if connect failed, or if we hit a stale-catalog error mid-tx
      // (recreating the pool drops the poisoned backend connection).
      const transient = isTransient(e);
      if (transient && (!client || /cache lookup failed/i.test(e instanceof Error ? e.message : String(e)))) {
        await recreatePool();
        await sleep(250 + Math.floor(Math.random() * 150));
        continue;
      }
      throw e;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new DbConnectionError(msg || "External database connection failed");
}
