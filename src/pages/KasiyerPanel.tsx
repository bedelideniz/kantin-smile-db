import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { LogOut, QrCode, Radio, Search, Trash2, X, Plus, Minus, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  callCashierApi,
  clearCashierSession,
  getCashierSession,
} from "@/lib/cashierApi";
import { QrScannerDialog } from "@/components/kasiyer/QrScannerDialog";
import { useNfcReader } from "@/hooks/useNfcReader";

interface Category { id: string; name: string; color: string | null; sort_order: number }
interface Product {
  id: string; category_id: string | null; name: string;
  price: number | string; image_url: string | null;
  stock_tracking: boolean; stock_qty: number;
}
interface Student {
  id: string; full_name: string; class_name: string | null;
  student_no: string | null; balance: number | string;
}
interface CartItem { product_id: string; name: string; price: number; qty: number }

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  // Auth gate
  useEffect(() => {
    if (!session) navigate("/kasiyer-giris", { replace: true });
  }, [session, navigate]);

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

  const visibleProducts = useMemo(() => {
    if (activeCat === "all") return products;
    return products.filter((p) => p.category_id === activeCat);
  }, [products, activeCat]);

  const cartTotal = useMemo(
    () => cart.reduce((s, i) => s + i.price * i.qty, 0),
    [cart],
  );

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product_id === p.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...prev, { product_id: p.id, name: p.name, price: Number(p.price), qty: 1 }];
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
      setStudent(r.student);
      toast({ title: "Öğrenci bulundu", description: r.student.full_name });
    } catch (e: any) {
      toast({ title: "Bulunamadı", description: e?.message, variant: "destructive" });
    }
  };

  const handleNfcResult = async (uid: string) => {
    try {
      const r = await callCashierApi<{ student: Student }>("lookup_student", { nfc_uid: uid });
      setStudent(r.student);
      toast({ title: "Öğrenci tanındı", description: `${r.student.full_name} • Bakiye: ${fmt(Number(r.student.balance))} ₺` });
    } catch (e: any) {
      toast({ title: "Kart tanınmadı", description: `${e?.message ?? "Hata"} (UID: ${uid})`, variant: "destructive" });
    }
  };

  // Continuously listen for NFC card taps in the background.
  // Tapping a new card replaces the currently selected student.
  const nfc = useNfcReader({ enabled: !!session, onScan: handleNfcResult });

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
        balance_after: number; total_amount: number;
      }>("create_sale", {
        student_id: student.id,
        items: cart.map((c) => ({ product_id: c.product_id, qty: c.qty })),
      });
      toast({
        title: "Satış tamamlandı",
        description: `${fmt(Number(r.total_amount))} TL düşüldü. Kalan bakiye: ${fmt(Number(r.balance_after))} TL`,
      });
      setCart([]);
      setStudent(null);
      // Refresh products in case stock changed
      try {
        const prods = await callCashierApi<Product[]>("list_products");
        setProducts(prods);
      } catch { /* ignore */ }
    } catch (e: any) {
      toast({ title: "Satış başarısız", description: e?.message, variant: "destructive" });
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

  return (
    <main className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{session.school.name}</h1>
          <p className="text-xs text-muted-foreground">Kasiyer: {session.cashier.full_name}</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" /> Çıkış
        </Button>
      </header>

      <div className="grid flex-1 grid-cols-12 gap-0 overflow-hidden">
        {/* Categories - left */}
        <aside className="col-span-2 border-r bg-muted/30">
          <ScrollArea className="h-full">
            <div className="space-y-1 p-2">
              <Button
                variant={activeCat === "all" ? "default" : "ghost"}
                className="h-14 w-full justify-start text-sm"
                onClick={() => setActiveCat("all")}
              >
                Tümü
                <Badge variant="secondary" className="ml-auto">{products.length}</Badge>
              </Button>
              {categories.map((c) => {
                const count = products.filter((p) => p.category_id === c.id).length;
                return (
                  <Button
                    key={c.id}
                    variant={activeCat === c.id ? "default" : "ghost"}
                    className="h-14 w-full justify-start text-sm"
                    onClick={() => setActiveCat(c.id)}
                  >
                    <span className="truncate">{c.name}</span>
                    <Badge variant="secondary" className="ml-auto">{count}</Badge>
                  </Button>
                );
              })}
              {categories.length === 0 && !loading && (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  Henüz kategori yok. Yönetici panelinden ekleyin.
                </p>
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Products - middle */}
        <section className="col-span-6 border-r">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4">
              {loading && <p className="col-span-full p-8 text-center text-muted-foreground">Yükleniyor...</p>}
              {!loading && visibleProducts.length === 0 && (
                <p className="col-span-full p-8 text-center text-muted-foreground">
                  Bu kategoride ürün yok.
                </p>
              )}
              {visibleProducts.map((p) => {
                const outOfStock = p.stock_tracking && p.stock_qty <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={outOfStock}
                    onClick={() => addToCart(p)}
                    className="group relative flex aspect-square flex-col items-center justify-center rounded-lg border bg-card p-3 text-center shadow-sm transition hover:border-primary hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                    <span className="mt-2 text-lg font-bold text-primary">{fmt(Number(p.price))} ₺</span>
                    {p.stock_tracking && (
                      <Badge variant={outOfStock ? "destructive" : "secondary"} className="absolute right-1 top-1 text-[10px]">
                        {outOfStock ? "Tükendi" : `Stok: ${p.stock_qty}`}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </section>

        {/* Cart + student - right */}
        <aside className="col-span-4 flex flex-col bg-card">
          {/* Student section */}
          <div className="border-b p-3">
            {student ? (
              <Card>
                <CardContent className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{student.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {student.class_name ?? "-"}{student.student_no ? ` • #${student.student_no}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      Bakiye: <span className="font-bold text-primary">{fmt(studentBalance)} ₺</span>
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={clearStudent}>
                    <X className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Öğrenci tanıma</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" onClick={() => setQrOpen(true)}>
                    <QrCode className="mr-1 h-4 w-4" /> QR
                  </Button>
                  <Button variant="outline" onClick={() => setNfcOpen(true)}>
                    <Radio className="mr-1 h-4 w-4" /> NFC
                  </Button>
                  <Button variant="outline" onClick={() => setSearchOpen((v) => !v)}>
                    <Search className="mr-1 h-4 w-4" /> Ara
                  </Button>
                </div>
                {searchOpen && (
                  <div className="space-y-2 pt-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="İsim veya numara"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doSearch()}
                      />
                      <Button onClick={doSearch}>Bul</Button>
                    </div>
                    {searchResults.length > 0 && (
                      <ScrollArea className="max-h-48 rounded-md border">
                        {searchResults.map((s) => (
                          <button
                            key={s.id}
                            className="flex w-full items-center justify-between border-b px-3 py-2 text-left hover:bg-muted"
                            onClick={() => {
                              setStudent(s);
                              setSearchOpen(false);
                              setSearchTerm("");
                              setSearchResults([]);
                            }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{s.full_name}</p>
                              <p className="text-xs text-muted-foreground">{s.class_name ?? "-"}</p>
                            </div>
                            <span className="text-sm font-semibold">{fmt(Number(s.balance))} ₺</span>
                          </button>
                        ))}
                      </ScrollArea>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-sm font-semibold">Sepet ({cart.length})</h2>
              {cart.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearCart}>
                  <Trash2 className="mr-1 h-3 w-3" /> Temizle
                </Button>
              )}
            </div>
            <ScrollArea className="flex-1">
              {cart.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Sepet boş</p>
              ) : (
                <div className="divide-y">
                  {cart.map((item) => (
                    <div key={item.product_id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{fmt(item.price)} ₺ × {item.qty}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(item.product_id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold">{item.qty}</span>
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(item.product_id, +1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <span className="ml-2 w-16 text-right text-sm font-bold">{fmt(item.price * item.qty)} ₺</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeFromCart(item.product_id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <Separator />
            <div className="space-y-3 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Toplam</span>
                <span className="text-2xl font-bold">{fmt(cartTotal)} ₺</span>
              </div>
              {insufficient && (
                <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  Yetersiz bakiye. Eksik: {fmt(cartTotal - studentBalance)} ₺
                </p>
              )}
              <Button
                size="lg"
                className="h-14 w-full text-base"
                disabled={!student || cart.length === 0 || submitting || !!insufficient}
                onClick={completeSale}
              >
                {submitting ? "İşleniyor..."
                  : !student ? "Önce öğrenci seçin"
                  : cart.length === 0 ? "Sepet boş"
                  : `Bakiyeden Düş (${fmt(cartTotal)} ₺)`}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      <QrScannerDialog open={qrOpen} onClose={() => setQrOpen(false)} onResult={handleQrResult} />
      <NfcReaderDialog open={nfcOpen} onClose={() => setNfcOpen(false)} onResult={handleNfcResult} />
    </main>
  );
}
