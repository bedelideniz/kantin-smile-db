import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, TrendingUp, AlertTriangle, Package } from "lucide-react";
import { callCashierApi, getCashierSession } from "@/lib/cashierApi";
import { cn } from "@/lib/utils";
import logo from "@/assets/kantinpay-logo.png";

type Bucket = { total: number; count: number };
interface DashboardData {
  today: Bucket; week: Bucket; month: Bucket; year: Bucket; all_time: Bucket;
  daily: { day: string; total: number; count: number }[];
}
interface LowStockProduct {
  id: string; name: string; stock_qty: number; price: number | string; category_id: string | null;
}

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

type Period = "today" | "week" | "month" | "year" | "all_time";
const PERIOD_LABELS: Record<Period, string> = {
  today: "Bugün",
  week: "Son 7 Gün",
  month: "Son 30 Gün",
  year: "Bu Yıl",
  all_time: "Tüm Zamanlar",
};

export default function KasiyerDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const session = getCashierSession();

  const [data, setData] = useState<DashboardData | null>(null);
  const [lowStock, setLowStock] = useState<LowStockProduct[] | null>(null);
  const [period, setPeriod] = useState<Period>("today");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) { navigate("/kantin-giris", { replace: true }); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const [d, l] = await Promise.all([
          callCashierApi<DashboardData>("canteen_dashboard"),
          callCashierApi<{ threshold: number; products: LowStockProduct[] }>("low_stock_products", { threshold: 20 }),
        ]);
        if (cancelled) return;
        setData(d);
        setLowStock(l.products);
      } catch (e: any) {
        if (!cancelled) toast({ title: "Yükleme hatası", description: e?.message, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session, navigate, toast]);

  const active = data?.[period];

  const maxDaily = useMemo(
    () => Math.max(1, ...(data?.daily.map((d) => d.total) ?? [0])),
    [data],
  );

  if (!session) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate("/kantin")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Kasaya Dön
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Kantin Dashboard</h1>
              <p className="text-sm text-muted-foreground">{session.school.name}</p>
            </div>
          </div>
        </header>

        {/* ===== Period filter ===== */}
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>

        {/* ===== Active period summary ===== */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/50 bg-card/60 backdrop-blur">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" /> {PERIOD_LABELS[period]} Toplam Satış
              </div>
              {loading || !active ? (
                <Skeleton className="mt-3 h-10 w-48" />
              ) : (
                <div className="mt-2 text-4xl font-bold tabular-nums text-primary">{fmt(active.total)}</div>
              )}
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/60 backdrop-blur">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Package className="h-3.5 w-3.5" /> {PERIOD_LABELS[period]} İşlem Adedi
              </div>
              {loading || !active ? (
                <Skeleton className="mt-3 h-10 w-32" />
              ) : (
                <div className="mt-2 text-4xl font-bold tabular-nums">
                  {active.count.toLocaleString("tr-TR")} <span className="text-base font-normal text-muted-foreground">satış</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ===== All-period grid ===== */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => {
            const b = data?.[p];
            return (
              <Card key={p} className={cn("border-border/50", period === p && "ring-2 ring-primary/40")}>
                <CardContent className="p-4">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{PERIOD_LABELS[p]}</div>
                  {loading || !b ? (
                    <Skeleton className="mt-2 h-7 w-24" />
                  ) : (
                    <>
                      <div className="mt-1 text-xl font-bold tabular-nums">{fmt(b.total)}</div>
                      <div className="text-[11px] text-muted-foreground">{b.count} işlem</div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ===== Daily chart (last 30 days) ===== */}
        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardContent className="p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Günlük Satışlar (Son 30 Gün)
            </h2>
            {loading || !data ? (
              <Skeleton className="h-48 w-full" />
            ) : data.daily.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Henüz satış yok</div>
            ) : (
              <div className="flex h-48 items-end gap-1">
                {data.daily.map((d) => {
                  const h = Math.max(2, (d.total / maxDaily) * 100);
                  const date = new Date(d.day);
                  return (
                    <div key={d.day} className="group flex flex-1 flex-col items-center gap-1">
                      <div className="relative w-full flex-1 flex items-end">
                        <div
                          className="w-full rounded-t bg-primary/80 transition hover:bg-primary"
                          style={{ height: `${h}%` }}
                          title={`${date.toLocaleDateString("tr-TR")}: ${fmt(d.total)} (${d.count} işlem)`}
                        />
                      </div>
                      <div className="text-[9px] text-muted-foreground tabular-nums">
                        {date.getDate()}/{date.getMonth() + 1}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Low stock list ===== */}
        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Stoğu Azalan Ürünler (&lt; 20 adet)
              </h2>
              {lowStock && (
                <Badge variant="outline" className="text-xs">{lowStock.length} ürün</Badge>
              )}
            </div>
            {loading || !lowStock ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            ) : lowStock.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                ✓ Stoğu 20'nin altında ürün yok.
              </div>
            ) : (
              <ul className="space-y-2">
                {lowStock.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-background/60 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">Birim: {fmt(Number(p.price))}</div>
                    </div>
                    <div className="ml-3 flex items-center gap-2">
                      <Badge
                        variant={p.stock_qty <= 0 ? "destructive" : p.stock_qty <= 5 ? "destructive" : "secondary"}
                        className="tabular-nums"
                      >
                        {p.stock_qty} adet
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
