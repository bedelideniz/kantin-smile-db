import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Ban, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  callParentApi, getParentSession, getSelectedStudentId,
} from "@/lib/parentApi";
import BottomNav from "@/components/veli/BottomNav";

interface Product {
  id: string;
  name: string;
  price: string | number;
  image_url: string | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
}

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

export default function VeliYasaklilar() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const s = getParentSession();
    if (!s) { navigate("/veli-giris", { replace: true }); return; }
    const id = getSelectedStudentId() ?? s.students[0]?.id ?? null;
    if (!id) { navigate("/veli", { replace: true }); return; }
    setStudentId(id);
    setStudentName(s.students.find((x) => x.id === id)?.full_name ?? "");
  }, [navigate]);

  useEffect(() => {
    if (!studentId) return;
    (async () => {
      setLoading(true);
      try {
        const [prods, blockedIds] = await Promise.all([
          callParentApi<Product[]>("list_school_products", { student_id: studentId }),
          callParentApi<string[]>("list_blocked_products", { student_id: studentId }),
        ]);
        setProducts(prods);
        setBlocked(new Set(blockedIds));
      } catch (e: any) {
        toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
      } finally { setLoading(false); }
    })();
  }, [studentId, toast]);

  const grouped = useMemo(() => {
    const filter = q.trim().toLocaleLowerCase("tr");
    const groups = new Map<string, { name: string; color: string | null; items: Product[] }>();
    for (const p of products) {
      if (filter && !p.name.toLocaleLowerCase("tr").includes(filter)) continue;
      const key = p.category_id ?? "__none__";
      const name = p.category_name ?? "Diğer";
      const g = groups.get(key) ?? { name, color: p.category_color, items: [] };
      g.items.push(p);
      groups.set(key, g);
    }
    return Array.from(groups.values());
  }, [products, q]);

  const toggle = async (productId: string, next: boolean) => {
    if (!studentId) return;
    setSaving(productId);
    // optimistic
    setBlocked((prev) => {
      const n = new Set(prev);
      if (next) n.add(productId); else n.delete(productId);
      return n;
    });
    try {
      await callParentApi("set_product_block", {
        student_id: studentId, product_id: productId, blocked: next,
      });
    } catch (e: any) {
      // revert
      setBlocked((prev) => {
        const n = new Set(prev);
        if (next) n.delete(productId); else n.add(productId);
        return n;
      });
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally { setSaving(null); }
  };

  return (
    <main className="min-h-[100dvh] bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/veli")} aria-label="Geri">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 truncate text-base font-semibold">
              <Ban className="h-4 w-4 text-destructive" /> Yasaklı Ürünler
            </h1>
            <p className="truncate text-xs text-muted-foreground">{studentName}</p>
          </div>
          {blocked.size > 0 && (
            <Badge variant="secondary" className="shrink-0">{blocked.size} aktif</Badge>
          )}
        </div>
        <div className="mx-auto mt-2 max-w-md">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ürün ara..."
              className="pl-9 h-10"
            />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-4 p-4">
        <p className="text-xs text-muted-foreground">
          İşaretlediğiniz ürünleri öğrenciniz kantinden satın alamaz. Kasiyer, satış sırasında uyarı alır.
        </p>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : grouped.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            Ürün bulunamadı.
          </CardContent></Card>
        ) : grouped.map((g) => (
          <section key={g.name} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              {g.color && <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />}
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {g.name}
              </h2>
            </div>
            <Card>
              <CardContent className="divide-y p-0">
                {g.items.map((p) => {
                  const isBlocked = blocked.has(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-sm font-medium ${isBlocked ? "text-destructive" : ""}`}>
                          {p.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{fmtTL(p.price)}</div>
                      </div>
                      <Switch
                        checked={isBlocked}
                        disabled={saving === p.id}
                        onCheckedChange={(v) => toggle(p.id, v)}
                        aria-label={`${p.name} yasakla`}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </section>
        ))}
      </div>

      <BottomNav />
    </main>
  );
}
