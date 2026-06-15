import { useEffect, useState } from "react";
import { Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { callAdminApi } from "@/lib/adminApi";

type DisputeStatus = "open" | "reviewing" | "resolved" | "rejected";

interface DisputeItem {
  product_name: string; qty: number; unit_price: string | number; line_total: string | number;
}
interface Dispute {
  id: string;
  transaction_id: string;
  parent_phone: string;
  category: string;
  note: string | null;
  amount: string | number;
  status: DisputeStatus;
  resolution_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  tx_no: string | null;
  total_amount: string | number;
  tx_created_at: string;
  student_name: string;
  student_class: string | null;
  student_no: string | null;
  school_name: string | null;
  items: DisputeItem[];
}

const CATEGORY_LABEL: Record<string, string> = {
  wrong_item: "Yanlış ürün",
  price_diff: "Fiyat farkı",
  wrong_charge: "Hatalı çekim",
  not_me: "Harcamayı ben yapmadım",
  other: "Diğer",
};

const STATUS_LABEL: Record<DisputeStatus, string> = {
  open: "Açık",
  reviewing: "İnceleniyor",
  resolved: "Çözüldü",
  rejected: "Reddedildi",
};

const STATUS_TONE: Record<DisputeStatus, string> = {
  open: "bg-destructive text-destructive-foreground",
  reviewing: "bg-amber-500 text-white",
  resolved: "bg-emerald-600 text-white",
  rejected: "bg-muted text-muted-foreground",
};

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const fmtDate = (s: string) =>
  new Date(s).toLocaleString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

export default function DisputesManager() {
  const { toast } = useToast();
  const [status, setStatus] = useState<DisputeStatus | "all">("open");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Dispute[]>([]);
  const [editing, setEditing] = useState<Dispute | null>(null);
  const [newStatus, setNewStatus] = useState<DisputeStatus>("reviewing");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callAdminApi<{ disputes: Dispute[] }>("list_disputes", { status, limit: 200 });
      setItems(r.disputes ?? []);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const openEdit = (d: Dispute) => {
    setEditing(d);
    setNewStatus(d.status === "open" ? "reviewing" : d.status);
    setNote(d.resolution_note ?? "");
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await callAdminApi("update_dispute", {
        dispute_id: editing.id,
        status: newStatus,
        resolution_note: note.trim() || undefined,
      });
      toast({ title: "Güncellendi" });
      setEditing(null);
      load();
      window.dispatchEvent(new Event("disputes:changed"));
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          Veli İtirazları
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Açık</SelectItem>
              <SelectItem value="reviewing">İnceleniyor</SelectItem>
              <SelectItem value="resolved">Çözüldü</SelectItem>
              <SelectItem value="rejected">Reddedildi</SelectItem>
              <SelectItem value="all">Tümü</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Kayıt yok.</p>
        ) : (
          <div className="space-y-2">
            {items.map((d) => (
              <button
                key={d.id}
                onClick={() => openEdit(d)}
                className="w-full rounded-xl border border-border/60 bg-card p-3 text-left transition hover:border-primary/40 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`${STATUS_TONE[d.status]} text-[10px]`}>{STATUS_LABEL[d.status]}</Badge>
                      <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[d.category] ?? d.category}</Badge>
                      {d.tx_no && <span className="text-[11px] text-muted-foreground">#{d.tx_no}</span>}
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                      {d.student_name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {[d.school_name, d.student_class, d.student_no].filter(Boolean).join(" • ")}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Veli: {d.parent_phone} • İtiraz: {fmtDate(d.created_at)} • İşlem: {fmtDate(d.tx_created_at)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold tabular-nums text-destructive">{fmtTL(d.total_amount)}</div>
                  </div>
                </div>
                {d.items?.length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <div className="space-y-0.5">
                      {d.items.map((it, i) => (
                        <div key={i} className="flex justify-between gap-2 text-xs">
                          <span className="truncate">
                            {it.qty > 1 && <span className="font-semibold">{it.qty}× </span>}
                            {it.product_name}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {fmtTL(it.line_total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {d.note && (
                  <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
                    <span className="font-semibold">Veli notu: </span>{d.note}
                  </div>
                )}
                {d.resolution_note && (
                  <div className="mt-1 rounded-md bg-primary/5 p-2 text-xs">
                    <span className="font-semibold">Çözüm notu: </span>{d.resolution_note}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(v) => { if (!v && !saving) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>İtirazı güncelle</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border/60 bg-muted/40 p-2 text-xs">
                <div className="font-semibold">{editing.student_name}</div>
                <div className="text-muted-foreground">
                  {CATEGORY_LABEL[editing.category] ?? editing.category} • {fmtTL(editing.total_amount)}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Durum</Label>
                <Select value={newStatus} onValueChange={(v) => setNewStatus(v as DisputeStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Açık</SelectItem>
                    <SelectItem value="reviewing">İnceleniyor</SelectItem>
                    <SelectItem value="resolved">Çözüldü</SelectItem>
                    <SelectItem value="rejected">Reddedildi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Çözüm / yönetici notu</Label>
                <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Vazgeç</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
