import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCw, Check, X, Receipt } from "lucide-react";
import { callAdminApi } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

interface Alarm {
  id: string;
  transaction_id: string;
  school_id: string;
  reason: string | null;
  status: "open" | "resolved" | "rejected";
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  tx_no: number;
  total_amount: number | string;
  refunded_amount: number | string;
  tx_created_at: string;
  student_name: string;
  student_class: string | null;
  student_no: string | null;
  cashier_name: string;
  school_name: string;
}

interface AlarmDetail {
  alarm: Alarm & { student_id: string; student_balance: number | string; balance_before: number | string; balance_after: number | string };
  items: Array<{ id: string; product_name: string; unit_price: number | string; qty: number; line_total: number | string }>;
  refunds: Array<{ id: string; amount: number | string; kind: "full" | "partial"; note: string | null; created_at: string }>;
}

const fmt = (n: number | string) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AlarmsManager() {
  const { toast } = useToast();
  const [status, setStatus] = useState<"open" | "resolved" | "rejected" | "all">("open");
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AlarmDetail | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callAdminApi<{ alarms: Alarm[] }>("list_alarms", { status });
      setAlarms(r.alarms);
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const openDetail = async (a: Alarm) => {
    try {
      const d = await callAdminApi<AlarmDetail>("alarm_detail", { alarm_id: a.id });
      setSelected(d);
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" /> Alarmlar
          </h2>
          <p className="text-sm text-muted-foreground">
            Kasiyerlerin işaretlediği işlemler. İnceleyip kısmi/tam iade verebilir veya reddedebilirsiniz.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={status} onValueChange={(v) => setStatus(v as any)}>
            <TabsList>
              <TabsTrigger value="open">Açık</TabsTrigger>
              <TabsTrigger value="resolved">İade edildi</TabsTrigger>
              <TabsTrigger value="rejected">Reddedildi</TabsTrigger>
              <TabsTrigger value="all">Tümü</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Yükleniyor…</div>
          ) : alarms.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Kayıt yok.</div>
          ) : (
            <div className="divide-y">
              {alarms.map((a) => (
                <button
                  key={a.id}
                  onClick={() => openDetail(a)}
                  className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-accent/40"
                >
                  <div className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    a.status === "open" ? "bg-warning/15 text-warning" :
                    a.status === "resolved" ? "bg-success/15 text-success" :
                    "bg-muted text-muted-foreground",
                  )}>
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold">#{a.tx_no}</span>
                      <Badge variant={a.status === "open" ? "default" : "secondary"}>
                        {a.status === "open" ? "Açık" : a.status === "resolved" ? "İade edildi" : "Reddedildi"}
                      </Badge>
                      <span className="text-sm font-medium">{a.student_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[a.student_class, a.student_no].filter(Boolean).join(" • ")}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {a.school_name} • Kasiyer: {a.cashier_name} • {new Date(a.created_at).toLocaleString("tr-TR")}
                    </p>
                    {a.reason && <p className="mt-1 truncate text-sm">"{a.reason}"</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{fmt(a.total_amount)} ₺</p>
                    {Number(a.refunded_amount) > 0 && (
                      <p className="text-xs text-success">−{fmt(a.refunded_amount)} ₺ iade</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <AlarmDetailDialog
          detail={selected}
          onClose={() => setSelected(null)}
          onDone={() => { setSelected(null); load(); window.dispatchEvent(new Event("alarms:changed")); }}
        />
      )}
    </div>
  );
}

function AlarmDetailDialog({ detail, onClose, onDone }: {
  detail: AlarmDetail; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const { alarm, items, refunds } = detail;
  const [mode, setMode] = useState<"none" | "full" | "partial">("none");
  const [partialQty, setPartialQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const remaining = +(Number(alarm.total_amount) - Number(alarm.refunded_amount)).toFixed(2);

  const partialTotal = useMemo(() => {
    return items.reduce((s, it) => {
      const q = partialQty[it.id] ?? 0;
      return s + Number(it.unit_price) * q;
    }, 0);
  }, [items, partialQty]);

  const refund = async () => {
    if (mode === "none") return;
    setBusy(true);
    try {
      const params: any = {
        alarm_id: alarm.id,
        transaction_id: alarm.transaction_id,
        kind: mode,
        note: note.trim() || undefined,
      };
      if (mode === "partial") {
        params.items = Object.entries(partialQty)
          .filter(([, q]) => q > 0)
          .map(([transaction_item_id, qty]) => ({ transaction_item_id, qty }));
        if (params.items.length === 0) {
          toast({ title: "Kalem seçin", variant: "destructive" });
          setBusy(false); return;
        }
      }
      const r = await callAdminApi<{ amount: number; balance_after: number }>("refund_transaction", params);
      toast({
        title: "İade yapıldı",
        description: `${fmt(r.amount)} ₺ veliye iade edildi. Yeni bakiye: ${fmt(r.balance_after)} ₺`,
      });
      onDone();
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await callAdminApi("reject_alarm", { alarm_id: alarm.id, note: note.trim() || undefined });
      toast({ title: "Alarm reddedildi" });
      onDone();
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" /> İşlem #{alarm.tx_no}
          </DialogTitle>
          <DialogDescription>
            {alarm.school_name} • {alarm.student_name} ({[alarm.student_class, alarm.student_no].filter(Boolean).join(" • ")}) • Kasiyer: {alarm.cashier_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {alarm.reason && (
            <div className="rounded-lg border bg-warning/5 p-3 text-sm">
              <p className="text-xs font-semibold uppercase text-warning">Kasiyer notu</p>
              <p className="mt-1">{alarm.reason}</p>
            </div>
          )}

          <div className="rounded-lg border">
            <div className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Satılan ürünler
            </div>
            <div className="divide-y">
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{it.product_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.qty} × {fmt(it.unit_price)} ₺
                    </p>
                  </div>
                  {mode === "partial" && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">İade adedi:</Label>
                      <Input
                        type="number" min={0} max={it.qty}
                        value={partialQty[it.id] ?? 0}
                        onChange={(e) => setPartialQty((p) => ({ ...p, [it.id]: Math.max(0, Math.min(it.qty, Number(e.target.value) || 0)) }))}
                        className="w-20"
                      />
                    </div>
                  )}
                  <div className="w-20 text-right font-bold">{fmt(it.line_total)} ₺</div>
                </div>
              ))}
            </div>
            <div className="border-t bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span>Toplam</span><span className="font-bold">{fmt(alarm.total_amount)} ₺</span>
              </div>
              {Number(alarm.refunded_amount) > 0 && (
                <div className="flex justify-between text-success">
                  <span>Önceden iade</span><span>−{fmt(alarm.refunded_amount)} ₺</span>
                </div>
              )}
              <div className="flex justify-between border-t mt-1 pt-1">
                <span>Kalan iade edilebilir</span>
                <span className="font-bold">{fmt(remaining)} ₺</span>
              </div>
            </div>
          </div>

          {refunds.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold mb-1">Geçmiş iadeler:</p>
              {refunds.map((r) => (
                <div key={r.id}>
                  • {fmt(r.amount)} ₺ ({r.kind === "full" ? "tam" : "kısmi"}) — {new Date(r.created_at).toLocaleString("tr-TR")}
                </div>
              ))}
            </div>
          )}

          {alarm.status === "open" && remaining > 0 && (
            <>
              <div className="flex gap-2">
                <Button
                  variant={mode === "full" ? "default" : "outline"}
                  className="flex-1" onClick={() => setMode("full")}
                >
                  Tam iade ({fmt(remaining)} ₺)
                </Button>
                <Button
                  variant={mode === "partial" ? "default" : "outline"}
                  className="flex-1" onClick={() => setMode("partial")}
                >
                  Kısmi iade
                </Button>
              </div>
              {mode === "partial" && partialTotal > 0 && (
                <p className="text-sm">Kısmi iade tutarı: <span className="font-bold">{fmt(partialTotal)} ₺</span></p>
              )}
              <div>
                <Label>Not (opsiyonel)</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          {alarm.status === "open" && (
            <>
              <Button variant="ghost" onClick={reject} disabled={busy}>
                <X className="mr-1 h-4 w-4" /> Reddet
              </Button>
              <Button onClick={refund} disabled={busy || mode === "none"}>
                <Check className="mr-1 h-4 w-4" /> İade et
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
