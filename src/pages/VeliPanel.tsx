import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, LogOut, Wallet, ChevronDown, Receipt, GraduationCap, RefreshCcw, CircleAlert, Settings, ShieldAlert } from "lucide-react";
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
import ConsentGate from "@/components/veli/ConsentGate";
import ParentStories from "@/components/veli/ParentStories";
import PhotoUploadModal from "@/components/veli/PhotoUploadModal";
import StudentSettingsModal from "@/components/veli/StudentSettingsModal";
import NotificationsBell from "@/components/veli/NotificationsBell";

interface TxItem { product_name: string; qty: number; unit_price: number; line_total: number; }
interface Tx {
  id: string; total_amount: string | number; balance_before: string | number;
  balance_after: string | number; created_at: string; payment_method: string; status: string;
  kind?: "sale" | "refund";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const [session, setSession] = useState<ParentSession | null>(null);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [highlightTxId, setHighlightTxId] = useState<string | null>(null);

  // Load session & validate, then refresh student list from backend
  useEffect(() => {
    const s = getParentSession();
    if (!s) { navigate("/veli-giris", { replace: true }); return; }
    if (s.must_change) { navigate("/veli-giris", { replace: true }); return; }
    setSession(s);
    const stored = getSelectedStudentId();
    const initial = s.students.find((c) => c.id === stored)?.id ?? s.students[0]?.id ?? null;
    setSelectedIdState(initial);
    if (initial) setSelectedStudentId(initial);

    // Always refresh from backend to pick up newly added siblings
    (async () => {
      try {
        const r = await callParentApi<{ phone: string; must_change?: boolean; students: ParentStudent[] }>("me");
        if (r.must_change) { navigate("/veli-giris", { replace: true }); return; }
        updateParentStudents(r.students);
        const fresh = getParentSession();
        if (fresh) {
          setSession(fresh);
          const sid = getSelectedStudentId();
          const pick = fresh.students.find((c) => c.id === sid)?.id ?? fresh.students[0]?.id ?? null;
          setSelectedIdState(pick);
          if (pick) setSelectedStudentId(pick);
        }
      } catch {
        // silent — keep cached session
      }
    })();
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
    if ((window as any).ReactNativeWebView) {
      (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOGOUT' }));
    }
    clearParentSession();
    navigate("/veli-giris", { replace: true });
  };

  if (!session) return <main className="flex min-h-[100dvh] items-center justify-center">Yükleniyor...</main>;

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] pb-12">
      {/* Premium navy header — rounded bottom, contains brand + stories */}
      <header
        className="relative z-20 px-5 pb-8 pt-[max(2.5rem,env(safe-area-inset-top))] text-primary-foreground shadow-xl"
        style={{
          background: "linear-gradient(180deg, hsl(var(--primary)) 0%, hsl(218 60% 14%) 100%)",
          borderBottomLeftRadius: "2rem",
          borderBottomRightRadius: "2rem",
        }}
      >
        <div className="mx-auto max-w-md">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 p-1.5 backdrop-blur-sm">
                <img src={logo} alt="KantinPay" className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-bold tracking-tight">
                  {selected?.school_name ?? "Veli Paneli"}
                </h1>
                <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-white/55">
                  Veli Paneli • {session.phone}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={refresh}
                disabled={refreshing}
                aria-label="Yenile"
                className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/85 hover:bg-white/15 hover:text-white"
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
              <NotificationsBell />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettingsOpen(true)}
                disabled={!selected}
                aria-label="Ayarlar"
                className="relative h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/85 hover:bg-white/15 hover:text-white"
              >
                <Settings className="h-4 w-4" />
                {selected?.card_lost && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
                  </span>
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                aria-label="Çıkış"
                className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/85 hover:bg-white/15 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Stories inside header */}
          <ParentStories schoolId={selected?.school_id ?? null} variant="dark" />
        </div>
      </header>

