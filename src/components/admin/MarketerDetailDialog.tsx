import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Check } from "lucide-react";
import { callMarketerApi, formatPercent, formatTRY, MarketerSummary, MONTH_NAMES_TR } from "@/lib/marketerApi";

interface AvailableSchool {
  id: string; name: string; province: string | null; district: string | null;
  is_active: boolean; marketer_id: string | null; marketer_name: string | null;
}

interface Earning {
  id: string; school_id: string; school_name: string;
  period_year: number; period_month: number;
  commission_amount: string; share_rate: string; share_amount: string;
  status: string;
}

interface Bonus {
  id: string; school_id: string; school_name: string;
  amount: string; status: string;
}

interface Payout {
  id: string; amount: string; method: string | null; reference: string | null;
  note: string | null; paid_at: string;
}

interface MySchool { id: string; name: string; }

export default function MarketerDetailDialog({
  marketerId, marketerName, onClose,
}: { marketerId: string; marketerName: string; onClose: () => void }) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<MarketerSummary | null>(null);
  const [mySchools, setMySchools] = useState<MySchool[]>([]);
  const [allSchools, setAllSchools] = useState<AvailableSchool[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);

  // Earning form
  const now = new Date();
  const [eForm, setEForm] = useState({
    school_id: "", year: now.getFullYear(), month: now.getMonth() + 1,
    commission_amount: "", note: "",
  });
  // Payout form
  const [pForm, setPForm] = useState({ amount: "", method: "Banka transferi", reference: "", note: "" });
  // Assign school
  const [assignSchoolId, setAssignSchoolId] = useState("");

  const reload = async () => {
    try {
      const [s, sch, all, earn, bon, pay] = await Promise.all([
        callMarketerApi<{ summary: MarketerSummary }>("get_marketer_summary", { marketer_id: marketerId }),
        callMarketerApi<{ earnings: Earning[] }>("list_monthly_earnings", { marketer_id: marketerId }).then(
          async () => callMarketerApi<{ schools: any[] }>("list_schools_for_assignment")
            .then((r) => ({ schools: r.schools.filter((x) => x.marketer_id === marketerId)
              .map((x) => ({ id: x.id, name: x.name })) }))
        ),
        callMarketerApi<{ schools: AvailableSchool[] }>("list_schools_for_assignment"),
        callMarketerApi<{ earnings: Earning[] }>("list_monthly_earnings", { marketer_id: marketerId }),
        callMarketerApi<{ bonuses: Bonus[] }>("my_bonuses_admin").catch(async () => {
          // fallback: build from earnings list endpoint? Use dedicated:
          return { bonuses: [] };
        }),
        callMarketerApi<{ payouts: Payout[] }>("list_payouts", { marketer_id: marketerId }),
      ]);
      setSummary(s.summary);
      setMySchools(sch.schools);
      setAllSchools(all.schools);
      setEarnings(earn.earnings);
      // bonuses fetched via separate call below
      setPayouts(pay.payouts);
    } catch (e: any) {
      toast({ title: "Yükleme hatası", description: e.message, variant: "destructive" });
    }
    // bonuses (admin view via dedicated query path) — reuse list_monthly via direct list
    try {
      // We expose bonuses to admin via list endpoint piggy-back: query list for this marketer.
      // The marketer-api 'my_bonuses' is self-only, so admin uses a small SELECT through a generic call.
      // For simplicity we re-derive from a dedicated server call we add (list via admin pseudo-action).
      // Here we just request via update_bonus_status preview path -> not ideal. Instead, fetch via dedicated:
      const r = await callMarketerApi<{ bonuses: Bonus[] }>("list_bonuses_admin", { marketer_id: marketerId })
        .catch(() => ({ bonuses: [] as Bonus[] }));
      setBonuses(r.bonuses);
    } catch { /* ignore */ }
  };

  useEffect(() => { reload(); }, [marketerId]);

  const assignSchool = async () => {
    if (!assignSchoolId) return;
    try {
      await callMarketerApi("assign_school", { marketer_id: marketerId, school_id: assignSchoolId });
      toast({ title: "Okul atandı", description: "Tek seferlik bonus 'beklemede' olarak eklendi." });
      setAssignSchoolId("");
      await reload();
    } catch (e: any) {
      toast({ title: "Atanamadı", description: e.message, variant: "destructive" });
    }
  };

  const unassign = async (school_id: string) => {
    try {
      await callMarketerApi("unassign_school", { school_id });
      toast({ title: "Atama kaldırıldı" });
      await reload();
    } catch (e: any) {
      toast({ title: "Hata", description: e.message, variant: "destructive" });
    }
  };

  const upsertEarning = async () => {
    try {
      const amt = Number(eForm.commission_amount);
      if (!eForm.school_id) throw new Error("Okul seçin");
      if (Number.isNaN(amt) || amt < 0) throw new Error("Geçersiz tutar");
      const r = await callMarketerApi<{ share_amount: number; share_rate: number }>("upsert_monthly_earning", {
        marketer_id: marketerId, school_id: eForm.school_id,
        period_year: eForm.year, period_month: eForm.month,
        commission_amount: amt, note: eForm.note || null,
      });
      toast({ title: "Kayıt yapıldı", description: `Pazarlamacı payı: ${formatTRY(r.share_amount)}` });
      setEForm({ ...eForm, commission_amount: "", note: "" });
      await reload();
    } catch (e: any) {
      toast({ title: "Hata", description: e.message, variant: "destructive" });
    }
  };

  const setEarningStatus = async (id: string, status: string) => {
    await callMarketerApi("update_earning_status", { id, status });
    await reload();
  };
  const setBonusStatus = async (id: string, status: string) => {
    await callMarketerApi("update_bonus_status", { id, status });
    await reload();
  };
  const removeEarning = async (id: string) => {
    await callMarketerApi("delete_monthly_earning", { id });
    await reload();
  };

  const recordPayout = async () => {
    try {
      const amt = Number(pForm.amount);
      if (Number.isNaN(amt) || amt <= 0) throw new Error("Geçersiz tutar");
      await callMarketerApi("record_payout", {
        marketer_id: marketerId, amount: amt,
        method: pForm.method || null, reference: pForm.reference || null, note: pForm.note || null,
      });
      toast({ title: "Ödeme kaydedildi" });
      setPForm({ amount: "", method: "Banka transferi", reference: "", note: "" });
      await reload();
    } catch (e: any) {
      toast({ title: "Hata", description: e.message, variant: "destructive" });
    }
  };

  const removePayout = async (id: string) => {
    await callMarketerApi("delete_payout", { id });
    await reload();
  };

  const unassignedSchools = allSchools.filter((s) => !s.marketer_id);

  const statusBadge = (s: string) => {
    const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "outline", approved: "default", paid: "secondary", cancelled: "destructive",
    };
    const label = { pending: "Beklemede", approved: "Onaylı", paid: "Ödendi", cancelled: "İptal" }[s] ?? s;
    return <Badge variant={map[s] ?? "outline"}>{label}</Badge>;
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{marketerName}</DialogTitle>
          <DialogDescription>Okul atamaları, aylık komisyon kayıtları, bonuslar ve ödemeler</DialogDescription>
        </DialogHeader>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Okul Sayısı</div>
              <div className="text-2xl font-semibold">{summary.school_count}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Bu Ay Hak Edilen</div>
              <div className="text-2xl font-semibold">{formatTRY(summary.current_month_share)}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Onaylı / Ödenecek</div>
              <div className="text-2xl font-semibold text-emerald-600">{formatTRY(summary.owed_total)}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Toplam Ödenmiş</div>
              <div className="text-2xl font-semibold">{formatTRY(summary.payouts_total)}</div>
            </CardContent></Card>
          </div>
        )}

        <Tabs defaultValue="schools" className="mt-2">
          <TabsList>
            <TabsTrigger value="schools">Okullar</TabsTrigger>
            <TabsTrigger value="earnings">Aylık Kazanç</TabsTrigger>
            <TabsTrigger value="bonuses">Bonuslar</TabsTrigger>
            <TabsTrigger value="payouts">Ödemeler</TabsTrigger>
          </TabsList>

          <TabsContent value="schools" className="space-y-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-xs">Okul Ata</Label>
                <Select value={assignSchoolId} onValueChange={setAssignSchoolId}>
                  <SelectTrigger><SelectValue placeholder="Atanmamış bir okul seçin" /></SelectTrigger>
                  <SelectContent>
                    {unassignedSchools.length === 0 && (
                      <div className="p-2 text-sm text-muted-foreground">Atanabilir okul yok</div>
                    )}
                    {unassignedSchools.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} {s.province ? `— ${s.province}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={assignSchool} disabled={!assignSchoolId}>
                <Plus className="mr-2 h-4 w-4" />Ata
              </Button>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Okul</TableHead>
                    <TableHead>İl/İlçe</TableHead>
                    <TableHead className="w-32 text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allSchools.filter((s) => s.marketer_id === marketerId).length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-4">
                      Henüz atanmış okul yok
                    </TableCell></TableRow>
                  )}
                  {allSchools.filter((s) => s.marketer_id === marketerId).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[s.province, s.district].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => unassign(s.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="earnings" className="space-y-3">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="text-sm font-medium">Aylık Komisyon Geliri Gir</div>
                <div className="grid md:grid-cols-5 gap-2">
                  <div>
                    <Label className="text-xs">Okul</Label>
                    <Select value={eForm.school_id} onValueChange={(v) => setEForm({ ...eForm, school_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Okul seçin" /></SelectTrigger>
                      <SelectContent>
                        {mySchools.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Yıl</Label>
                    <Input type="number" value={eForm.year}
                      onChange={(e) => setEForm({ ...eForm, year: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-xs">Ay</Label>
                    <Select value={String(eForm.month)} onValueChange={(v) => setEForm({ ...eForm, month: Number(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTH_NAMES_TR.map((n, i) =>
                          <SelectItem key={i+1} value={String(i+1)}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Sizin Komisyon Geliriniz (₺)</Label>
                    <Input type="number" min="0" step="0.01" value={eForm.commission_amount}
                      onChange={(e) => setEForm({ ...eForm, commission_amount: e.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={upsertEarning} className="w-full">Kaydet</Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dönem</TableHead>
                    <TableHead>Okul</TableHead>
                    <TableHead className="text-right">Komisyon</TableHead>
                    <TableHead className="text-right">Oran</TableHead>
                    <TableHead className="text-right">Pazarlamacı Payı</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="text-right w-40">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {earnings.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-4">
                      Henüz kayıt yok
                    </TableCell></TableRow>
                  )}
                  {earnings.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{MONTH_NAMES_TR[e.period_month-1]} {e.period_year}</TableCell>
                      <TableCell>{e.school_name}</TableCell>
                      <TableCell className="text-right">{formatTRY(e.commission_amount)}</TableCell>
                      <TableCell className="text-right">{formatPercent(e.share_rate)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatTRY(e.share_amount)}</TableCell>
                      <TableCell>{statusBadge(e.status)}</TableCell>
                      <TableCell className="text-right">
                        <Select value={e.status} onValueChange={(v) => setEarningStatus(e.id, v)}>
                          <SelectTrigger className="h-8 w-32 inline-flex"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Beklemede</SelectItem>
                            <SelectItem value="approved">Onayla</SelectItem>
                            <SelectItem value="paid">Ödendi</SelectItem>
                            <SelectItem value="cancelled">İptal</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="icon" variant="ghost" onClick={() => removeEarning(e.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="bonuses" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Bonus, pazarlamacıya bir okul atadığınız anda 'beklemede' olarak oluşur. Onayladıktan sonra ödenecekler bakiyesine eklenir.
            </p>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Okul</TableHead>
                    <TableHead className="text-right">Tutar</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="text-right w-40">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bonuses.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-4">
                      Henüz bonus kaydı yok
                    </TableCell></TableRow>
                  )}
                  {bonuses.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.school_name}</TableCell>
                      <TableCell className="text-right font-semibold">{formatTRY(b.amount)}</TableCell>
                      <TableCell>{statusBadge(b.status)}</TableCell>
                      <TableCell className="text-right">
                        <Select value={b.status} onValueChange={(v) => setBonusStatus(b.id, v)}>
                          <SelectTrigger className="h-8 w-32 inline-flex"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Beklemede</SelectItem>
                            <SelectItem value="approved">Onayla</SelectItem>
                            <SelectItem value="paid">Ödendi</SelectItem>
                            <SelectItem value="cancelled">İptal</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="payouts" className="space-y-3">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="text-sm font-medium">Ödeme Kaydet</div>
                <div className="grid md:grid-cols-5 gap-2">
                  <div>
                    <Label className="text-xs">Tutar (₺)</Label>
                    <Input type="number" min="0" step="0.01" value={pForm.amount}
                      onChange={(e) => setPForm({ ...pForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Yöntem</Label>
                    <Input value={pForm.method}
                      onChange={(e) => setPForm({ ...pForm, method: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Referans</Label>
                    <Input value={pForm.reference}
                      onChange={(e) => setPForm({ ...pForm, reference: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Not</Label>
                    <Input value={pForm.note}
                      onChange={(e) => setPForm({ ...pForm, note: e.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={recordPayout} className="w-full">
                      <Check className="mr-2 h-4 w-4" />Kaydet
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tarih</TableHead>
                    <TableHead className="text-right">Tutar</TableHead>
                    <TableHead>Yöntem</TableHead>
                    <TableHead>Referans / Not</TableHead>
                    <TableHead className="text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-4">
                      Henüz ödeme yok
                    </TableCell></TableRow>
                  )}
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.paid_at).toLocaleDateString("tr-TR")}</TableCell>
                      <TableCell className="text-right font-semibold">{formatTRY(p.amount)}</TableCell>
                      <TableCell>{p.method ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[p.reference, p.note].filter(Boolean).join(" — ") || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => removePayout(p.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
