import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { callAdminApi } from "@/lib/adminApi";
import { RefreshCw, CheckCircle2, RotateCcw } from "lucide-react";

interface PayoutRow {
  id: string;
  school_id: string;
  school_name: string;
  sale_date: string;
  gross_amount: string | number;
  refunded_amount: string | number;
  net_sales: string | number;
  commission_rate: string | number;
  commission_amount: string | number;
  payout_amount: string | number;
  hold_days: number;
  payable_at: string;
  status: "pending" | "payable" | "paid" | "cancelled";
  paid_at: string | null;
  paid_reference: string | null;
  note: string | null;
}

interface SchoolOpt { id: string; name: string; commission_rate: number | string; payout_hold_days: number }

const fmt = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const statusBadge = (s: PayoutRow["status"]) => {
  const map: Record<PayoutRow["status"], { label: string; cls: string }> = {
    pending:   { label: "Beklemede",  cls: "bg-muted text-foreground" },
    payable:   { label: "Ödenebilir", cls: "bg-amber-500 text-white" },
    paid:      { label: "Ödendi",     cls: "bg-emerald-600 text-white" },
    cancelled: { label: "İptal",      cls: "bg-destructive text-destructive-foreground" },
  };
  const m = map[s];
  return <Badge className={m.cls}>{m.label}</Badge>;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export default function CanteenPayoutsManager() {
  const { toast } = useToast();
  const [schools, setSchools] = useState<SchoolOpt[]>([]);
  const [schoolId, setSchoolId] = useState<string>("all");
  const [status, setStatus] = useState<"unpaid"|"paid"|"all"|"pending"|"payable"|"cancelled">("unpaid");
  const [from, setFrom] = useState<string>(daysAgoISO(30));
  const [to, setTo] = useState<string>(todayISO());
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [summary, setSummary] = useState<{ payable_total: string; pending_total: string; paid_total: string; commission_total: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [payDialog, setPayDialog] = useState<PayoutRow | null>(null);
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState("");

  const loadSchools = async () => {
    try {
      const r = await callAdminApi<{ schools: SchoolOpt[] }>("list_payout_schools");
      setSchools(r.schools);
    } catch (e) {
      toast({ title: "Okullar yüklenemedi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      // Recompute first (idempotent), then list
      await callAdminApi("recompute_canteen_payouts", {
        ...(schoolId !== "all" ? { school_id: schoolId } : {}),
        from, to,
      });
      const r = await callAdminApi<{ rows: PayoutRow[]; summary: any }>("list_canteen_payouts", {
        ...(schoolId !== "all" ? { school_id: schoolId } : {}),
        status, from, to, limit: 1000,
      });
      setRows(r.rows);
      setSummary(r.summary);
    } catch (e) {
      toast({ title: "Yüklenemedi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSchools(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [schoolId, status, from, to]);

  const markPaid = async () => {
    if (!payDialog) return;
    try {
      await callAdminApi("mark_canteen_payout_paid", {
        id: payDialog.id,
        reference: payRef.trim() || undefined,
        note: payNote.trim() || undefined,
      });
      toast({ title: "Ödendi olarak işaretlendi" });
      setPayDialog(null); setPayRef(""); setPayNote("");
      await load();
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  const markUnpaid = async (row: PayoutRow) => {
    try {
      await callAdminApi("mark_canteen_payout_unpaid", { id: row.id });
      toast({ title: "Geri alındı" });
      await load();
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  const totalRow = useMemo(() => {
    const sum = rows.reduce((acc, r) => acc + Number(r.payout_amount), 0);
    return sum;
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kantin Ödemeleri</CardTitle>
        <p className="text-sm text-muted-foreground">
          Okul bazlı günlük net hak ediş. Satış tarihinden, okul için belirlenen blokeli gün sayısı kadar
          sonra (00:01'de) ödenebilir hâle gelir.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Okul</Label>
            <Select value={schoolId} onValueChange={setSchoolId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm okullar</SelectItem>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Durum</Label>
            <Select value={status} onValueChange={(v: any) => setStatus(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unpaid">Ödenmemiş (bekleyen+ödenebilir)</SelectItem>
                <SelectItem value="payable">Ödenebilir</SelectItem>
                <SelectItem value="pending">Beklemede</SelectItem>
                <SelectItem value="paid">Ödendi</SelectItem>
                <SelectItem value="all">Tümü</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Başlangıç</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bitiş</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={load} disabled={loading} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Yenile
            </Button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Ödenebilir</div>
              <div className="text-lg font-semibold text-amber-600">{fmt(summary.payable_total)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Beklemede</div>
              <div className="text-lg font-semibold">{fmt(summary.pending_total)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Ödenen</div>
              <div className="text-lg font-semibold text-emerald-600">{fmt(summary.paid_total)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Toplam Komisyon</div>
              <div className="text-lg font-semibold">{fmt(summary.commission_total)}</div>
            </CardContent></Card>
          </div>
        )}

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Okul</TableHead>
                <TableHead>Satış Günü</TableHead>
                <TableHead className="text-right">Brüt</TableHead>
                <TableHead className="text-right">İade</TableHead>
                <TableHead className="text-right">Net Satış</TableHead>
                <TableHead className="text-right">Komisyon</TableHead>
                <TableHead className="text-right">Hak Ediş</TableHead>
                <TableHead>Ödenebilir</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground">Yükleniyor…</TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground">Kayıt yok.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.school_name}</TableCell>
                  <TableCell>{new Date(r.sale_date).toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell className="text-right">{fmt(r.gross_amount)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmt(r.refunded_amount)}</TableCell>
                  <TableCell className="text-right">{fmt(r.net_sales)}</TableCell>
                  <TableCell className="text-right">
                    {fmt(r.commission_amount)}
                    <div className="text-xs text-muted-foreground">%{(Number(r.commission_rate) * 100).toFixed(2)}</div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{fmt(r.payout_amount)}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(r.payable_at).toLocaleString("tr-TR")}
                    <div className="text-muted-foreground">{r.hold_days} gün bloke</div>
                  </TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === "payable" || r.status === "pending" ? (
                      <Button size="sm" onClick={() => setPayDialog(r)} disabled={r.status === "pending"}>
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        Ödendi
                      </Button>
                    ) : r.status === "paid" ? (
                      <Button size="sm" variant="ghost" onClick={() => markUnpaid(r)}>
                        <RotateCcw className="mr-1 h-4 w-4" />
                        Geri Al
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length > 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-right font-semibold">Görüntülenen Toplam Hak Ediş</TableCell>
                  <TableCell className="text-right font-semibold">{fmt(totalRow)}</TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ödendi olarak işaretle</DialogTitle>
            </DialogHeader>
            {payDialog && (
              <div className="space-y-3">
                <div className="text-sm">
                  <div><b>{payDialog.school_name}</b> — {new Date(payDialog.sale_date).toLocaleDateString("tr-TR")}</div>
                  <div className="text-muted-foreground">Tutar: <b>{fmt(payDialog.payout_amount)}</b></div>
                </div>
                <div className="space-y-1.5">
                  <Label>Referans (opsiyonel)</Label>
                  <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Banka transfer no vb." />
                </div>
                <div className="space-y-1.5">
                  <Label>Not (opsiyonel)</Label>
                  <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayDialog(null)}>İptal</Button>
              <Button onClick={markPaid}>Onayla</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
