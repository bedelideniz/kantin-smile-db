import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { callAdminApi } from "@/lib/adminApi";
import { Skeleton } from "@/components/ui/skeleton";
import logo from "@/assets/kantinpay-logo.png";

type Bucket = { today: number; week: number; month: number; total: number };
type Stats = {
  topups: Bucket;
  payouts: Bucket & { owed: number };
  donations: Bucket;
  distributions: Bucket;
  pool_balance: number;
  student_balances: number;
  donation_pool_balances: number;
};

const fmt = (n: number | null | undefined) =>
  (Number(n ?? 0)).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardContent className="p-5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-2 text-3xl font-bold tabular-nums ${accent ?? "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Section({ title, b, accent }: { title: string; b: Bucket; accent?: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Bugün" value={fmt(b.today)} accent={accent} />
        <StatCard label="Son 7 Gün" value={fmt(b.week)} accent={accent} />
        <StatCard label="Son 30 Gün" value={fmt(b.month)} accent={accent} />
        <StatCard label="Toplam" value={fmt(b.total)} accent={accent} />
      </div>
    </div>
  );
}

type Topup = { id: string; school_name: string; amount: number | string; created_at: string };

export default function Dashboard() {
  const { user, loading, hasRole } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [topups, setTopups] = useState<Topup[] | null>(null);
  const [sms, setSms] = useState<{ ok: boolean; credit: number | null; amount: number | null; error?: string } | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    const clk = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clk);
  }, []);

  useEffect(() => {
    if (!user || !hasRole("super_admin")) return;
    let cancelled = false;
    const load = () => {
      callAdminApi<Stats>("dashboard_stats")
        .then((r) => { if (!cancelled) { setStats(r); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e.message); });
      callAdminApi<{ topups: Topup[] }>("recent_topups", { limit: 40 })
        .then((r) => { if (!cancelled) setTopups(r.topups ?? []); })
        .catch(() => { /* silent */ });
      callAdminApi<{ ok: boolean; credit: number | null; amount: number | null; error?: string }>("sms_balance")
        .then((r) => { if (!cancelled) setSms(r); })
        .catch(() => { /* silent */ });
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user, hasRole]);

  if (loading) return <div className="flex min-h-screen items-center justify-center">Yükleniyor…</div>;

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="grid grid-cols-3 items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Canlı Dashboard</h1>
            <p className="text-sm text-muted-foreground">Tüm okul/kantin bazlı toplam akış</p>
          </div>
          <div className="flex justify-center">
            <img src={logo} alt="KantinPay" className="h-64 w-auto drop-shadow-md" />
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{now.toLocaleTimeString("tr-TR")}</div>
            <div className="text-xs text-muted-foreground">{now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          </div>
        </header>

        {error && <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="border-border/50 bg-card/60 backdrop-blur">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Anlık Yüklemeler</h2>
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              </div>
              {!topups ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : topups.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Henüz yükleme yok</div>
              ) : (
                <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
                  {topups.map((t) => {
                    const d = new Date(t.created_at);
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{t.school_name}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Yükleme · {d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                        <div className="ml-2 shrink-0 font-bold tabular-nums text-emerald-500">
                          {fmt(Number(t.amount))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {!stats ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : (
              <>
                <Section title="Yükleme Tutarı" b={stats.topups} accent="text-primary" />
                <Section title="Kantinciye Ödenen Tutar" b={stats.payouts} accent="text-emerald-500" />
                <Section title="Okullara Yapılan Bağışlar" b={stats.donations} accent="text-amber-500" />
                <Section title="Bağış Dağıtımları" b={stats.distributions} accent="text-sky-500" />

                <div className="space-y-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Havuz / Bakiye</h2>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <StatCard label="Havuzda Kalan (Banka)" value={fmt(stats.pool_balance)} accent="text-primary" />
                    <StatCard label="Öğrenci Bakiyeleri Toplamı" value={fmt(stats.student_balances)} />
                    <StatCard label="Kantinciye Ödenecek (Bekleyen)" value={fmt(stats.payouts.owed)} accent="text-amber-500" />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
