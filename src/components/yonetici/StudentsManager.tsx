import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useUsbCardReader } from "@/hooks/useUsbCardReader";
import { Loader2, Plus, Pencil, Trash2, CreditCard, Wallet, Radio, X, Search } from "lucide-react";

interface Student {
  id: string;
  full_name: string;
  class_name: string | null;
  student_no: string | null;
  parent_phone: string | null;
  balance: number | string;
  qr_token: string;
  nfc_uid: string | null;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
}

async function callOp<T = unknown>(op: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  }
  return (data as { data: T }).data;
}

const PHONE_RE = /^[0-9+\s()-]{10,20}$/;
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StudentsManager({ schoolId }: { schoolId?: string } = {}) {
  const scope = schoolId ? { school_id: schoolId } : {};
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Student[]>([]);
  const [search, setSearch] = useState("");

  // Create/edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [fullName, setFullName] = useState("");
  const [className, setClassName] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [initialBalance, setInitialBalance] = useState("");
  const [saving, setSaving] = useState(false);

  // Card assign dialog
  const [cardTarget, setCardTarget] = useState<Student | null>(null);
  const [scannedUid, setScannedUid] = useState("");
  const [assigningCard, setAssigningCard] = useState(false);

  // Top up dialog
  const [topupTarget, setTopupTarget] = useState<Student | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);

  // Photo upload (admin)
  const [photoTarget, setPhotoTarget] = useState<Student | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoDeleting, setPhotoDeleting] = useState(false);

  // USB reader: only listens while the card-assign dialog is open
  useUsbCardReader({
    enabled: !!cardTarget,
    onScan: (uid) => setScannedUid(uid),
  });

  const load = async (q?: string) => {
    setLoading(true);
    try {
      const data = await callOp<Student[]>("list_students", { ...scope, ...(q ? { query: q } : {}) });
      setRows(data ?? []);
    } catch (e) {
      toast({ title: "Yüklenemedi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [schoolId]);

  const openCreate = () => {
    setEditing(null);
    setFullName(""); setClassName(""); setStudentNo("");
    setParentPhone(""); setInitialBalance("");
    setDialogOpen(true);
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    setFullName(s.full_name);
    setClassName(s.class_name ?? "");
    setStudentNo(s.student_no ?? "");
    setParentPhone(s.parent_phone ?? "");
    setInitialBalance("");
    setDialogOpen(true);
  };

  const submit = async () => {
    if (fullName.trim().length < 2) {
      toast({ title: "Geçersiz isim", description: "Ad-soyad en az 2 karakter olmalı.", variant: "destructive" });
      return;
    }
    if (parentPhone.trim() && !PHONE_RE.test(parentPhone.trim())) {
      toast({ title: "Geçersiz veli telefonu", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const base = {
        full_name: fullName.trim(),
        class_name: className.trim() || null,
        student_no: studentNo.trim() || null,
        parent_phone: parentPhone.trim() || null,
      };
      if (editing) {
        await callOp("update_student", { ...scope, id: editing.id, ...base });
        toast({ title: "Güncellendi", description: "Öğrenci bilgileri kaydedildi." });
      } else {
        const balanceNum = initialBalance.trim() ? Number(initialBalance.replace(",", ".")) : 0;
        if (Number.isNaN(balanceNum) || balanceNum < 0) {
          toast({ title: "Geçersiz başlangıç bakiyesi", variant: "destructive" });
          setSaving(false);
          return;
        }
        await callOp("create_student", { ...scope, ...base, balance: balanceNum });
        toast({ title: "Öğrenci eklendi" });
      }
      setDialogOpen(false);
      await load(search);
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: Student, next: boolean) => {
    try {
      await callOp("toggle_student_active", { ...scope, id: s.id, is_active: next });
      setRows((r) => r.map((x) => (x.id === s.id ? { ...x, is_active: next } : x)));
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  const openAssignCard = (s: Student) => {
    setCardTarget(s);
    setScannedUid("");
  };

  const submitAssignCard = async () => {
    if (!cardTarget || !scannedUid) return;
    setAssigningCard(true);
    try {
      await callOp("set_student_nfc", { ...scope, id: cardTarget.id, nfc_uid: scannedUid });
      toast({ title: "Kart atandı", description: `${cardTarget.full_name} → ${scannedUid}` });
      setCardTarget(null); setScannedUid("");
      await load(search);
    } catch (e) {
      toast({ title: "Atanamadı", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAssigningCard(false);
    }
  };

  const removeCard = async (s: Student) => {
    try {
      await callOp("set_student_nfc", { ...scope, id: s.id, nfc_uid: null });
      toast({ title: "Kart kaldırıldı" });
      await load(search);
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  // Resize image to max 800x800 JPEG ~85% via canvas, return data URL.
  const resizeToJpeg = (file: File, maxDim = 800, quality = 0.85): Promise<string> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas oluşturulamadı"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görüntü okunamadı")); };
      img.src = url;
    });

  const onPhotoFileSelected = async (file: File) => {
    if (!photoTarget) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Geçersiz dosya", description: "Lütfen bir görüntü dosyası seçin.", variant: "destructive" });
      return;
    }
    setPhotoUploading(true);
    try {
      const dataUrl = await resizeToJpeg(file);
      const r = await callOp<{ id: string; photo_url: string }>("set_student_photo", {
        ...scope, id: photoTarget.id, image_base64: dataUrl,
      });
      toast({ title: "Fotoğraf güncellendi" });
      setRows((prev) => prev.map((s) => (s.id === r.id ? { ...s, photo_url: r.photo_url } : s)));
      setPhotoTarget(null);
    } catch (e) {
      toast({ title: "Yükleme başarısız", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  };

  const removePhoto = async () => {
    if (!photoTarget) return;
    setPhotoDeleting(true);
    try {
      await callOp("delete_student_photo", { ...scope, id: photoTarget.id });
      toast({ title: "Fotoğraf silindi" });
      setRows((prev) => prev.map((s) => (s.id === photoTarget.id ? { ...s, photo_url: null } : s)));
      setPhotoTarget(null);
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPhotoDeleting(false);
    }
  };

  const submitTopup = async () => {
    if (!topupTarget) return;
    const amt = Number(topupAmount.replace(",", "."));
    if (Number.isNaN(amt) || amt === 0) {
      toast({ title: "Geçersiz tutar", description: "Pozitif veya negatif bir miktar girin.", variant: "destructive" });
      return;
    }
    setToppingUp(true);
    try {
      const r = await callOp<{ balance_after: number }>("adjust_student_balance", { ...scope, id: topupTarget.id, delta: amt });
      toast({ title: "Bakiye güncellendi", description: `Yeni bakiye: ${fmt(Number(r.balance_after))} ₺` });
      setTopupTarget(null); setTopupAmount("");
      await load(search);
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    } finally {
      setToppingUp(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await callOp("delete_student", { ...scope, id: deleteTarget.id });
      toast({ title: "Silindi" });
      setDeleteTarget(null);
      await load(search);
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Veli & Öğrenci</CardTitle>
          <CardDescription>
            Öğrenci kayıtları ve veli telefonları. Kart atamak için satırdaki kart simgesine tıklayıp USB okuyucuya kart okutun.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(search)}
              placeholder="İsim, no, veli telefonu, kart"
              className="w-56 pl-8"
            />
          </div>
          <Button variant="outline" onClick={() => load(search)}>Ara</Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Yeni Öğrenci
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Yükleniyor...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Henüz öğrenci yok. "Yeni Öğrenci" ile ekleyin.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Foto</TableHead>
                <TableHead>Ad Soyad</TableHead>
                <TableHead>Sınıf / No</TableHead>
                <TableHead>Veli Telefonu</TableHead>
                <TableHead>Bakiye</TableHead>
                <TableHead>Kart</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.photo_url ? (
                      <a href={s.photo_url} target="_blank" rel="noreferrer">
                        <img
                          src={s.photo_url}
                          alt={s.full_name}
                          className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                        Yok
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{s.full_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.class_name ?? "—"}{s.student_no ? ` • #${s.student_no}` : ""}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{s.parent_phone ?? "—"}</TableCell>
                  <TableCell className="font-semibold">{fmt(Number(s.balance))} ₺</TableCell>
                  <TableCell>
                    {s.nfc_uid ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="font-mono text-[10px]">{s.nfc_uid}</Badge>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeCard(s)} title="Kartı kaldır">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="outline">Atanmamış</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={s.is_active} onCheckedChange={(v) => toggleActive(s, v)} />
                      <span className="text-xs text-muted-foreground">{s.is_active ? "Aktif" : "Pasif"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openAssignCard(s)} title="Kart ata">
                        <CreditCard className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setTopupTarget(s); setTopupAmount(""); }} title="Bakiye düzelt">
                        <Wallet className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(s)} title="Düzenle">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(s)} title="Sil">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Öğrenciyi Düzenle" : "Yeni Öğrenci"}</DialogTitle>
            <DialogDescription>
              Veli telefonu ile veli, ileride bu numara üzerinden mobil uygulamadan giriş yapabilecek.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="s-name">Ad Soyad *</Label>
              <Input id="s-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ahmet Yılmaz" maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-class">Sınıf</Label>
              <Input id="s-class" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="6-A" maxLength={50} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-no">Öğrenci No</Label>
              <Input id="s-no" value={studentNo} onChange={(e) => setStudentNo(e.target.value)} placeholder="1234" maxLength={50} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="s-parent">Veli Telefonu</Label>
              <Input id="s-parent" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="05551234567" inputMode="tel" maxLength={20} />
            </div>
            {!editing && (
              <div className="col-span-2 space-y-2">
                <Label htmlFor="s-bal">Başlangıç Bakiyesi (₺)</Label>
                <Input id="s-bal" value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>İptal</Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Kaydet" : "Ekle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign card dialog */}
      <Dialog open={!!cardTarget} onOpenChange={(o) => !o && setCardTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kart Ata</DialogTitle>
            <DialogDescription>
              {cardTarget?.full_name} için USB okuyucuya kartı okutun.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center ${
              scannedUid ? "border-primary bg-primary/5" : "border-muted bg-muted/30"
            }`}>
              <div className={`flex h-14 w-14 items-center justify-center rounded-full ${
                scannedUid ? "bg-primary/10" : "bg-muted animate-pulse"
              }`}>
                <Radio className={`h-7 w-7 ${scannedUid ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              {scannedUid ? (
                <>
                  <p className="mt-3 text-sm">Okunan kart UID:</p>
                  <p className="mt-1 font-mono text-lg font-bold tracking-wider">{scannedUid}</p>
                </>
              ) : (
                <>
                  <p className="mt-3 font-semibold">Kart bekleniyor...</p>
                  <p className="mt-1 text-xs text-muted-foreground">Kartı USB okuyucuya yaklaştırın</p>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-uid">veya UID'yi elle girin</Label>
              <Input
                id="manual-uid"
                value={scannedUid}
                onChange={(e) => setScannedUid(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="Örn. A1B2C3D4"
                className="font-mono"
                maxLength={64}
              />
            </div>
            {cardTarget?.nfc_uid && (
              <p className="text-xs text-muted-foreground">
                Mevcut kart: <span className="font-mono">{cardTarget.nfc_uid}</span> (üzerine yazılacak)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCardTarget(null)} disabled={assigningCard}>İptal</Button>
            <Button onClick={submitAssignCard} disabled={!scannedUid || scannedUid.length < 4 || assigningCard}>
              {assigningCard && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kartı Ata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Top-up dialog */}
      <Dialog open={!!topupTarget} onOpenChange={(o) => !o && setTopupTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bakiye Düzelt</DialogTitle>
            <DialogDescription>
              {topupTarget?.full_name} • Mevcut: {topupTarget && fmt(Number(topupTarget.balance))} ₺
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="topup">Eklenecek tutar (negatif = düş)</Label>
            <Input
              id="topup"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              placeholder="50,00"
              inputMode="decimal"
            />
            <p className="text-xs text-muted-foreground">
              Manuel düzeltme içindir. Velinin online yüklemesi ayrı yapılacaktır.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopupTarget(null)} disabled={toppingUp}>İptal</Button>
            <Button onClick={submitTopup} disabled={toppingUp}>
              {toppingUp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Uygula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Öğrenci silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.full_name} kalıcı olarak silinecek. Geçmiş satışlar varsa silme başarısız olabilir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
