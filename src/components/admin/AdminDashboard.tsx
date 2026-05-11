import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { callAdminApi } from "@/lib/adminApi";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis, Legend,
} from "recharts";
import { ExternalLink } from "lucide-react";
import DBHealthBadge from "./DBHealthBadge";

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
type Topup = { id: string; school_name: string; amount: number | string; created_at: string };
type DashboardHome = { stats: Stats; topups: Topup[] };

const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${accent ?? "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard({ openAlarms }: { openAlarms: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [topups, setTopups] = useState<Topup[] | null>(null);
  const [sms, setSms] = useState<{ ok: boolean; credit: number | null; amount: number | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      callAdminApi<DashboardHome>("dashboard_home", { limit: 12 })
        .then((r) => {
          if (cancelled) return;
          setStats(r.stats);
          setTopups(r.topups ?? []);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    callAdminApi<{ ok: boolean; credit: number | null; amount: number | null }>("sms_balance")
      .then((r) => !cancelled && setSms(r))
      .catch(() => !cancelled && setSms({ ok: false, credit: null, amount: null }));
    return () => { cancelled = true; };
  }, []);

  const trendData = stats ? [
    { name: "Bugün", Yükleme: Number(stats.topups.today), Ödeme: Number(stats.payouts.today), Bağış: Number(stats.donations.today) },
    { name: "7 Gün", Yükleme: Number(stats.topups.week), Ödeme: Number(stats.payouts.week), Bağış: Number(stats.donations.week) },
    { name: "30 Gün", Yükleme: Number(stats.topups.month), Ödeme: Number(stats.payouts.month), Bağış: Number(stats.donations.month) },
  ] : [];

  const flowData = stats ? [
    { name: "Yüklemeler", value: Number(stats.topups.total) },
    { name: "Ödemeler", value: Number(stats.payouts.total) },
    { name: "Bağışlar", value: Number(stats.donations.total) },
    { name: "Dağıtımlar", value: Number(stats.distributions.total) },
  ] : [];

  const PIE_COLORS = ["hsl(var(--primary))", "hsl(142 71% 45%)", "hsl(38 92% 50%)", "hsl(199 89% 48%)"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Genel Bakış</h2>
          <p className="text-sm text-muted-foreground">Tüm okul/kantin bazlı toplam akış</p>
        </div>
        <div className="flex items-center gap-2">
          <DBHealthBadge />
          <Button variant="outline" size="sm" onClick={() => window.open("/dashboard", "_blank")}>
            <ExternalLink className="mr-1.5 h-4 w-4" /> TV Dashboard
          </Button>
        </div>
      </div>

      {!stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Bugün Yükleme" value={fmt(stats.topups.today)} accent="text-primary" />
          <Kpi label="Bugün Ödeme" value={fmt(stats.payouts.today)} accent="text-emerald-500" />
          <Kpi label="Bekleyen Ödeme" value={fmt(stats.payouts.owed)} accent="text-amber-500" />
          <Kpi label="Havuz Bakiyesi" value={fmt(stats.pool_balance)} accent="text-primary" />
          <Kpi label="Açık Alarm" value={String(openAlarms)} accent={openAlarms > 0 ? "text-destructive" : undefined} />
          <Kpi label="SMS Kalan" value={sms?.ok ? `${(sms.credit ?? sms.amount ?? 0).toLocaleString("tr-TR")} adet` : "—"} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Akış Trendi</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            {!stats ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12}
                    tickFormatter={(v) => Number(v).toLocaleString("tr-TR")} />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmt(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Yükleme" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Ödeme" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Bağış" fill="hsl(38 92% 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Toplam Akış Dağılımı</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            {!stats ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={flowData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {flowData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmt(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Son Yüklemeler</CardTitle></CardHeader>
        <CardContent>
          {!topups ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : topups.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Henüz yükleme yok</div>
          ) : (
            <ul className="divide-y divide-border/50">
              {topups.map((t) => {
                const d = new Date(t.created_at);
                return (
                  <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.school_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {d.toLocaleDateString("tr-TR")} · {d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="ml-2 shrink-0 font-bold tabular-nums text-emerald-500">{fmt(Number(t.amount))}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
