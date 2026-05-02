import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, LogOut, HandHeart, Search, Wallet, Send, RefreshCcw, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  callDmApi, clearDmSession, getDmSession,
} from "@/lib/donationManagerApi";

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const fmtDate = (s: string) =>
  new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

interface Me {
  id: string; full_name: string; school_id: string; school_name: string;
  pool_balance: number; total_received: number; total_distributed: number;
}
interface Student { id: string; full_name: string; class_name: string | null; student_no: string | null; balance: string | number; }
interface Distribution {
  id: string; amount: string | number; created_at: string; note: string | null;
  student_name: string; student_class: string | null; manager_name: string | null;
  pool_balance_after: string | number; student_balance_after: string | number;
}

export default function BagisYoneticiPanel() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [target, setTarget] = useState<Student | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getDmSession()) { navigate("/bagis-yonetici-giris", { replace: true }); return; }
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const [m, s, d] = await Promise.all([
        callDmApi<Me>("me"),
        callDmApi<Student[]>("list_students"),
        callDmApi<Distribution[]>("list_distributions", { limit: 50 }),
      ]);
      setMe(m); setStudents(s); setDistributions(d);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
      if (e?.status === 401) navigate("/bagis-yonetici-giris", { replace: true });
    } finally { setRefreshing(false); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    if (!q) return students;
    return students.filter((s) =>
      s.full_name.toLocaleLowerCase("tr").includes(q) ||
      (s.class_name ?? "").toLocaleLowerCase("tr").includes(q) ||
      (s.student_no ?? "").toLocaleLowerCase("tr").includes(q),
    );
  }, [students, search]);

  const logout = async () => {
    try { await callDmApi("logout"); } catch { /* ignore */ }
    clearDmSession();
    navigate("/bagis-yonetici-giris", { replace: true });
  };

  const submitDistribute = async () => {
    if (!target || !me) return;
    const n = Number(amount.replace(",", "."));
    if (!isFinite(n) || n < 1) {
      toast({ title: "Geçersiz tutar", description: "En az 1 ₺ giriniz", variant: "destructive" }); return;
    }
    if (n > me.pool_balance) {
      toast({ title: "Havuz yetersiz", description: `Mevcut havuz: ${fmtTL(me.pool_balance)}`, variant: "destructive" }); return;
    }
    setSubmitting(true);
    try {
      await callDmApi("distribute", { student_id: target.id, amount: n, note: note || undefined });
      toast({ title: "Aktarıldı", description: `${target.full_name} öğrencisine ${fmtTL(n)} eklendi.` });
      setTarget(null); setAmount(""); setNote("");
      refreshAll();
    } catch (e: any) {
      toast({ title: "İşlem başarısız", description: e?.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  if (!me) {
    return <main className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  }

  return (
    <main className="min-h-[100dvh] bg-gradient-to-b from-primary/5 via-background to-background pb-12">
      <header className="sticky top-0 z-20 px-4 py-3 text-primary-foreground shadow-lg" style={{ background: "var(--gradient-primary)" }}>
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-base font-semibold">
              <HandHeart className="h-5 w-5" /> Bağış Yönetimi
            </h1>
            <p className="truncate text-xs text-primary-foreground/80">{me.school_name} • {me.full_name}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={refreshAll} disabled={refreshing}
              className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" aria-label="Yenile">
              <RefreshCcw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" onClick={logout}
              className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground" aria-label="Çıkış">
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {/* Pool summary */}
        <Card className="border-0 text-primary-foreground shadow-xl" style={{ background: "var(--gradient-balance)" }}>
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-wide text-primary-foreground/80">Bağış Havuzu</div>
            <div className="mt-1 text-4xl font-bold">{fmtTL(me.pool_balance)}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-primary-foreground/70 text-xs">Toplam Toplanan</div>
                <div className="font-semibold">{fmtTL(me.total_received)}</div>
              </div>
              <div>
                <div className="text-primary-foreground/70 text-xs">Toplam Dağıtılan</div>
                <div className="font-semibold">{fmtTL(me.total_distributed)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="students">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="students" className="gap-1.5"><Send className="h-4 w-4" /> Öğrencilere Aktar</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5"><History className="h-4 w-4" /> Geçmiş</TabsTrigger>
          </TabsList>

          <TabsContent value="students" className="mt-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Öğrenci adı, sınıf veya numara ile ara…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Sonuç yok.</p>
                ) : filtered.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3 hover:border-primary/40">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.full_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[s.class_name, s.student_no].filter(Boolean).join(" • ") || "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="hidden text-right text-sm sm:block">
                        <div className="text-[10px] uppercase text-muted-foreground">Bakiye</div>
                        <div className="font-semibold tabular-nums">{fmtTL(s.balance)}</div>
                      </div>
                      <Button size="sm" onClick={() => { setTarget(s); setAmount(""); setNote(""); }}>
                        <Send className="h-4 w-4" /> Aktar
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Son Dağıtımlar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {distributions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Henüz dağıtım yapılmadı.</p>
                ) : distributions.map((d) => (
                  <div key={d.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{d.student_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[d.student_class, fmtDate(d.created_at)].filter(Boolean).join(" • ")}
                        </div>
                        {d.note && <div className="mt-1 text-xs italic text-muted-foreground">"{d.note}"</div>}
                      </div>
                      <div className="text-right">
                        <div className="rounded-md bg-primary/10 px-2 py-1 font-bold tabular-nums text-primary">
                          +{fmtTL(d.amount)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Distribute dialog */}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" /> Öğrenciye Aktar
            </DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/40 p-3">
                <div className="font-semibold">{target.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {[target.class_name, target.student_no].filter(Boolean).join(" • ") || "—"}
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Wallet className="h-3 w-3" /> Mevcut bakiye: <span className="font-semibold text-foreground">{fmtTL(target.balance)}</span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Aktarılacak Tutar (₺)</label>
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d,.]/g, ""))}
                  autoFocus
                />
                <div className="mt-1 text-xs text-muted-foreground">Havuz: {fmtTL(me.pool_balance)}</div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Not (opsiyonel)</label>
                <Input
                  placeholder="örn. Eylül desteği"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={submitting}>İptal</Button>
            <Button onClick={submitDistribute} disabled={submitting || !amount}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aktar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
