import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUsbCardReader } from "@/hooks/useUsbCardReader";
import { Loader2, Plus, Pencil, Trash2, ScanLine, Search, Package, Sparkles, X, ImageOff } from "lucide-react";

interface Category { id: string; name: string; color: string | null; sort_order: number; is_active: boolean; product_count?: number }
interface Product {
  id: string;
  category_id: string | null;
  name: string;
  price: number | string;
  image_url: string | null;
  barcode: string | null;
  stock_tracking: boolean;
  stock_qty: number;
  is_active: boolean;
  sort_order: number;
}
interface BarcodeHint {
  barcode: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  category_hint: string | null;
  source: "open_food_facts" | "upcitemdb" | "manual";
}

async function callOp<T = unknown>(op: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  }
  return (data as { data: T }).data;
}

async function lookupBarcode(barcode: string): Promise<BarcodeHint> {
  const { data, error } = await supabase.functions.invoke("barcode-lookup", {
    body: { op: "lookup", params: { barcode } },
  });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  }
  return (data as { data: BarcodeHint }).data;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProductsManager() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");

  const [scanOpen, setScanOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [cats, prods] = await Promise.all([
        callOp<Category[]>("list_categories_admin"),
        callOp<Product[]>("list_products_admin"),
      ]);
      setCategories(cats);
      setProducts(prods);
    } catch (e: any) {
      toast({ title: "Yükleme hatası", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filterCat !== "all" && p.category_id !== filterCat) return false;
      if (!s) return true;
      return p.name.toLowerCase().includes(s) || (p.barcode ?? "").includes(s);
    });
  }, [products, search, filterCat]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" /> Ürünler
          </CardTitle>
          <CardDescription>
            Barkod okutarak hızlı ekleyin — sistem ürün adını ve fotoğrafını otomatik dolduracak.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setEditing(null); setEditorOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Manuel Ekle
          </Button>
          <Button onClick={() => setScanOpen(true)} className="bg-gradient-primary">
            <ScanLine className="mr-2 h-4 w-4" /> Barkod ile Ekle
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="İsim veya barkodla ara"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Kategori filtre" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Kategoriler</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]"></TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-right">Fiyat</TableHead>
                <TableHead>Barkod</TableHead>
                <TableHead>Stok</TableHead>
                <TableHead className="w-[120px] text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  Ürün yok. Yukarıdan ekleyin.
                </TableCell></TableRow>
              ) : filtered.map((p) => (
                <TableRow key={p.id} className={!p.is_active ? "opacity-50" : ""}>
                  <TableCell>
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="h-10 w-10 rounded-md object-cover bg-muted" loading="lazy" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                        <ImageOff className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{catName(p.category_id)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(Number(p.price))} ₺</TableCell>
                  <TableCell className="font-mono text-xs">{p.barcode ?? "—"}</TableCell>
                  <TableCell>
                    {p.stock_tracking ? (
                      <Badge variant={p.stock_qty > 0 ? "secondary" : "destructive"}>{p.stock_qty}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sınırsız</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setEditorOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={async () => {
                        if (!confirm(`"${p.name}" silinsin mi?`)) return;
                        try {
                          await callOp("delete_product", { id: p.id });
                          toast({ title: "Silindi" });
                          reload();
                        } catch (e: any) {
                          toast({ title: "Silinemedi", description: e?.message, variant: "destructive" });
                        }
                      }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Barcode scan dialog */}
      <BarcodeAddDialog
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        categories={categories}
        onSaved={reload}
      />

      {/* Manual editor dialog */}
      <ProductEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        categories={categories}
        product={editing}
        onSaved={reload}
      />
    </Card>
  );
}

/* ============= Barcode Scan Dialog ============= */

interface BarcodeAddProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  onSaved: () => void;
}

function BarcodeAddDialog({ open, onClose, categories, onSaved }: BarcodeAddProps) {
  const { toast } = useToast();
  const [barcode, setBarcode] = useState("");
  const [hint, setHint] = useState<BarcodeHint | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  // Form fields (start empty, prefilled by lookup)
  const [name, setName] = useState("");
  const [price, setPrice] = useState<string>("");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState<string>("none");
  const [stockTracking, setStockTracking] = useState(false);
  const [stockQty, setStockQty] = useState<string>("0");

  const reset = () => {
    setBarcode(""); setHint(null); setName(""); setPrice(""); setImageUrl("");
    setCategoryId("none"); setStockTracking(false); setStockQty("0"); setDuplicate(null);
  };

  // Listen for USB barcode reader (acts as keyboard, ends with Enter)
  // Reuses the same hook the cashier uses. Numeric barcodes are always >= 4 chars.
  const onScan = async (code: string) => {
    if (!open || looking || saving) return;
    // Strip non-digits — barcode readers sometimes send a leading char
    const digits = code.replace(/\D+/g, "");
    if (digits.length < 4) return;
    await runLookup(digits);
  };
  useUsbCardReader({ enabled: open, onScan, minLength: 4 });

  const runLookup = async (code: string) => {
    setBarcode(code);
    setLooking(true);
    setDuplicate(null);
    try {
      // First check if we already have this barcode in our DB
      const exist = await callOp<{ product: Product | null }>("find_product_by_barcode", { barcode: code });
      if (exist?.product) {
        setDuplicate({ id: exist.product.id, name: exist.product.name });
        // Still prefill so the user knows what it was, but block save
        setName(exist.product.name);
        setPrice(String(exist.product.price));
        setImageUrl(exist.product.image_url ?? "");
        setCategoryId(exist.product.category_id ?? "none");
        setHint({
          barcode: code,
          name: exist.product.name,
          brand: null,
          image_url: exist.product.image_url,
          category_hint: null,
          source: "manual",
        });
        return;
      }
      // External lookup
      const h = await lookupBarcode(code);
      setHint(h);
      if (h.name) setName(h.name);
      if (h.image_url) setImageUrl(h.image_url);
      // Try to auto-match a category by name keyword
      if (h.category_hint) {
        const lower = h.category_hint.toLowerCase();
        const matched = categories.find((c) => lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lower.split(" ").pop() ?? ""));
        if (matched) setCategoryId(matched.id);
      }
    } catch (e: any) {
      toast({ title: "Sorgu başarısız", description: e?.message, variant: "destructive" });
      setHint({ barcode: code, name: null, brand: null, image_url: null, category_hint: null, source: "manual" });
    } finally {
      setLooking(false);
    }
  };

  const handleManualLookup = () => {
    const digits = barcode.replace(/\D+/g, "");
    if (digits.length < 4) {
      toast({ title: "Geçersiz barkod", description: "En az 4 haneli sayı girin." });
      return;
    }
    runLookup(digits);
  };

  const save = async () => {
    if (!name.trim()) {
      toast({ title: "İsim gerekli", variant: "destructive" });
      return;
    }
    const priceNum = parseFloat(price.replace(",", "."));
    if (isNaN(priceNum) || priceNum < 0) {
      toast({ title: "Geçerli bir fiyat girin", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await callOp("create_product", {
        name: name.trim(),
        price: priceNum,
        barcode: barcode || null,
        image_url: imageUrl.trim() || null,
        category_id: categoryId === "none" ? null : categoryId,
        stock_tracking: stockTracking,
        stock_qty: stockTracking ? Math.max(0, parseInt(stockQty || "0", 10) || 0) : 0,
      });
      toast({ title: "Ürün eklendi", description: name });
      onSaved();
      reset();
      // Don't close — let cashier scan another one immediately
    } catch (e: any) {
      toast({ title: "Eklenemedi", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> Barkod ile Ürün Ekle
          </DialogTitle>
          <DialogDescription>
            USB barkod okuyucuya ürünü okutun veya barkodu manuel girin. Sistem ürün bilgilerini Open Food Facts ve UPCitemdb'den otomatik çekecek.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Scan/enter barcode */}
        {!hint ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/30 bg-accent/30 p-8 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-primary text-white shadow-glow animate-pulse-soft">
                <ScanLine className="h-10 w-10" />
              </div>
              <p className="mt-4 text-base font-bold">Barkodu Okutun</p>
              <p className="mt-1 text-xs text-muted-foreground">
                USB okuyucu hazır — ürünü taratmanız yeterli
              </p>
            </div>
            <div className="space-y-2">
              <Label>veya barkodu manuel girin</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Örn: 8690504003456"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleManualLookup(); } }}
                  inputMode="numeric"
                  className="font-mono"
                />
                <Button onClick={handleManualLookup} disabled={looking}>
                  {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sorgula"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Step 2: Confirm + complete */
          <div className="space-y-4">
            {/* Hint banner */}
            <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3">
              {imageUrl ? (
                <img src={imageUrl} alt={name} className="h-20 w-20 shrink-0 rounded-lg bg-white object-contain" />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-background">
                  <ImageOff className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{barcode}</span>
                  <SourceBadge source={hint.source} />
                </div>
                {hint.brand && <p className="text-xs text-muted-foreground">{hint.brand}</p>}
                {hint.category_hint && (
                  <p className="mt-0.5 text-xs text-muted-foreground">İpucu: {hint.category_hint}</p>
                )}
                {duplicate && (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    ⚠ Bu barkod zaten "{duplicate.name}" için kayıtlı.
                  </p>
                )}
              </div>
              <Button variant="ghost" size="icon" onClick={reset} title="Yeni barkod tara">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Form */}
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Ürün Adı *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Cola 330ml" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Fiyat (₺) *</Label>
                  <Input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="15.00"
                    inputMode="decimal"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Kategori</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Yok —</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Görsel URL</Label>
                <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="font-semibold">Stok Takibi</Label>
                  <p className="text-xs text-muted-foreground">Açıksa, satışta stok düşer ve tükendiğinde uyarır.</p>
                </div>
                <Switch checked={stockTracking} onCheckedChange={setStockTracking} />
              </div>
              {stockTracking && (
                <div className="grid gap-2">
                  <Label>Başlangıç Stok Adedi</Label>
                  <Input value={stockQty} onChange={(e) => setStockQty(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Kapat</Button>
          {hint && (
            <Button onClick={save} disabled={saving || !!duplicate}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {duplicate ? "Bu barkod zaten kayıtlı" : "Kaydet ve Devam Et"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceBadge({ source }: { source: BarcodeHint["source"] }) {
  if (source === "open_food_facts") return <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> Open Food Facts</Badge>;
  if (source === "upcitemdb") return <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> UPCitemdb</Badge>;
  return <Badge variant="outline">Bulunamadı — manuel girin</Badge>;
}

/* ============= Manual editor dialog ============= */

interface EditorProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  product: Product | null;
  onSaved: () => void;
}

function ProductEditorDialog({ open, onClose, categories, product, onSaved }: EditorProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [barcode, setBarcode] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("none");
  const [stockTracking, setStockTracking] = useState(false);
  const [stockQty, setStockQty] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (product) {
      setName(product.name);
      setPrice(String(product.price));
      setBarcode(product.barcode ?? "");
      setImageUrl(product.image_url ?? "");
      setCategoryId(product.category_id ?? "none");
      setStockTracking(product.stock_tracking);
      setStockQty(String(product.stock_qty));
    } else {
      setName(""); setPrice(""); setBarcode(""); setImageUrl("");
      setCategoryId("none"); setStockTracking(false); setStockQty("0");
    }
  }, [open, product]);

  const save = async () => {
    if (!name.trim()) { toast({ title: "İsim gerekli", variant: "destructive" }); return; }
    const priceNum = parseFloat(price.replace(",", "."));
    if (isNaN(priceNum) || priceNum < 0) { toast({ title: "Geçerli fiyat girin", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        price: priceNum,
        barcode: barcode.trim() || null,
        image_url: imageUrl.trim() || null,
        category_id: categoryId === "none" ? null : categoryId,
        stock_tracking: stockTracking,
        stock_qty: stockTracking ? Math.max(0, parseInt(stockQty || "0", 10) || 0) : 0,
      };
      if (product) {
        await callOp("update_product", { ...payload, id: product.id });
        toast({ title: "Ürün güncellendi" });
      } else {
        await callOp("create_product", payload);
        toast({ title: "Ürün eklendi" });
      }
      onSaved(); onClose();
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product ? "Ürünü Düzenle" : "Manuel Ürün Ekle"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label>İsim *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Fiyat (₺) *</Label>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
            </div>
            <div className="grid gap-2">
              <Label>Kategori</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Yok —</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Barkod</Label>
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="font-mono" />
          </div>
          <div className="grid gap-2">
            <Label>Görsel URL</Label>
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="font-semibold">Stok Takibi</Label>
              <p className="text-xs text-muted-foreground">Satışta stok düşer.</p>
            </div>
            <Switch checked={stockTracking} onCheckedChange={setStockTracking} />
          </div>
          {stockTracking && (
            <div className="grid gap-2">
              <Label>Stok Adedi</Label>
              <Input value={stockQty} onChange={(e) => setStockQty(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
