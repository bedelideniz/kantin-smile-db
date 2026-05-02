import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, LogOut, Wallet, ChevronDown, Receipt, GraduationCap, RefreshCcw, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  callParentApi, clearParentSession, getParentSession, getSelectedStudentId,
  setSelectedStudentId, updateParentStudents, type ParentSession, type ParentStudent,
} from "@/lib/parentApi";
import logo from "@/assets/kantinpay-logo.png";
import BottomNav from "@/components/veli/BottomNav";
import ParentSplash from "@/components/veli/ParentSplash";
import PhotoUploadModal from "@/components/veli/PhotoUploadModal";

interface TxItem { product_name: string; qty: number; unit_price: number; line_total: number; }
interface Tx {
  id: string; total_amount: string | number; balance_before: string | number;
  balance_after: string | number; created_at: string; payment_method: string; status: string;
  items: TxItem[];
}

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export default function VeliPanel() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<ParentSession | null>(null);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [transactions, setTransactions] = useState<Tx[]>([]);

  // Load session & validate
  useEffect(() => {
    const s = getParentSession();
    if (!s) { navigate("/veli-giris", { replace: true }); return; }
    setSession(s);
    const stored = getSelectedStudentId();
    const initial = s.students.find((c) => c.id === stored)?.id ?? s.students[0]?.id ?? null;
    setSelectedIdState(initial);
    if (initial) setSelectedStudentId(initial);
  }, [navigate]);

  const selected: ParentStudent | null = useMemo(() => {
    if (!session || !selectedId) return null;
    return session.students.find((s) => s.id === selectedId) ?? null;
  }, [session, selectedId]);

  // Fetch transactions whenever selected student changes
  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      setTxLoading(true);
      try {
        const r = await callParentApi<Tx[]>("list_transactions", { student_id: selectedId, limit: 50 });
        setTransactions(r);
      } catch (e: any) {
        toast({ title: "Hareketler yüklenemedi", description: e?.message, variant: "destructive" });
      } finally { setTxLoading(false); }
    })();
  }, [selectedId, toast]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await callParentApi<{ phone: string; students: ParentStudent[] }>("me");
      updateParentStudents(r.students);
      const s = getParentSession();
      if (s) setSession(s);
      if (selectedId) {
        const tx = await callParentApi<Tx[]>("list_transactions", { student_id: selectedId, limit: 50 });
        setTransactions(tx);
      }
    } catch (e: any) {
      toast({ title: "Yenilenemedi", description: e?.message, variant: "destructive" });
    } finally { setRefreshing(false); }
  };

  const switchStudent = (id: string) => {
    setSelectedIdState(id);
    setSelectedStudentId(id);
  };

  const logout = async () => {
    try { await callParentApi("logout"); } catch { /* ignore */ }
    clearParentSession();
    navigate("/veli-giris", { replace: true });
  };

  if (!session) return <main className="flex min-h-[100dvh] items-center justify-center">Yükleniyor...</main>;

  return (
    <main className="min-h-[100dvh] bg-gradient-to-b from-primary/5 via-background to-background pb-12">
      {/* Top bar — vivid gradient */}
      <header
        className="sticky top-0 z-20 px-4 py-3 text-primary-foreground shadow-lg"
        style={{ background: "var(--gradient-primary)" }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-md ring-2 ring-white/40">
              <img src={logo} alt="KantinPay" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight">
                {selected?.school_name ?? "Veli Paneli"}
              </h1>
              <p className="truncate text-xs text-primary-foreground/75">{session.phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Yenile"
              className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
            >
              <RefreshCcw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Çıkış"
              className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-4 p-4">
        {/* Student switcher */}
        {session.students.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <CircleAlert className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Bu numaraya bağlı aktif öğrenci kalmadı. Lütfen okul yöneticinize başvurun.
              </p>
            </CardContent>
          </Card>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center justify-between rounded-2xl border border-accent/30 bg-card px-4 py-3 text-left shadow-md transition hover:shadow-lg">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-full text-accent-foreground shadow-sm"
                    style={{ background: "var(--gradient-gold)" }}
                  >
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{selected?.full_name ?? "Öğrenci seçin"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {selected ? [selected.school_name, selected.class_name].filter(Boolean).join(" • ") : ""}
                    </div>
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-sm">
              <DropdownMenuLabel>Öğrencileriniz ({session.students.length})</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {session.students.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => switchStudent(s.id)} className="py-3">
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.full_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[s.school_name, s.class_name, s.student_no].filter(Boolean).join(" • ")}
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold text-primary">{fmtTL(s.balance)}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Balance card — vivid balance gradient */}
        {selected && (
          <Card
            className="relative overflow-hidden border-0 text-primary-foreground shadow-xl"
            style={{ background: "var(--gradient-balance)" }}
          >
            {/* Decorative blobs */}
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full opacity-30 blur-2xl"
              style={{ background: "hsl(var(--gold))" }}
            />
            <div
              className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full opacity-20 blur-2xl"
              style={{ background: "hsl(var(--primary-glow))" }}
            />
            <CardContent className="relative p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-primary-foreground/80">
                  <Wallet className="h-3.5 w-3.5" /> Mevcut Bakiye
                </div>
                <Badge
                  className="border-0 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground"
                  style={{ background: "hsl(var(--gold))" }}
                >
                  KantinPay
                </Badge>
              </div>
              <div className="mt-2 text-4xl font-bold tracking-tight drop-shadow-sm">
                {fmtTL(selected.balance)}
              </div>
              <div className="mt-1 text-sm text-primary-foreground/80">{selected.full_name}</div>
            </CardContent>
          </Card>
        )}

        {/* Transactions */}
        {selected && (
          <Card className="border-border/60 shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-primary-foreground"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  <Receipt className="h-4 w-4" />
                </span>
                Son Hareketler
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {txLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : transactions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Henüz harcama yok.</p>
              ) : transactions.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-border/60 bg-card p-3 shadow-sm transition hover:border-accent/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-primary/70">{fmtDate(t.created_at)}</div>
                      <div className="mt-1 space-y-0.5">
                        {t.items.map((it, i) => (
                          <div key={i} className="flex justify-between gap-2 text-sm">
                            <span className="truncate">
                              {it.qty > 1 && <span className="font-semibold text-accent-foreground">{it.qty}× </span>}
                              {it.product_name}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {fmtTL(it.line_total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="rounded-lg bg-destructive/10 px-2 py-1 font-bold tabular-nums text-destructive">
                        −{fmtTL(t.total_amount)}
                      </div>
                      {t.status !== "completed" && (
                        <Badge variant="outline" className="mt-1 text-[10px]">{t.status}</Badge>
                      )}
                    </div>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>Önce: <span className="font-medium text-foreground/70">{fmtTL(t.balance_before)}</span></span>
                    <span>Sonra: <span className="font-medium text-foreground/70">{fmtTL(t.balance_after)}</span></span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      <BottomNav />
      <ParentSplash schoolId={selected?.school_id ?? null} />
    </main>
  );
}
