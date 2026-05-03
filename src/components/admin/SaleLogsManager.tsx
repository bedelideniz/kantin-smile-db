import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Search, AlertTriangle } from "lucide-react";
import { callAdminApi } from "@/lib/adminApi";

interface School { id: string; name: string }
interface SaleLog {
  id: string;
  tx_no: number;
  total_amount: number | string;
  balance_before: number | string;
  balance_after: number | string;
  refunded_amount: number | string;
  status: string;
  created_at: string;
  student_lookup_at: string | null;
  lookup_duration_ms: number | null;
  student_name: string;
  student_class: string | null;
  student_no: string | null;
  cashier_name: string;
  has_alarm: boolean;
}

const fmtMoney = (n: number | string) => Number(n ?? 0).toFixed(2);
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "medium" });

function fmtDuration(ms: number | null) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} sn`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m} dk ${rs} sn`;
}

export default function SaleLogsManager() {
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState<SaleLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    callAdminApi<{ schools: School[] }>("list_schools_for_logs")
      .then((r) => {
        setSchools(r.schools);
        if (r.schools[0]) setSchoolId(r.schools[0].id);
      })
      .catch((e) => toast({ title: "Okullar yüklenemedi", description: e?.message, variant: "destructive" }));
  }, []);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const r = await callAdminApi<{ logs: SaleLog[] }>("list_sale_logs", {
        school_id: schoolId,
        search: search.trim() || undefined,
        limit: 200,
      });
      setLogs(r.logs);
    } catch (e: any) {
      toast({ title: "Loglar alınamadı", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (schoolId) load(); }, [schoolId]);

  const stats = useMemo(() => {
    const total = logs.length;
    const alarm = logs.filter((l) => l.has_alarm).length;
    const durations = logs.map((l) => l.lookup_duration_ms).filter((x): x is number => typeof x === "number");
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return { total, alarm, avg };
  }, [logs]);

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <div className="space-y-1">
            <Label>Okul</Label>
            <Select value={schoolId} onValueChange={setSchoolId}>
              <SelectTrigger><SelectValue placeholder="Okul seçin" /></SelectTrigger>
              <SelectContent>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Ara (öğrenci, sınıf, kasiyer, işlem no)</Label>
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                placeholder="Örn. Ahmet, 7-A, #123, kasiyer adı"
              />
              <Button variant="secondary" onClick={load} disabled={!schoolId || loading}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={load} disabled={!schoolId || loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">Toplam: {stats.total}</Badge>
          <Badge variant="secondary">Alarmlı: {stats.alarm}</Badge>
          <Badge variant="secondary">Ort. okutma → ödeme: {fmtDuration(Math.round(stats.avg))}</Badge>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">İşlem No</th>
                <th className="p-2">Tarih / Saat</th>
                <th className="p-2">Öğrenci</th>
                <th className="p-2">Kasiyer</th>
                <th className="p-2 text-right">Tutar</th>
                <th className="p-2">Kart Okutma</th>
                <th className="p-2">Süre</th>
                <th className="p-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">
                  {loading ? "Yükleniyor…" : "Kayıt yok"}
                </td></tr>
              ) : logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2 font-mono">#{l.tx_no}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDateTime(l.created_at)}</td>
                  <td className="p-2">
                    <div className="font-medium">{l.student_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[l.student_class, l.student_no].filter(Boolean).join(" • ")}
                    </div>
                  </td>
                  <td className="p-2">{l.cashier_name}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {fmtMoney(l.total_amount)} ₺
                    {Number(l.refunded_amount) > 0 && (
                      <div className="text-xs text-destructive">−{fmtMoney(l.refunded_amount)} iade</div>
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap text-xs">
                    {l.student_lookup_at ? fmtDateTime(l.student_lookup_at) : "—"}
                  </td>
                  <td className="p-2 whitespace-nowrap">{fmtDuration(l.lookup_duration_ms)}</td>
                  <td className="p-2">
                    {l.has_alarm && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> Alarm
                      </Badge>
                    )}
                    {l.status !== "completed" && (
                      <Badge variant="outline" className="ml-1">{l.status}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          "Süre" = öğrenci kartının okutulduğu an ile satışın tamamlandığı an arasındaki fark.
          Veli itirazlarında "öğrenci o saatte kantinde miydi" sorusuna cevap verir.
        </p>
      </CardContent>
    </Card>
  );
}
