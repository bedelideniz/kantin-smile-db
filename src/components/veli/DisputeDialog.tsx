import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { callParentApi } from "@/lib/parentApi";

export type DisputeCategory =
  | "wrong_item" | "price_diff" | "wrong_charge" | "not_me" | "other";

const CATEGORIES: { value: DisputeCategory; label: string; hint: string }[] = [
  { value: "wrong_item",   label: "Yanlış ürün",            hint: "Listede olmayan / farklı bir ürün görünüyor" },
  { value: "price_diff",   label: "Fiyat farkı",            hint: "Ürün fiyatı beklenenden farklı" },
  { value: "wrong_charge", label: "Hatalı çekim",           hint: "Tutar yanlış hesaplanmış" },
  { value: "not_me",       label: "Harcamayı ben yapmadım", hint: "Bu işlem bizim öğrenciye ait değil" },
  { value: "other",        label: "Diğer",                  hint: "Açıklama ekleyebilirsiniz" },
];

interface Item { product_name: string; qty: number; unit_price: number; line_total: number; }
interface TxLite {
  id: string;
  created_at: string;
  total_amount: string | number;
  items: Item[];
}

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const fmtDate = (s: string) =>
  new Date(s).toLocaleString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

export default function DisputeDialog({
  open, onOpenChange, tx,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tx: TxLite | null;
}) {
  const { toast } = useToast();
  const [category, setCategory] = useState<DisputeCategory>("wrong_item");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setCategory("wrong_item"); setNote(""); };

  const submit = async () => {
    if (!tx) return;
    setSubmitting(true);
    try {
      await callParentApi("create_dispute", {
        transaction_id: tx.id,
        category,
        note: note.trim() || undefined,
      });
      toast({
        title: "Talebiniz alındı",
        description: "İtirazınız 24 saat içinde incelenecektir.",
      });
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Gönderilemedi",
        description: e?.message ?? "Lütfen tekrar deneyin.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            İşleme itiraz et
          </DialogTitle>
          <DialogDescription>
            İtirazınız ekibimize iletilecek ve 24 saat içinde incelenecektir.
          </DialogDescription>
        </DialogHeader>

        {tx && (
          <div className="rounded-xl border border-border/60 bg-muted/40 p-3 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{fmtDate(tx.created_at)}</span>
              <span className="font-bold tabular-nums text-destructive">−{fmtTL(tx.total_amount)}</span>
            </div>
            <Separator className="my-2" />
            <div className="space-y-0.5">
              {tx.items.map((it, i) => (
                <div key={i} className="flex justify-between gap-2 text-xs">
                  <span className="truncate">
                    {it.qty > 1 && <span className="font-semibold">{it.qty}× </span>}
                    {it.product_name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{fmtTL(it.line_total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Hata kategorisi</Label>
          <RadioGroup value={category} onValueChange={(v) => setCategory(v as DisputeCategory)} className="gap-2">
            {CATEGORIES.map((c) => (
              <label
                key={c.value}
                htmlFor={`dispute-${c.value}`}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
                  category === c.value ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40"
                }`}
              >
                <RadioGroupItem id={`dispute-${c.value}`} value={c.value} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.hint}</div>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dispute-note" className="text-sm font-semibold">Açıklama (isteğe bağlı)</Label>
          <Textarea
            id="dispute-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Detay eklemek isterseniz yazabilirsiniz."
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            İtirazımı gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
