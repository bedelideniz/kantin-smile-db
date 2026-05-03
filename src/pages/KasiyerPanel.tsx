import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  LogOut, QrCode, Search, Trash2, X, Plus, Minus,
  CreditCard, CircleDot, Wallet, ShoppingCart, AlertTriangle, GraduationCap, Sparkles, Barcode, Loader2, ShieldOff,
  Receipt, Bell,
} from "lucide-react";
import {
  callCashierApi,
  clearCashierSession,
  getCashierSession,
} from "@/lib/cashierApi";
import { QrScannerDialog } from "@/components/kasiyer/QrScannerDialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useUsbCardReader } from "@/hooks/useUsbCardReader";
import { cn } from "@/lib/utils";

interface Category { id: string; name: string; color: string | null; sort_order: number }
interface Product {
  id: string; category_id: string | null; name: string;
  price: number | string; image_url: string | null;
  barcode?: string | null;
  stock_tracking: boolean; stock_qty: number;
}
interface Student {
  id: string; full_name: string; class_name: string | null;
  student_no: string | null; balance: number | string;
  card_lost?: boolean;
  photo_url?: string | null;
}
interface CartItem { product_id: string; name: string; price: number; qty: number; catColor: string }
interface RecentSale {
  id: string;
  tx_no: number;
  total_amount: number | string;
  balance_after: number | string;
  created_at: string;
  status: string;
  refunded_amount: number | string;
  student_name: string;
  student_class: string | null;
  has_alarm: boolean;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Rotating accent palette (uses CSS vars defined in index.css)
const CAT_VARS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6"];
const catColor = (idx: number) => `hsl(var(${CAT_VARS[idx % CAT_VARS.length]}))`;

export default function KasiyerPanel() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const session = getCashierSession();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCat, setActiveCat] = useState<string | "all">("all");
  const [loading, setLoading] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [student, setStudent] = useState<Student | null>(null);

  const [qrOpen, setQrOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [manualBarcode, setManualBarcode] = useState("");
  const [saleError, setSaleError] = useState<string | null>(null);
  const [lostCardStudent, setLostCardStudent] = useState<Student | null>(null);
  const [markingFound, setMarkingFound] = useState(false);
  const [seizeMode, setSeizeMode] = useState(false);
  const [seizeNote, setSeizeNote] = useState("");
  const [seizing, setSeizing] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [alarmFor, setAlarmFor] = useState<RecentSale | null>(null);
  const [alarmReason, setAlarmReason] = useState("");
  const [alarmSubmitting, setAlarmSubmitting] = useState(false);

  const loadRecent = async () => {
    setRecentLoading(true);
    try {
      const r = await callCashierApi<RecentSale[]>("recent_sales", { limit: 30 });
      setRecentSales(r);
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setRecentLoading(false); }
  };

  const submitAlarm = async () => {
    if (!alarmFor) return;
    setAlarmSubmitting(true);
    try {
      await callCashierApi("raise_alarm", {
        transaction_id: alarmFor.id,
        ...(alarmReason.trim() ? { reason: alarmReason.trim() } : {}),
      });
      toast({
        title: "Alarm gönderildi",
        description: `İşlem #${alarmFor.tx_no} yöneticiye iletildi.`,
      });
      setAlarmFor(null); setAlarmReason("");
      await loadRecent();
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setAlarmSubmitting(false); }
  };

  // Auth gate
  useEffect(() => {
    if (!session) navigate("/kasiyer-giris", { replace: true });
  }, [session, navigate]);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Load catalog
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const [cats, prods] = await Promise.all([
          callCashierApi<Category[]>("list_categories"),
          callCashierApi<Product[]>("list_products"),
        ]);
        setCategories(cats);
        setProducts(prods);
      } catch (e: any) {
        toast({ title: "Yükleme hatası", description: e?.message, variant: "destructive" });
        if (e?.status === 401) navigate("/kasiyer-giris", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [session, navigate, toast]);

  // Map: category_id -> color (rotating index)
  const catColorMap = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c, i) => m.set(c.id, catColor(i)));
    return m;
  }, [categories]);

  const visibleProducts = useMemo(() => {
    if (activeCat === "all") return products;
    return products.filter((p) => p.category_id === activeCat);
  }, [products, activeCat]);

  const cartTotal = useMemo(
    () => cart.reduce((s, i) => s + i.price * i.qty, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const addToCart = (p: Product) => {
    const color = (p.category_id && catColorMap.get(p.category_id)) || catColor(0);
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product_id === p.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...prev, { product_id: p.id, name: p.name, price: Number(p.price), qty: 1, catColor: color }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => i.product_id === productId ? { ...i, qty: i.qty + delta } : i)
        .filter((i) => i.qty > 0),
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const clearCart = () => setCart([]);
  const clearStudent = () => setStudent(null);

  const handleQrResult = async (text: string) => {
    setQrOpen(false);
    try {
      const r = await callCashierApi<{ student: Student }>("lookup_student", { qr_token: text });
      if (r.student.card_lost) {
        setStudent(null);
        setLostCardStudent(r.student);
        return;
      }
      setStudent(r.student);
      toast({ title: "Öğrenci bulundu", description: r.student.full_name });
    } catch (e: any) {
      toast({ title: "Bulunamadı", description: e?.message, variant: "destructive" });
    }
  };

  const handleNfcResult = async (uid: string) => {
    try {
      const r = await callCashierApi<{ student: Student }>("lookup_student", { nfc_uid: uid });
      if (r.student.card_lost) {
        setStudent(null);
        setLostCardStudent(r.student);
        return;
      }
      setStudent(r.student);
      const t = toast({ title: "Öğrenci tanındı", description: `${r.student.full_name} • Bakiye: ${fmt(Number(r.student.balance))} ₺` });
      setTimeout(() => t.dismiss(), 1000);
    } catch (e: any) {
      toast({ title: "Kart tanınmadı", description: `${e?.message ?? "Hata"} (UID: ${uid})`, variant: "destructive" });
    }
  };

  const handleMarkCardFound = async () => {
    if (!lostCardStudent) return;
    setMarkingFound(true);
    try {
      await callCashierApi("mark_card_found", { student_id: lostCardStudent.id });
      const restored: Student = { ...lostCardStudent, card_lost: false };
      setStudent(restored);
      setLostCardStudent(null);
      toast({
        title: "Kart bulundu olarak işaretlendi",
        description: `${restored.full_name} için satış yapılabilir.`,
      });
    } catch (e: any) {
      toast({ title: "İşlem başarısız", description: e?.message, variant: "destructive" });
    } finally {
      setMarkingFound(false);
    }
  };

  const handleSeizeCard = async () => {
    if (!lostCardStudent) return;
    setSeizing(true);
    try {
      await callCashierApi("seize_card", {
        student_id: lostCardStudent.id,
        ...(seizeNote.trim() ? { note: seizeNote.trim() } : {}),
      });
      toast({
        title: "Karta el konuldu",
        description: `${lostCardStudent.full_name} velisine bilgi gönderildi.`,
      });
      setLostCardStudent(null);
      setSeizeMode(false);
      setSeizeNote("");
    } catch (e: any) {
      toast({ title: "İşlem başarısız", description: e?.message, variant: "destructive" });
    } finally {
      setSeizing(false);
    }
  };

  const handleUsbScan = async (code: string) => {
    // 1) Try to match a product barcode locally first (fast path)
    const local = products.find((p) => (p.barcode ?? "").toUpperCase() === code);
    if (local) {
      if (local.stock_tracking && local.stock_qty <= 0) {
        toast({ title: "Stok yok", description: local.name, variant: "destructive" });
        return;
      }
      addToCart(local);
      toast({ title: "Sepete eklendi", description: local.name });
      return;
    }
    // 2) Try server-side product barcode lookup (in case product list is stale)
    try {
      const prod = await callCashierApi<Product>("find_product_by_barcode", { barcode: code });
      if (prod.stock_tracking && prod.stock_qty <= 0) {
        toast({ title: "Stok yok", description: prod.name, variant: "destructive" });
        return;
      }
      addToCart(prod);
      toast({ title: "Sepete eklendi", description: prod.name });
      return;
    } catch (e: any) {
      // Not a known product barcode → treat as student card UID
      if (e?.status && e.status !== 404) {
        toast({ title: "Hata", description: e?.message, variant: "destructive" });
        return;
      }
    }
    // 3) Fallback: student card lookup
    await handleNfcResult(code);
  };

  const reader = useUsbCardReader({ enabled: !!session, onScan: handleUsbScan });

  const doSearch = async () => {
    if (searchTerm.trim().length < 2) return;
    try {
      const r = await callCashierApi<{ matches: Student[] }>("lookup_student", { query: searchTerm.trim() });
      setSearchResults(r.matches);
    } catch (e: any) {
      toast({ title: "Arama hatası", description: e?.message, variant: "destructive" });
    }
  };

  const completeSale = async () => {
    if (!student || cart.length === 0) return;
    setSubmitting(true);
    try {
      const r = await callCashierApi<{
        balance_after: number; total_amount: number; stock_warnings?: string[];
      }>("create_sale", {
        student_id: student.id,
        items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty })),
      });
      toast({
        title: "✓ Satış tamamlandı",
        description: `${fmt(Number(r.total_amount))} ₺ düşüldü. Kalan: ${fmt(Number(r.balance_after))} ₺`,
      });
      if (r.stock_warnings && r.stock_warnings.length > 0) {
        toast({
          title: "⚠️ Malzeme stoğu uyarısı",
          description: r.stock_warnings.join(" • "),
          variant: "destructive",
        });
      }
      setCart([]);
      setStudent(null);
      try {
        const prods = await callCashierApi<Product[]>("list_products");
        setProducts(prods);
      } catch { /* ignore */ }
    } catch (e: any) {
      setSaleError(e?.message ?? "Satış tamamlanamadı.");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    try { await callCashierApi("logout"); } catch { /* ignore */ }
    clearCashierSession();
    navigate("/kasiyer-giris", { replace: true });
  };

  if (!session) return null;

  const studentBalance = student ? Number(student.balance) : 0;
  const insufficient = student && cartTotal > studentBalance;
  const balanceAfter = studentBalance - cartTotal;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-pos-canvas text-foreground">
      {/* ============== HEADER ============== */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-pos-panel px-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-white shadow-glow">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">{session.school.name}</h1>
            <p className="text-xs text-muted-foreground">
              {session.cashier.full_name} • {now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
              reader.status === "listening"
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            <CircleDot className={cn("h-3 w-3", reader.status === "listening" && "animate-pulse")} />
            {reader.status === "listening" ? "Kart & barkod okuyucu hazır" : "Okuyucu kapalı"}
          </div>
          <Button
            variant="outline"
            size="lg"
            className="h-11 rounded-xl border-border/60"
            onClick={() => { setRecentOpen(true); loadRecent(); }}
          >
            <Receipt className="mr-2 h-4 w-4" /> Son İşlemler
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 rounded-xl border-border/60"
            onClick={logout}
          >
            <LogOut className="mr-2 h-4 w-4" /> Çıkış
          </Button>
        </div>
      </header>

      {/* ============== BODY ============== */}
      <div className="flex flex-1 overflow-hidden">
        {/* CATEGORIES (dark rail) */}
        <aside className="flex w-[200px] shrink-0 flex-col bg-pos-sidebar text-pos-sidebar-foreground">
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-2 p-3">
              <CategoryButton
                active={activeCat === "all"}
                label="Tümü"
                count={products.length}
                color="hsl(var(--primary))"
                onClick={() => setActiveCat("all")}
              />
              {categories.map((c, i) => {
                const count = products.filter((p) => p.category_id === c.id).length;
                return (
                  <CategoryButton
                    key={c.id}
                    active={activeCat === c.id}
                    label={c.name}
                    count={count}
                    color={catColor(i)}
                    onClick={() => setActiveCat(c.id)}
                  />
                );
              })}
              {categories.length === 0 && !loading && (
                <p className="px-2 py-6 text-center text-xs text-pos-sidebar-foreground/60">
                  Henüz kategori yok.
                </p>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* PRODUCTS */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {/* Manual barcode input — fallback when USB reader is unavailable */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-pos-panel/60 px-5 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Barcode className="h-5 w-5" />
            </div>
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const code = manualBarcode.trim().toUpperCase();
                if (!/^[A-Z0-9]{4,32}$/.test(code)) {
                  toast({
                    title: "Geçersiz barkod",
                    description: "Barkod 4-32 karakter olmalı (harf/rakam).",
                    variant: "destructive",
                  });
                  return;
                }
                setManualBarcode("");
                handleUsbScan(code);
              }}
            >
              <Input
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                placeholder="Barkod numarasını elle girin (cihaz arızalıysa)"
                inputMode="numeric"
                maxLength={32}
                className="h-11 flex-1 rounded-xl"
              />
              <Button type="submit" className="h-11 rounded-xl px-5" disabled={!manualBarcode.trim()}>
                Ekle
              </Button>
            </form>
          </div>
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {loading && (
                <div className="col-span-full flex items-center justify-center p-12 text-muted-foreground">
                  Yükleniyor...
                </div>
              )}
              {!loading && visibleProducts.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center gap-2 p-16 text-muted-foreground">
                  <ShoppingCart className="h-10 w-10 opacity-40" />
                  <p>Bu kategoride ürün yok.</p>
                </div>
              )}
              {visibleProducts.map((p) => {
                const outOfStock = p.stock_tracking && p.stock_qty <= 0;
                const lowStock = p.stock_tracking && p.stock_qty > 0 && p.stock_qty <= 5;
                const color = (p.category_id && catColorMap.get(p.category_id)) || catColor(0);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => addToCart(p)}
                    className={cn(
                      "group relative flex aspect-[4/5] flex-col overflow-hidden rounded-2xl border-2 border-transparent bg-card p-0 text-left shadow-soft transition-all duration-200",
                      "hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-[0.98]",
                      "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-soft",
                    )}
                    style={{ borderColor: outOfStock ? undefined : `${color.replace("hsl(", "hsla(").replace(")", " / 0.15)")}` }}
                  >
                    {/* Image / color band hero */}
                    <div
                      className="relative flex h-2/5 items-center justify-center overflow-hidden"
                      style={{
                        background: `linear-gradient(135deg, ${color}, ${color.replace(/(\d+)%\)$/, (_, l) => `${Math.min(Number(l) + 12, 92)}%)`)})`,
                      }}
                    >
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={(e) => {
                            // Hide broken image so the colored fallback shows through
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <span className="text-3xl font-black leading-none text-white/95 drop-shadow-sm">
                          {p.name.charAt(0).toLocaleUpperCase("tr-TR")}
                        </span>
                      )}
                      {outOfStock && (
                        <span className="absolute inset-0 flex items-center justify-center bg-foreground/60 text-xs font-bold uppercase tracking-wider text-white">
                          Tükendi
                        </span>
                      )}
                      {lowStock && !outOfStock && (
                        <span className="absolute right-2 top-2 rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold text-warning-foreground shadow-sm">
                          Son {p.stock_qty}
                        </span>
                      )}
                    </div>
                    {/* Body */}
                    <div className="flex flex-1 flex-col justify-between p-3">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</p>
                      <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-xl font-black tracking-tight" style={{ color }}>
                          {fmt(Number(p.price))}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">₺</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </section>

        {/* CART + STUDENT panel */}
        <aside className="flex w-[400px] shrink-0 flex-col border-l border-border/60 bg-pos-panel">
          {/* Student section */}
          <div className="border-b border-border/60 p-4">
            {student ? (
              <div className="relative overflow-hidden rounded-2xl bg-gradient-balance p-5 text-white shadow-glow animate-pop-in">
                <button
                  onClick={clearStudent}
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30"
                  aria-label="Öğrenciyi kaldır"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <GraduationCap className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold leading-tight">{student.full_name}</p>
                    <p className="truncate text-xs text-white/80">
                      {student.class_name ?? "—"}{student.student_no ? ` • #${student.student_no}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-white/70">Mevcut Bakiye</p>
                    <p className="text-3xl font-black leading-none">{fmt(studentBalance)} ₺</p>
                  </div>
                  {cartTotal > 0 && (
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wider text-white/70">Sonra</p>
                      <p className={cn("text-lg font-bold leading-none", insufficient && "text-destructive-foreground")}>
                        {fmt(balanceAfter)} ₺
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Big card-reader waiting indicator */}
                <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-primary/30 bg-accent/40 p-6 text-center">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary-glow/5" />
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-primary text-white shadow-glow animate-pulse-soft">
                    <CreditCard className="h-10 w-10" />
                  </div>
                  <p className="relative mt-4 text-base font-bold">Kart veya Barkod Okutun</p>
                  <p className="relative mt-1 text-xs text-muted-foreground">
                    Öğrenci kartı için kartı, ürün eklemek için barkodu okuyucuya tutun
                  </p>
                </div>

                {/* Fallback options */}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-12 rounded-xl" onClick={() => setQrOpen(true)}>
                    <QrCode className="mr-2 h-4 w-4" /> QR
                  </Button>
                  <Button variant="outline" className="h-12 rounded-xl" onClick={() => setSearchOpen((v) => !v)}>
                    <Search className="mr-2 h-4 w-4" /> Ara
                  </Button>
                </div>
                {searchOpen && (
                  <div className="space-y-2 pt-1 animate-fade-in">
                    <div className="flex gap-2">
                      <Input
                        placeholder="İsim veya numara"
                        className="h-11 rounded-xl"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doSearch()}
                      />
                      <Button className="h-11 rounded-xl px-5" onClick={doSearch}>Bul</Button>
                    </div>
                    {searchResults.length > 0 && (
                      <ScrollArea className="max-h-48 rounded-xl border">
                        {searchResults.map((s) => (
                          <button
                            key={s.id}
                            className="flex w-full items-center justify-between border-b px-3 py-3 text-left transition hover:bg-accent"
                            onClick={() => {
                              setSearchOpen(false);
                              setSearchTerm("");
                              setSearchResults([]);
                              if (s.card_lost) {
                                setStudent(null);
                                setLostCardStudent(s);
                              } else {
                                setStudent(s);
                              }
                            }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{s.full_name}</p>
                              <p className="text-xs text-muted-foreground">{s.class_name ?? "-"}</p>
                            </div>
                            <span className="text-sm font-bold text-primary">{fmt(Number(s.balance))} ₺</span>
                          </button>
                        ))}
                      </ScrollArea>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart header */}
          <div className="flex items-center justify-between px-4 pt-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Sepet
              </h2>
              {cartCount > 0 && (
                <Badge className="h-5 rounded-full bg-primary px-2 text-[11px]">{cartCount}</Badge>
              )}
            </div>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg text-muted-foreground hover:text-destructive"
                onClick={clearCart}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Temizle
              </Button>
            )}
          </div>

          {/* Cart items */}
          <ScrollArea className="flex-1 px-3">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <ShoppingCart className="h-7 w-7 text-muted-foreground/60" />
                </div>
                <p className="text-sm text-muted-foreground">Sepet boş</p>
                <p className="text-xs text-muted-foreground/70">Eklemek için ürüne dokunun</p>
              </div>
            ) : (
              <div className="space-y-2 py-3">
                {cart.map((item) => (
                  <div
                    key={item.product_id}
                    className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5 shadow-sm transition animate-fade-in"
                  >
                    <div
                      className="h-10 w-1.5 shrink-0 rounded-full"
                      style={{ background: item.catColor }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{fmt(item.price)} ₺</p>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-full bg-muted p-1">
                      <button
                        onClick={() => updateQty(item.product_id, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-background text-foreground shadow-sm transition active:scale-90"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{item.qty}</span>
                      <button
                        onClick={() => updateQty(item.product_id, +1)}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-background text-foreground shadow-sm transition active:scale-90"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-black">
                      {fmt(item.price * item.qty)}
                      <span className="text-xs font-normal text-muted-foreground"> ₺</span>
                    </span>
                    <button
                      onClick={() => removeFromCart(item.product_id)}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Kaldır"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Footer / Total / CTA */}
          <div className="space-y-3 border-t border-border/60 bg-muted/30 p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Toplam
                </p>
                <p className="text-3xl font-black leading-none tracking-tight">
                  {fmt(cartTotal)} <span className="text-xl text-muted-foreground">₺</span>
                </p>
              </div>
              {cartCount > 0 && (
                <div className="text-right text-xs text-muted-foreground">
                  {cartCount} ürün
                </div>
              )}
            </div>
            {insufficient && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive animate-fade-in">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="font-medium">
                  Yetersiz bakiye — Eksik: <strong>{fmt(cartTotal - studentBalance)} ₺</strong>
                </span>
              </div>
            )}
            <Button
              size="lg"
              className={cn(
                "h-16 w-full rounded-2xl text-base font-bold shadow-elevated transition-all",
                !insufficient && student && cart.length > 0 && "bg-gradient-success hover:opacity-95 hover:shadow-glow",
              )}
              disabled={!student || cart.length === 0 || submitting || !!insufficient}
              onClick={completeSale}
            >
              {submitting ? (
                "İşleniyor..."
              ) : !student ? (
                <><CreditCard className="mr-2 h-5 w-5" /> Önce kart okutun</>
              ) : cart.length === 0 ? (
                <><ShoppingCart className="mr-2 h-5 w-5" /> Sepet boş</>
              ) : insufficient ? (
                <><AlertTriangle className="mr-2 h-5 w-5" /> Yetersiz bakiye</>
              ) : (
                <><Wallet className="mr-2 h-5 w-5" /> Ödemeyi Al • {fmt(cartTotal)} ₺</>
              )}
            </Button>
          </div>
        </aside>
      </div>

      <QrScannerDialog open={qrOpen} onClose={() => setQrOpen(false)} onResult={handleQrResult} />

      <Dialog open={!!saleError} onOpenChange={(o) => !o && setSaleError(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-9 w-9 text-destructive" />
            </div>
            <DialogTitle className="text-2xl text-destructive">Satış başarısız</DialogTitle>
            <DialogDescription className="text-center text-base text-foreground">
              {saleError}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              size="lg"
              variant="destructive"
              className="min-w-32"
              onClick={() => setSaleError(null)}
              autoFocus
            >
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lost card warning + "Card Found" override */}
      <Dialog
        open={!!lostCardStudent}
        onOpenChange={(o) => {
          if (!o) {
            setLostCardStudent(null);
            setSeizeMode(false);
            setSeizeNote("");
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader className="items-center text-center">
            <div className="relative mx-auto mb-2">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-destructive/40 bg-muted shadow-lg">
                {lostCardStudent?.photo_url ? (
                  <img
                    src={lostCardStudent.photo_url}
                    alt={lostCardStudent.full_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <GraduationCap className="h-14 w-14 text-muted-foreground" />
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border-4 border-background bg-destructive text-destructive-foreground shadow-md">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
            <DialogTitle className="text-2xl text-destructive">
              {seizeMode ? "Karta el koy" : "Kart kayıp olarak işaretli"}
            </DialogTitle>
            <DialogDescription className="text-center text-base text-foreground">
              <span className="block text-lg font-bold">{lostCardStudent?.full_name}</span>
              <span className="block text-sm text-muted-foreground">
                {[lostCardStudent?.class_name, lostCardStudent?.student_no].filter(Boolean).join(" • ")}
              </span>
              {seizeMode ? (
                <span className="mt-3 block rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  Kartı kantinde tutuyorsanız bu işlemi yapın. Karta bağlı NFC kaldırılacak,
                  kart kayıp olarak işaretli kalacak ve <strong>veliye SMS + bildirim</strong> gönderilecektir.
                </span>
              ) : (
                <span className="mt-3 block rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  Kartı getiren kişinin <strong>yukarıdaki fotoğraftaki öğrenci</strong> olduğundan emin olun.
                  Veli bu kartı kayıp olarak bildirmiş; bu karta satış yapılamaz.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {seizeMode && (
            <div className="space-y-2 px-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="seize-note">
                Veliye iletilecek not (opsiyonel)
              </label>
              <Textarea
                id="seize-note"
                value={seizeNote}
                onChange={(e) => setSeizeNote(e.target.value.slice(0, 300))}
                placeholder="Örn. Kartı 7-A öğrencisi kullanmaya çalıştı, kantinde bekliyor."
                rows={3}
                disabled={seizing}
              />
              <p className="text-right text-[10px] text-muted-foreground">{seizeNote.length}/300</p>
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            {seizeMode ? (
              <>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => { setSeizeMode(false); setSeizeNote(""); }}
                  disabled={seizing}
                >
                  Geri
                </Button>
                <Button
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={handleSeizeCard}
                  disabled={seizing}
                >
                  {seizing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gönderiliyor…</>
                  ) : (
                    <><ShieldOff className="mr-2 h-4 w-4" /> Onayla — Karta El Koy</>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setLostCardStudent(null)}
                  disabled={markingFound}
                >
                  Vazgeç
                </Button>
                <Button
                  variant="destructive"
                  className="w-full sm:w-auto"
                  onClick={() => setSeizeMode(true)}
                  disabled={markingFound}
                >
                  <ShieldOff className="mr-2 h-4 w-4" />
                  Karta El Koy
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  onClick={handleMarkCardFound}
                  disabled={markingFound}
                >
                  {markingFound ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> İşleniyor…</>
                  ) : (
                    <>Kart Bulundu — Aktif Et</>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/* ---------- Sub-components ---------- */

interface CategoryButtonProps {
  active: boolean;
  label: string;
  count: number;
  color: string;
  onClick: () => void;
}
function CategoryButton({ active, label, count, color, onClick }: CategoryButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex h-16 items-center gap-3 overflow-hidden rounded-xl px-3 text-left transition-all",
        active
          ? "bg-white/10 text-white shadow-inner"
          : "text-pos-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
      )}
    >
      <span
        className={cn(
          "h-10 w-1.5 shrink-0 rounded-full transition-all",
          active ? "scale-y-100" : "scale-y-50 opacity-60",
        )}
        style={{ background: color }}
      />
      <span className="flex-1 truncate text-sm font-semibold">{label}</span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-bold transition",
          active ? "bg-white/20 text-white" : "bg-white/5 text-pos-sidebar-foreground/60",
        )}
      >
        {count}
      </span>
    </button>
  );
}
