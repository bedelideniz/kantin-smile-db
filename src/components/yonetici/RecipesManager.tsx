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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Pencil, Trash2, ChefHat, Package, AlertTriangle, X, Minus, Boxes,
} from "lucide-react";

type Unit = "adet" | "gr" | "kg" | "ml" | "lt";
const UNITS: Unit[] = ["adet", "gr", "kg", "ml", "lt"];

interface Ingredient {
  id: string;
  name: string;
  unit: Unit;
  stock_qty: number | string;
  low_stock_threshold: number | string | null;
  is_active: boolean;
  used_in_count?: number;
}
interface ProductRow {
  id: string;
  name: string;
  image_url: string | null;
  is_active: boolean;
  recipe_line_count: number;
}
interface RecipeLine {
  id?: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: Unit;
  qty: number | string;
  stock_qty?: number | string;
}

async function callOp<T = unknown>(op: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  }
  return (data as { data: T }).data;
}

const fmtQty = (n: number | string, unit: string) => {
  const v = Number(n);
  return `${v.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} ${unit}`;
};

export default function RecipesManager() {
  return (
    <Tabs defaultValue="recipes" className="space-y-4">
      <TabsList>
        <TabsTrigger value="recipes" className="gap-2">
          <ChefHat className="h-4 w-4" /> Ürün Reçeteleri
        </TabsTrigger>
        <TabsTrigger value="ingredients" className="gap-2">
          <Boxes className="h-4 w-4" /> Malzemeler
        </TabsTrigger>
      </TabsList>
      <TabsContent value="recipes">
        <RecipesPanel />
      </TabsContent>
      <TabsContent value="ingredients">
        <IngredientsPanel />
      </TabsContent>
    </Tabs>
  );
}

/* ============ INGREDIENTS PANEL ============ */

function IngredientsPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Ingredient[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [stockOpen, setStockOpen] = useState<Ingredient | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await callOp<Ingredient[]>("list_ingredients");
      setItems(r);
    } catch (e: any) {
      toast({ title: "Yükleme hatası", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" /> Malzemeler
          </CardTitle>
          <CardDescription>
            Reçetelerde kullanılan ham maddeler (ekmek, köfte, kaşar, vb.). Stok burada tutulur.
          </CardDescription>
        </div>
        <Button onClick={() => { setEditing(null); setEditorOpen(true); }} className="bg-gradient-primary">
          <Plus className="mr-2 h-4 w-4" /> Yeni Malzeme
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Malzeme</TableHead>
                <TableHead>Birim</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead className="text-right">Eşik</TableHead>
                <TableHead>Kullanım</TableHead>
                <TableHead className="w-[180px] text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Henüz malzeme yok.</TableCell></TableRow>
              ) : items.map((it) => {
                const stock = Number(it.stock_qty);
                const threshold = it.low_stock_threshold == null ? null : Number(it.low_stock_threshold);
                const low = stock <= 0 || (threshold != null && stock <= threshold);
                return (
                  <TableRow key={it.id} className={!it.is_active ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{it.unit}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={stock <= 0 ? "destructive" : low ? "secondary" : "outline"}>
                        {fmtQty(stock, it.unit)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {threshold == null ? "—" : fmtQty(threshold, it.unit)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {it.used_in_count ? `${it.used_in_count} reçetede` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setStockOpen(it)}>
                          <Plus className="h-3 w-3" /> Stok
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(it); setEditorOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={async () => {
                          if (!confirm(`"${it.name}" silinsin mi?`)) return;
                          try {
                            await callOp("delete_ingredient", { id: it.id });
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <IngredientEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        ingredient={editing}
        onSaved={reload}
      />
      <StockAdjustDialog
        ingredient={stockOpen}
        onClose={() => setStockOpen(null)}
        onSaved={reload}
      />
    </Card>
  );
}

function IngredientEditorDialog({
  open, onClose, ingredient, onSaved,
}: { open: boolean; onClose: () => void; ingredient: Ingredient | null; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("adet");
  const [stockQty, setStockQty] = useState<string>("0");
  const [threshold, setThreshold] = useState<string>("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(ingredient?.name ?? "");
      setUnit((ingredient?.unit as Unit) ?? "adet");
      setStockQty(ingredient ? String(ingredient.stock_qty) : "0");
      setThreshold(ingredient?.low_stock_threshold == null ? "" : String(ingredient.low_stock_threshold));
      setActive(ingredient?.is_active ?? true);
    }
  }, [open, ingredient]);

  const save = async () => {
    if (!name.trim()) { toast({ title: "İsim gerekli", variant: "destructive" }); return; }
    const thNum = threshold.trim() === "" ? null : parseFloat(threshold.replace(",", "."));
    if (thNum != null && (isNaN(thNum) || thNum < 0)) {
      toast({ title: "Geçersiz eşik", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      if (ingredient) {
        await callOp("update_ingredient", {
          id: ingredient.id, name: name.trim(), unit, low_stock_threshold: thNum, is_active: active,
        });
      } else {
        const stockNum = parseFloat(stockQty.replace(",", ".")) || 0;
        await callOp("create_ingredient", {
          name: name.trim(), unit, stock_qty: stockNum, low_stock_threshold: thNum,
        });
      }
      toast({ title: ingredient ? "Güncellendi" : "Eklendi" });
      onSaved(); onClose();
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ingredient ? "Malzemeyi Düzenle" : "Yeni Malzeme"}</DialogTitle>
          <DialogDescription>
            {ingredient ? "Stok değişikliği için 'Stok' butonunu kullanın." : "Başlangıç stoku ve birim girin."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>İsim</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Ekmek, Köfte, Kaşar..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Birim</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!ingredient && (
              <div>
                <Label>Başlangıç Stok</Label>
                <Input type="text" inputMode="decimal" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
              </div>
            )}
            <div>
              <Label>Düşük Stok Eşiği (ops.)</Label>
              <Input type="text" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Boş = uyarı yok" />
            </div>
          </div>
          {ingredient && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label>Aktif</Label>
                <p className="text-xs text-muted-foreground">Pasif malzemeler reçetelerden düşülmez.</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockAdjustDialog({
  ingredient, onClose, onSaved,
}: { ingredient: Ingredient | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (ingredient) { setDelta(""); setNote(""); setMode("add"); } }, [ingredient]);

  if (!ingredient) return null;

  const submit = async () => {
    const n = parseFloat(delta.replace(",", "."));
    if (isNaN(n) || n <= 0) { toast({ title: "Miktar gerekli", variant: "destructive" }); return; }
    const signed = mode === "add" ? n : -n;
    setSaving(true);
    try {
      await callOp("adjust_ingredient_stock", { id: ingredient.id, delta: signed, note: note.trim() || undefined });
      toast({ title: "Stok güncellendi" });
      onSaved(); onClose();
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!ingredient} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ingredient.name} — Stok Hareketi</DialogTitle>
          <DialogDescription>
            Mevcut stok: <strong>{fmtQty(Number(ingredient.stock_qty), ingredient.unit)}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={mode === "add" ? "default" : "outline"} onClick={() => setMode("add")}>
              <Plus className="mr-2 h-4 w-4" /> Ekle
            </Button>
            <Button variant={mode === "remove" ? "default" : "outline"} onClick={() => setMode("remove")}>
              <Minus className="mr-2 h-4 w-4" /> Çıkar
            </Button>
          </div>
          <div>
            <Label>Miktar ({ingredient.unit})</Label>
            <Input type="text" inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} autoFocus />
          </div>
          <div>
            <Label>Not (ops.)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn: Faturadan giriş" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={submit} disabled={saving} className="bg-gradient-primary">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============ RECIPES PANEL ============ */

function RecipesPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [editing, setEditing] = useState<ProductRow | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [prods, ings] = await Promise.all([
        callOp<ProductRow[]>("list_products_with_recipes"),
        callOp<Ingredient[]>("list_ingredients"),
      ]);
      setProducts(prods);
      setIngredients(ings);
    } catch (e: any) {
      toast({ title: "Yükleme hatası", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const withRecipes = products.filter((p) => p.recipe_line_count > 0);
  const withoutRecipes = products.filter((p) => p.recipe_line_count === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ChefHat className="h-5 w-5" /> Ürün Reçeteleri
        </CardTitle>
        <CardDescription>
          Reçeteli ürünler (tost, hamburger, vb.) satıldığında malzemeler otomatik stoktan düşer.
          Stok eksiye düşse bile satış engellenmez, sadece uyarı verilir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {ingredients.length === 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-dashed bg-muted/30 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Önce <strong>Malzemeler</strong> sekmesinden reçetede kullanacağınız ham maddeleri (ekmek, köfte, kaşar...) tanımlayın.
            </div>
          </div>
        )}

        <ProductSection
          title="Reçeteli Ürünler"
          empty="Henüz reçeteli ürün yok."
          loading={loading}
          rows={withRecipes}
          onEdit={setEditing}
        />
        <ProductSection
          title="Reçetesiz Ürünler"
          empty="Tüm ürünlerin reçetesi var."
          loading={loading}
          rows={withoutRecipes}
          onEdit={setEditing}
          subtle
        />
      </CardContent>

      <RecipeEditorDialog
        product={editing}
        ingredients={ingredients}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    </Card>
  );
}

function ProductSection({
  title, empty, rows, loading, onEdit, subtle,
}: {
  title: string; empty: string; rows: ProductRow[]; loading: boolean;
  onEdit: (p: ProductRow) => void; subtle?: boolean;
}) {
  return (
    <div>
      <h3 className={`mb-2 text-sm font-semibold ${subtle ? "text-muted-foreground" : ""}`}>{title}</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="col-span-full rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{empty}</div>
        ) : rows.map((p) => (
          <button
            key={p.id}
            onClick={() => onEdit(p)}
            className="group flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-primary hover:shadow-md"
          >
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} className="h-12 w-12 rounded-md object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                <Package className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.recipe_line_count > 0 ? `${p.recipe_line_count} malzeme` : "Reçete tanımlı değil"}
              </div>
            </div>
            <ChefHat className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
          </button>
        ))}
      </div>
    </div>
  );
}

function RecipeEditorDialog({
  product, ingredients, onClose, onSaved,
}: {
  product: ProductRow | null;
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickIng, setPickIng] = useState("");
  const [pickQty, setPickQty] = useState("1");

  useEffect(() => {
    if (!product) return;
    (async () => {
      setLoading(true);
      try {
        const r = await callOp<{ lines: RecipeLine[] }>("get_product_recipe", { product_id: product.id });
        setLines((r.lines ?? []).map((l) => ({ ...l, qty: Number(l.qty) })));
        setPickIng(""); setPickQty("1");
      } catch (e: any) {
        toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
      } finally { setLoading(false); }
    })();
  }, [product, toast]);

  const availableIngredients = useMemo(
    () => ingredients.filter((i) => i.is_active && !lines.some((l) => l.ingredient_id === i.id)),
    [ingredients, lines],
  );

  const addLine = () => {
    if (!pickIng) return;
    const n = parseFloat(pickQty.replace(",", "."));
    if (isNaN(n) || n <= 0) { toast({ title: "Geçerli bir miktar girin", variant: "destructive" }); return; }
    const ing = ingredients.find((i) => i.id === pickIng);
    if (!ing) return;
    setLines((cur) => [...cur, {
      ingredient_id: ing.id, ingredient_name: ing.name, unit: ing.unit, qty: n, stock_qty: ing.stock_qty,
    }]);
    setPickIng(""); setPickQty("1");
  };

  const updateQty = (idx: number, v: string) => {
    setLines((cur) => cur.map((l, i) => i === idx ? { ...l, qty: v } : l));
  };
  const removeLine = (idx: number) => setLines((cur) => cur.filter((_, i) => i !== idx));

  const save = async () => {
    if (!product) return;
    const cleaned: { ingredient_id: string; qty: number }[] = [];
    for (const l of lines) {
      const n = typeof l.qty === "number" ? l.qty : parseFloat(String(l.qty).replace(",", "."));
      if (isNaN(n) || n <= 0) { toast({ title: `"${l.ingredient_name}" için miktar geçersiz`, variant: "destructive" }); return; }
      cleaned.push({ ingredient_id: l.ingredient_id, qty: n });
    }
    setSaving(true);
    try {
      await callOp("set_product_recipe", { product_id: product.id, lines: cleaned });
      toast({ title: "Reçete kaydedildi", description: `${cleaned.length} malzeme` });
      onSaved(); onClose();
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChefHat className="h-5 w-5" /> {product?.name} — Reçete
          </DialogTitle>
          <DialogDescription>
            1 adet bu ürün satıldığında stoktan düşülecek malzemeler.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {lines.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Henüz malzeme yok. Aşağıdan ekleyin.
                </div>
              )}
              {lines.map((l, idx) => (
                <div key={l.ingredient_id} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="flex-1">
                    <div className="font-medium">{l.ingredient_name}</div>
                    <div className="text-xs text-muted-foreground">Mevcut stok: {fmtQty(Number(l.stock_qty ?? 0), l.unit)}</div>
                  </div>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={String(l.qty)}
                    onChange={(e) => updateQty(idx, e.target.value)}
                    className="w-24 text-right"
                  />
                  <span className="w-10 text-sm text-muted-foreground">{l.unit}</span>
                  <Button variant="ghost" size="icon" onClick={() => removeLine(idx)}>
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            {availableIngredients.length > 0 && (
              <div className="rounded-md border border-dashed p-3">
                <Label className="text-xs">Malzeme Ekle</Label>
                <div className="mt-2 flex gap-2">
                  <Select value={pickIng} onValueChange={setPickIng}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Malzeme seç..." /></SelectTrigger>
                    <SelectContent>
                      {availableIngredients.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} <span className="text-muted-foreground">({i.unit})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={pickQty}
                    onChange={(e) => setPickQty(e.target.value)}
                    placeholder="Miktar"
                    className="w-28"
                  />
                  <Button onClick={addLine} disabled={!pickIng}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={save} disabled={saving || loading} className="bg-gradient-primary">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Reçeteyi Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
