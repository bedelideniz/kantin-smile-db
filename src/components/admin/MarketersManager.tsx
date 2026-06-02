import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, Trash2, Eye, RefreshCw, FileText } from "lucide-react";
import { callMarketerApi, formatPercent, formatTRY, MarketerListItem } from "@/lib/marketerApi";
import MarketerDetailDialog from "./MarketerDetailDialog";
import { downloadMarketerContract } from "@/lib/contractPdf";

interface FormState {
  id?: string;
  full_name: string;
  email: string;
  phone: string;
  password: string;
  signup_bonus: string;
  commission_share_pct: string; // 0-100 in UI
  is_active: boolean;
  notes: string;
  tc_no: string;
  address: string;
  iban: string;
}

const emptyForm: FormState = {
  full_name: "", email: "", phone: "", password: "",
  signup_bonus: "0", commission_share_pct: "0", is_active: true, notes: "",
  tc_no: "", address: "", iban: "",
};

export default function MarketersManager() {
  const { toast } = useToast();
  const [list, setList] = useState<MarketerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MarketerListItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callMarketerApi<{ marketers: MarketerListItem[] }>("list_marketers");
      setList(r.marketers);
    } catch (e: any) {
      toast({ title: "Yükleme hatası", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm(emptyForm); setOpen(true); };
  const openEdit = (m: MarketerListItem) => {
    setForm({
      id: m.id, full_name: m.full_name, email: m.email, phone: m.phone ?? "",
      password: "", signup_bonus: String(m.signup_bonus),
      commission_share_pct: String((Number(m.commission_share_rate) * 100).toFixed(2)),
      is_active: m.is_active, notes: m.notes ?? "",
      tc_no: "", address: "", iban: "",
    });
    setOpen(true);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const share = Number(form.commission_share_pct) / 100;
      const bonus = Number(form.signup_bonus);
      if (Number.isNaN(share) || share < 0 || share > 1) throw new Error("Yüzde 0-100 arasında olmalı");
      if (Number.isNaN(bonus) || bonus < 0) throw new Error("Geçersiz bonus");
      if (form.id) {
        await callMarketerApi("update_marketer", {
          id: form.id, full_name: form.full_name.trim(), phone: form.phone.trim() || null,
          signup_bonus: bonus, commission_share_rate: share, is_active: form.is_active,
          notes: form.notes.trim() || null,
        });
      } else {
        if (form.password.length < 8) throw new Error("Şifre en az 8 karakter olmalı");
        if (!form.email.trim()) throw new Error("E-posta gerekli");
        await callMarketerApi("create_marketer", {
          full_name: form.full_name.trim(), email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || null, password: form.password,
          signup_bonus: bonus, commission_share_rate: share, notes: form.notes.trim() || null,
        });
        // Pazarlamacı oluşturulunca sözleşmeyi otomatik indir
        try {
          downloadMarketerContract({
            full_name: form.full_name.trim(),
            signup_bonus: bonus,
            commission_share_rate: share,
            tc_no: form.tc_no.trim(),
            address: form.address.trim(),
            iban: form.iban.trim(),
          });
        } catch (err) {
          console.error("Sözleşme oluşturulamadı:", err);
        }
      }
      toast({ title: form.id ? "Güncellendi" : "Pazarlamacı eklendi" });
      setOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: "Hata", description: e.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await callMarketerApi("delete_marketer", { id: confirmDelete.id });
      toast({ title: "Silindi" });
      setConfirmDelete(null);
      await load();
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pazarlamacılar</h2>
          <p className="text-sm text-muted-foreground">
            Satış temsilcisi hesaplarını yönetin, bonus ve kâr payı oranlarını belirleyin.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />Yenile
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />Yeni Pazarlamacı
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad Soyad</TableHead>
              <TableHead>E-posta</TableHead>
              <TableHead className="text-right">Bonus</TableHead>
              <TableHead className="text-right">Kâr %</TableHead>
              <TableHead className="text-right">Okul</TableHead>
              <TableHead className="text-right">Bekleyen</TableHead>
              <TableHead className="text-right">Ödenecek</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="w-32 text-right">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">
                {loading ? "Yükleniyor..." : "Henüz pazarlamacı yok."}
              </TableCell></TableRow>
            )}
            {list.map((m) => {
              const owed = Number(m.bonus_approved ?? 0) + Number(m.earnings_approved ?? 0);
              const pending = Number(m.earnings_pending ?? 0);
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.full_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                  <TableCell className="text-right">{formatTRY(m.signup_bonus)}</TableCell>
                  <TableCell className="text-right">{formatPercent(m.commission_share_rate)}</TableCell>
                  <TableCell className="text-right">{m.school_count}</TableCell>
                  <TableCell className="text-right text-amber-600">{formatTRY(pending)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatTRY(owed)}</TableCell>
                  <TableCell>
                    <Badge variant={m.is_active ? "default" : "secondary"}>
                      {m.is_active ? "Aktif" : "Pasif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Sözleşme indir"
                        onClick={() => downloadMarketerContract({
                          full_name: m.full_name,
                          signup_bonus: m.signup_bonus,
                          commission_share_rate: m.commission_share_rate,
                        })}>
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDetailId(m.id)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(m)}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Pazarlamacıyı Düzenle" : "Yeni Pazarlamacı"}</DialogTitle>
            <DialogDescription>
              Bonus, getirdiği her okul için tek seferlik ödenir. Kâr payı yüzdesi, sizin o okuldan elde ettiğiniz aylık komisyon geliri üzerinden hesaplanır.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Ad Soyad</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>E-posta</Label>
                <Input type="email" value={form.email} disabled={!!form.id}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Telefon</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            {!form.id && (
              <div className="grid gap-2">
                <Label>Şifre (en az 8 karakter)</Label>
                <Input type="password" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>Okul Başına Bonus (₺)</Label>
                <Input type="number" min="0" step="1" value={form.signup_bonus}
                  onChange={(e) => setForm({ ...form, signup_bonus: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Kâr Payı Yüzdesi (%)</Label>
                <Input type="number" min="0" max="100" step="0.01" value={form.commission_share_pct}
                  onChange={(e) => setForm({ ...form, commission_share_pct: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Notlar</Label>
              <Textarea rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {form.id && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>Aktif</Label>
                  <p className="text-xs text-muted-foreground">Pasif pazarlamacılar giriş yapamaz.</p>
                </div>
                <Switch checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pazarlamacıyı Sil</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.full_name} silinecek. Tüm okul atamaları, bonus, aylık kazanç ve ödeme kayıtları da silinir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailId && (
        <MarketerDetailDialog
          marketerId={detailId}
          marketerName={list.find((m) => m.id === detailId)?.full_name ?? ""}
          onClose={() => { setDetailId(null); load(); }}
        />
      )}
    </div>
  );
}