      <div className="mx-auto -mt-6 max-w-md space-y-5 px-5 pt-2 relative z-30">

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
              <button className="flex w-full items-center justify-between rounded-2xl border border-white bg-white/95 px-4 py-3.5 text-left shadow-xl shadow-primary/10 backdrop-blur-xl transition hover:shadow-2xl">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full text-accent-foreground shadow-sm"
                    style={{ background: "var(--gradient-gold)" }}
                  >
                    {selected?.photo_url ? (
                      <img
                        src={selected.photo_url}
                        alt={selected.full_name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <GraduationCap className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{selected?.full_name ?? "Öğrenci seçin"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {selected ? [selected.school_name, selected.class_name].filter(Boolean).join(" • ") : ""}
                    </div>
                  </div>
                </div>
                <span className="rounded-lg bg-muted/60 p-1.5">
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-sm">
              <DropdownMenuLabel>Öğrencileriniz ({session.students.length})</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {session.students.map((s) => (
                <DropdownMenuItem key={s.id} onClick={() => switchStudent(s.id)} className="py-3">
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-accent-foreground shadow-sm"
                        style={{ background: "var(--gradient-gold)" }}
                      >
                        {s.photo_url ? (
                          <img src={s.photo_url} alt={s.full_name} className="h-full w-full object-cover" />
                        ) : (
                          <GraduationCap className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{s.full_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[s.school_name, s.class_name, s.student_no].filter(Boolean).join(" • ")}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold text-primary">{fmtTL(s.balance)}</div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {selected?.card_lost && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive shadow-sm"
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="flex-1">
              Kart <strong>kayıp</strong> olarak işaretli — kantinde satış engelli.
            </span>
            <span className="text-xs underline">Ayarlar</span>
          </button>
        )}

        {/* Balance card — vivid balance gradient */}
        {selected && (
          <Card
            className="relative overflow-hidden border-0 text-primary-foreground shadow-2xl shadow-primary/30"
            style={{
              background: "linear-gradient(135deg, hsl(218 50% 22%) 0%, hsl(218 65% 14%) 100%)",
              borderRadius: "1.75rem",
            }}
          >
            <div
              className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full opacity-20 blur-3xl"
              style={{ background: "hsl(var(--gold))" }}
            />
            <CardContent className="relative p-6">
              <div className="mb-6 flex items-start justify-between">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[hsl(var(--gold))]">
                    Mevcut Bakiye
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-bold tracking-tight">
                      {Number(selected.balance).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-2xl font-light text-primary-foreground/80">₺</span>
                  </div>
                </div>
                <div
                  className="rounded-lg px-3 py-1 shadow-lg"
                  style={{ background: "linear-gradient(90deg, hsl(var(--gold)) 0%, hsl(38 65% 45%) 100%)" }}
                >
                  <span className="text-[9px] font-black tracking-tight text-[hsl(var(--accent-foreground))]">
                    KANTİNPAY
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-4">
                <span className="flex items-center gap-1.5 text-xs font-medium text-white/65">
                  <Wallet className="h-3.5 w-3.5" /> {selected.full_name}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--gold))]">
                  Cüzdan Aktif
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transactions */}
        {selected && (
          <Card className="border-border/40 shadow-sm" style={{ borderRadius: "1.75rem" }}>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-base font-extrabold tracking-tight">
                <span className="block h-6 w-1.5 rounded-full bg-primary" />
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
                      {t.kind === "refund" ? (
                        <>
                          <div className="rounded-lg bg-primary/10 px-2 py-1 font-bold tabular-nums text-primary">
                            +{fmtTL(t.total_amount)}
                          </div>
                          <Badge className="mt-1 bg-primary text-primary-foreground text-[10px] hover:bg-primary">
                            {t.status === "partial" ? "KISMİ İADE" : "İADE"}
                          </Badge>
                        </>
                      ) : (
                        <>
                          <div className="rounded-lg bg-destructive/10 px-2 py-1 font-bold tabular-nums text-destructive">
                            −{fmtTL(t.total_amount)}
                          </div>
                          {t.status === "refunded" && (
                            <Badge variant="outline" className="mt-1 text-[10px]">İade edildi</Badge>
                          )}
                          {t.status !== "completed" && t.status !== "refunded" && (
                            <Badge variant="outline" className="mt-1 text-[10px]">{t.status}</Badge>
                          )}
                        </>
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
      <ConsentGate />
      {(() => {
        const needsPhoto = session.students.find((s) => !s.photo_url);
        if (!needsPhoto) return null;
        return (
          <PhotoUploadModal
            student={needsPhoto}
            open
            onUploaded={(url) => {
              const updated = session.students.map((s) =>
                s.id === needsPhoto.id ? { ...s, photo_url: url } : s,
              );
              updateParentStudents(updated);
              setSession({ ...session, students: updated });
            }}
          />
        );
      })()}

      <StudentSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        student={selected ?? null}
        onUpdated={(next) => {
          const updated = session.students.map((s) => (s.id === next.id ? next : s));
          updateParentStudents(updated);
          setSession({ ...session, students: updated });
        }}
      />
    </main>
  );
}
