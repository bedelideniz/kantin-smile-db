import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, Trash2, RefreshCw, Send, Upload } from "lucide-react";
import StudentImportDialog from "@/components/admin/StudentImportDialog";

interface School {
  id: string;
  name: string;
  province: string | null;
  district: string | null;
  admin_full_name: string;
  admin_phone: string;
  min_topup_amount: number | string;
  commission_rate: number | string;
  commission_free_after_days: number;
  payout_hold_days: number;
  is_active: boolean;
  created_at: string;
}

interface FormState {
  id?: string;
  name: string;
  province: string;
  district: string;
  admin_full_name: string;
  admin_phone: string;
  min_topup_amount: string;
  commission_rate: string;
  commission_free_after_days: string;
  payout_hold_days: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: "",
  province: "",
  district: "",
  admin_full_name: "",
  admin_phone: "",
  min_topup_amount: "50",
  commission_rate: "5",
  commission_free_after_days: "7",
  payout_hold_days: "1",
  is_active: true,
};

async function callOp<T = unknown>(op: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", {
    body: { op, params },
  });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  }
  return (data as { data: T }).data;
}

export default function SchoolsManager() {
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importTarget, setImportTarget] = useState<School | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await callOp<School[]>("list_schools");
      setSchools(rows);
    } catch (e) {
      toast({ title: "Yükleme hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (s: School) => {
    setForm({
      id: s.id,
      name: s.name,
      province: s.province ?? "",
      district: s.district ?? "",
      admin_full_name: s.admin_full_name,
      admin_phone: s.admin_phone,
      min_topup_amount: String(s.min_topup_amount),
      commission_rate: String(+(Number(s.commission_rate) * 100).toFixed(4)),
      commission_free_after_days: String(s.commission_free_after_days),
      payout_hold_days: String(s.payout_hold_days ?? 1),
      is_active: s.is_active,
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        province: form.province.trim() || null,
        district: form.district.trim() || null,
        admin_full_name: form.admin_full_name.trim(),
        admin_phone: form.admin_phone.trim(),
        min_topup_amount: Number(form.min_topup_amount),
        commission_rate: +(Number(form.commission_rate) / 100).toFixed(6),
        commission_free_after_days: Number(form.commission_free_after_days),
        payout_hold_days: Number(form.payout_hold_days),
        is_active: form.is_active,
      };
      if (form.id) {
        await callOp("update_school", { id: form.id, ...payload });
        toast({ title: "Okul güncellendi" });
      } else {
        const res = await callOp<{ sms?: { ok: boolean; status: string } }>("create_school", payload);
        const sms = res?.sms;
        toast({
          title: "Okul oluşturuldu",
          description: sms?.ok
            ? "Yöneticiye SMS giriş kodu gönderildi."
            : `SMS gönderilemedi (${sms?.status ?? "bilinmiyor"}). NetGSM ayarlarını kontrol edin.`,
          variant: sms?.ok ? "default" : "destructive",
        });
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast({ title: "Kayıt hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: School) => {
    try {
      await callOp("toggle_school_active", { id: s.id, is_active: !s.is_active });
      setSchools((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_active: !s.is_active } : x)));
    } catch (e) {
      toast({ title: "Durum değiştirilemedi", description: (e as Error).message, variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await callOp("delete_school", { id: deleteId });
      toast({ title: "Okul silindi" });
      setSchools((prev) => prev.filter((x) => x.id !== deleteId));
    } catch (e) {
      toast({ title: "Silme hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleteId(null);
    }
  };

  const resendOtp = async (s: School) => {
    try {
      const r = await callOp<{ ok: boolean; status: string; raw: string }>("resend_admin_otp", { school_id: s.id });
      toast({
        title: r.ok ? "SMS gönderildi" : "SMS gönderilemedi",
        description: `Durum: ${r.status}${r.raw ? ` — ${r.raw}` : ""}`,
        variant: r.ok ? "default" : "destructive",
      });
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Okullar</h2>
          <p className="text-sm text-muted-foreground">
            Sisteme kayıtlı okulları yönetin.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Yenile
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Yeni Okul
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Okul</TableHead>
              <TableHead>İl / İlçe</TableHead>
              <TableHead>Yönetici</TableHead>
              <TableHead>Komisyon</TableHead>
              <TableHead>Min. Yükleme</TableHead>
              <TableHead>Aktif</TableHead>
              <TableHead className="text-right">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Yükleniyor…
                </TableCell>
              </TableRow>
            )}
            {!loading && schools.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Henüz okul yok. "Yeni Okul" ile başlayın.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              schools.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[s.province, s.district].filter(Boolean).join(" / ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{s.admin_full_name}</div>
                    <div className="text-xs text-muted-foreground">{s.admin_phone}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {(Number(s.commission_rate) * 100).toFixed(2)}%
                    <div className="text-xs text-muted-foreground">
                      {s.commission_free_after_days} gün muaf
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    ₺{Number(s.min_topup_amount).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Switch checked={s.is_active} onCheckedChange={() => toggleActive(s)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title="Excel ile öğrenci yükle" onClick={() => setImportTarget(s)}>
                      <Upload className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Yöneticiye SMS kodu gönder" onClick={() => resendOtp(s)}>
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Düzenle" onClick={() => openEdit(s)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Sil"
                      onClick={() => setDeleteId(s.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Okulu Düzenle" : "Yeni Okul"}</DialogTitle>
            <DialogDescription>
              Okul bilgilerini ve komisyon ayarlarını girin.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Okul Adı *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="province">İl</Label>
              <Input
                id="province"
                value={form.province}
                onChange={(e) => setForm({ ...form, province: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="district">İlçe</Label>
              <Input
                id="district"
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_full_name">Yönetici Adı *</Label>
              <Input
                id="admin_full_name"
                value={form.admin_full_name}
                onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin_phone">Yönetici Telefonu *</Label>
              <Input
                id="admin_phone"
                value={form.admin_phone}
                onChange={(e) => setForm({ ...form, admin_phone: e.target.value })}
                placeholder="05XX XXX XX XX"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="min_topup_amount">Min. Yükleme (₺)</Label>
              <Input
                id="min_topup_amount"
                type="number"
                step="0.01"
                value={form.min_topup_amount}
                onChange={(e) => setForm({ ...form, min_topup_amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commission_rate">Komisyon Oranı (%)</Label>
              <Input
                id="commission_rate"
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={form.commission_rate}
                onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Yüzde olarak girin. Örn. 5 = %5
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commission_free_after_days">Komisyon Muaf Gün</Label>
              <Input
                id="commission_free_after_days"
                type="number"
                value={form.commission_free_after_days}
                onChange={(e) =>
                  setForm({ ...form, commission_free_after_days: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout_hold_days">Kantin Ödeme Blokesi (gün)</Label>
              <Input
                id="payout_hold_days"
                type="number"
                min={0}
                value={form.payout_hold_days}
                onChange={(e) => setForm({ ...form, payout_hold_days: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                0 = ertesi gün, 7 = bir hafta sonra
              </p>
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="is_active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label htmlFor="is_active">Aktif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              İptal
            </Button>
            <Button onClick={submit} disabled={saving || !form.name || !form.admin_full_name || !form.admin_phone}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Okulu silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>
              Bu işlem geri alınamaz. Okula bağlı veriler de etkilenebilir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {importTarget && (
        <StudentImportDialog
          schoolId={importTarget.id}
          schoolName={importTarget.name}
          open={!!importTarget}
          onOpenChange={(o) => !o && setImportTarget(null)}
        />
      )}
    </div>
  );
}
