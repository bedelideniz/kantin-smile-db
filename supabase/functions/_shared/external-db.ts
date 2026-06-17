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
    // Edge functions spawn MANY concurrent isolates and the external DB has a
    // hard `max_connections=100` cap. Keep concurrency per isolate at 1 so we
    // don't saturate the server, but reuse the physical connection across many
    // queries — that's the real win (avoids TCP+auth handshake per query, which
    // was costing 100-500ms when maxUses was 1).
    max: 1,
    maxUses: 100,
    // Reap idle connections quickly so other isolates can grab a slot. The
    // server also has idle_session_timeout=5min as a safety net.
    // Keep the warm connection briefly for back-to-back POS actions, but don't
    // hold scarce DB slots for a full minute across many edge isolates.
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 6_000,
    allowExitOnIdle: true,
    keepAlive: true,
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

export function isInvalidForeignKeyConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /constraint \d+ is not a foreign key constraint/i.test(msg) ||
    /wrong pg_constraint entry for trigger/i.test(msg)
  );
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

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function repairInvalidForeignKeyTriggers(): Promise<{ diag: unknown[]; repaired: string[] }> {
  const diag: unknown[] = [];
  const repaired: string[] = [];

  await withTransaction(async (client) => {
    const d = await client.query(`
      SELECT t.oid::text AS oid,
             t.tgname,
             t.tgrelid::regclass::text AS tbl,
             t.tgconstrrelid::regclass::text AS constrrel,
             rel.relkind,
             t.tgconstraint::text AS conoid,
             p.proname AS fn,
             c.contype,
             c.conname,
             c.conrelid::regclass::text AS conrel,
             c.confrelid::regclass::text AS confrel,
             CASE
               WHEN c.oid IS NULL THEN 'missing_constraint'
               WHEN c.contype <> 'f' THEN 'not_foreign_key'
               WHEN p.proname IN ('RI_FKey_noaction_del','RI_FKey_restrict_del','RI_FKey_cascade_del','RI_FKey_setnull_del','RI_FKey_setdefault_del','RI_FKey_noaction_upd','RI_FKey_restrict_upd','RI_FKey_cascade_upd','RI_FKey_setnull_upd','RI_FKey_setdefault_upd')
                    AND (c.confrelid <> t.tgrelid OR c.conrelid <> t.tgconstrrelid) THEN 'pk_side_relation_mismatch'
               WHEN p.proname IN ('RI_FKey_check_ins','RI_FKey_check_upd')
                    AND (c.conrelid <> t.tgrelid OR c.confrelid <> t.tgconstrrelid) THEN 'fk_side_relation_mismatch'
               ELSE 'unknown'
             END AS reason
        FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        LEFT JOIN pg_constraint c ON c.oid = t.tgconstraint
        LEFT JOIN pg_class rel ON rel.oid = t.tgrelid
       WHERE t.tgconstraint <> 0
         AND p.proname LIKE 'RI_FKey_%'
         AND (
           c.oid IS NULL
           OR c.contype <> 'f'
           OR (
             c.contype = 'f'
             AND (
               (p.proname IN ('RI_FKey_noaction_del','RI_FKey_restrict_del','RI_FKey_cascade_del','RI_FKey_setnull_del','RI_FKey_setdefault_del','RI_FKey_noaction_upd','RI_FKey_restrict_upd','RI_FKey_cascade_upd','RI_FKey_setnull_upd','RI_FKey_setdefault_upd')
                AND (c.confrelid <> t.tgrelid OR c.conrelid <> t.tgconstrrelid))
               OR
               (p.proname IN ('RI_FKey_check_ins','RI_FKey_check_upd')
                AND (c.conrelid <> t.tgrelid OR c.confrelid <> t.tgconstrrelid))
             )
           )
         )
       ORDER BY t.oid
    `);
    diag.push(...d.rows);
    if (d.rowCount === 0) return;

    await client.query("SET LOCAL allow_system_table_mods = on").catch(() => {});

    const groups = new Map<string, any[]>();
    for (const row of d.rows) {
      const key = row.conname && row.conrel ? `${row.conrel}::${row.conname}` : `orphan::${row.conoid}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    for (const [key, rows] of groups) {
      const first = rows[0];
      const relationMismatch = rows.some((r) => String(r.reason ?? "").includes("relation_mismatch"));
      if (first.conname && first.conrel && !relationMismatch) {
        try {
          await client.query("SAVEPOINT sp_repair_invalid_fk");
          await client.query(`ALTER TABLE ${first.conrel} DROP CONSTRAINT ${quoteIdent(first.conname)} CASCADE`);
          await client.query("RELEASE SAVEPOINT sp_repair_invalid_fk");
          repaired.push(`dropped constraint ${key}`);
          continue;
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT sp_repair_invalid_fk").catch(() => {});
          await client.query("RELEASE SAVEPOINT sp_repair_invalid_fk").catch(() => {});
          repaired.push(`constraint drop failed ${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const oids = rows.map((r) => Number(r.oid)).filter((n) => Number.isInteger(n) && n > 0);
      if (oids.length === 0) continue;
      const oidList = oids.join(",");
      await client.query(`DELETE FROM pg_depend WHERE classid = 'pg_trigger'::regclass AND objid IN (${oidList})`);
      const del = await client.query(`DELETE FROM pg_trigger WHERE oid IN (${oidList})`);
      repaired.push(`deleted ${del.rowCount ?? 0} invalid RI triggers for ${key}`);
    }

    await client.query(`
      DO $$ BEGIN
        IF to_regclass('donation_distributions') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='donation_distributions'::regclass AND contype='p') THEN
          ALTER TABLE donation_distributions ADD PRIMARY KEY (id);
        END IF;
        IF to_regclass('canteen_payouts') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='canteen_payouts'::regclass AND contype='p') THEN
          ALTER TABLE canteen_payouts ADD PRIMARY KEY (id);
        END IF;
      END $$;
    `);
  });

  return { diag, repaired };
}
