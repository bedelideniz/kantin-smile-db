import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Package, Boxes, AlertTriangle, ImageOff } from "lucide-react";

type Filter = "all" | "products" | "ingredients";

interface ProductRow {
  id: string;
  name: string;
  image_url: string | null;
  barcode: string | null;
  stock_tracking: boolean;
  stock_qty: number | string;
  is_active: boolean;
}
interface IngredientRow {
  id: string;
  name: string;
  unit: string;
  stock_qty: number | string;
  low_stock_threshold: number | string | null;
  is_active: boolean;
}

interface StockItem {
  key: string;
  type: "product" | "ingredient";
  name: string;
  image_url: string | null;
  unit: string;
  stock: number | null; // null = takip edilmiyor
  threshold: number | null;
  is_active: boolean;
  extra: string;
}

async function callOp<T = unknown>(op: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  }
  return (data as { data: T }).data;
}

const fmtQty = (n: number | null, unit: string) => {
  if (n == null) return "—";
  return `${n.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} ${unit}`;
};

export default function StockManager() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const [prods, ings] = await Promise.all([
        callOp<ProductRow[]>("list_products_admin"),
        callOp<IngredientRow[]>("list_ingredients"),
      ]);
      setProducts(prods);
      setIngredients(ings);
    } catch (e: any) {
      toast({ title: "Yükleme hatası", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const items: StockItem[] = useMemo(() => {
    const list: StockItem[] = [];
    for (const p of products) {
      list.push({
        key: `p-${p.id}`,
        type: "product",
        name: p.name,
        image_url: p.image_url,
        unit: "adet",
        stock: p.stock_tracking ? Number(p.stock_qty) : null,
        threshold: null,
        is_active: p.is_active,
        extra: p.barcode ? `Barkod: ${p.barcode}` : "",
      });
    }
    for (const i of ingredients) {
      list.push({
        key: `i-${i.id}`,
        type: "ingredient",
        name: i.name,
        image_url: null,
        unit: i.unit,
        stock: Number(i.stock_qty),
        threshold: i.low_stock_threshold == null ? null : Number(i.low_stock_threshold),
        is_active: i.is_active,
        extra: "",
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [products, ingredients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return items.filter((it) => {
      if (filter === "products" && it.type !== "product") return false;
      if (filter === "ingredients" && it.type !== "ingredient") return false;
      if (q && !it.name.toLocaleLowerCase("tr").includes(q) && !it.extra.toLocaleLowerCase("tr").includes(q)) return false;
      return true;
    });
  }, [items, filter, search]);

  const stats = useMemo(() => {
    let outOfStock = 0;
    let low = 0;
    for (const it of items) {
      if (it.stock == null) continue;
      if (it.stock <= 0) outOfStock++;
      else if (it.threshold != null && it.stock <= it.threshold) low++;
    }
    return { total: items.length, outOfStock, low };
  }, [items]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5" /> Stok Listesi
            </CardTitle>
            <CardDescription>
              Tüm ürünler ve malzemeler tek listede. Düşük stok ve tükenenler vurgulanır.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Toplam: {stats.total}</Badge>
            {stats.low > 0 && <Badge variant="secondary">Düşük: {stats.low}</Badge>}
            {stats.outOfStock > 0 && <Badge variant="destructive">Tükenen: {stats.outOfStock}</Badge>}
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">Tümü</TabsTrigger>
              <TabsTrigger value="products" className="gap-1.5">
                <Package className="h-3.5 w-3.5" /> Ürünler
              </TabsTrigger>
              <TabsTrigger value="ingredients" className="gap-1.5">
                <Boxes className="h-3.5 w-3.5" /> Malzemeler
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative md:flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Ada veya barkoda göre ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]"></TableHead>
                <TableHead>İsim</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead className="text-right">Eşik</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Eşleşen kayıt yok.
                  </TableCell>
                </TableRow>
              ) : filtered.map((it) => {
                const trackless = it.stock == null;
                const out = !trackless && (it.stock as number) <= 0;
                const low = !trackless && !out && it.threshold != null && (it.stock as number) <= it.threshold;
                return (
                  <TableRow key={it.key} className={!it.is_active ? "opacity-50" : ""}>
                    <TableCell>
                      {it.image_url ? (
                        <img
                          src={it.image_url}
                          alt={it.name}
                          className="h-10 w-10 rounded-md object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          {it.type === "product" ? <ImageOff className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{it.name}</div>
                      {it.extra && <div className="text-xs text-muted-foreground">{it.extra}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {it.type === "product" ? <Package className="h-3 w-3" /> : <Boxes className="h-3 w-3" />}
                        {it.type === "product" ? "Ürün" : "Malzeme"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {trackless ? (
                        <span className="text-sm text-muted-foreground">Takip edilmiyor</span>
                      ) : (
                        <Badge variant={out ? "destructive" : low ? "secondary" : "outline"}>
                          {fmtQty(it.stock, it.unit)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {it.threshold == null ? "—" : fmtQty(it.threshold, it.unit)}
                    </TableCell>
                    <TableCell>
                      {!it.is_active ? (
                        <Badge variant="outline">Pasif</Badge>
                      ) : out ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" /> Tükendi
                        </Badge>
                      ) : low ? (
                        <Badge variant="secondary" className="gap-1">
                          <AlertTriangle className="h-3 w-3" /> Düşük
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-green-500/40 text-green-600 dark:text-green-400">
                          Yeterli
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
