import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, KeyRound, Pencil, Trash2 } from "lucide-react";

interface Cashier {
  id: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  has_pin: boolean;
  pin_updated_at: string | null;
  last_login_at: string | null;
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
const PIN_RE = /^\d{6}$/;

export default function CashiersManager() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Cashier[]>([]);

  // Create/edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Cashier | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset PIN dialog
  const [resetTarget, setResetTarget] = useState<Cashier | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [resetting, setResetting] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Cashier | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await callOp<Cashier[]>("list_cashiers");
      setRows(data ?? []);
    } catch (e) {
      toast({ title: "Yüklenemedi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFullName("");
    setPhone("");
    setPin("");
    setDialogOpen(true);
  };

  const openEdit = (c: Cashier) => {
    setEditing(c);
    setFullName(c.full_name);
    setPhone(c.phone);
    setPin("");
    setDialogOpen(true);
  };

  const submit = async () => {
    if (fullName.trim().length < 2) {
      toast({ title: "Geçersiz isim", description: "Ad-soyad en az 2 karakter olmalı.", variant: "destructive" });
      return;
    }
    if (!PHONE_RE.test(phone.trim())) {
      toast({ title: "Geçersiz telefon", description: "Geçerli bir telefon numarası girin.", variant: "destructive" });
      return;
    }
    if (!editing && !PIN_RE.test(pin)) {
      toast({ title: "Geçersiz PIN", description: "PIN tam 6 rakamdan oluşmalı.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await callOp("update_cashier", { id: editing.id, full_name: fullName.trim(), phone: phone.trim() });
        toast({ title: "Güncellendi", description: "Kasiyer bilgileri kaydedildi." });
      } else {
        await callOp("create_cashier", { full_name: fullName.trim(), phone: phone.trim(), pin });
        toast({ title: "Kasiyer eklendi", description: "Kasiyer telefon ve PIN ile giriş yapabilir." });
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: Cashier, next: boolean) => {
    try {
      await callOp("toggle_cashier_active", { id: c.id, is_active: next });
      setRows((r) => r.map((x) => (x.id === c.id ? { ...x, is_active: next } : x)));
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    if (!PIN_RE.test(resetPin)) {
      toast({ title: "Geçersiz PIN", description: "PIN tam 6 rakamdan oluşmalı.", variant: "destructive" });
      return;
    }
    setResetting(true);
    try {
      await callOp("reset_cashier_pin", { id: resetTarget.id, pin: resetPin });
      toast({ title: "PIN sıfırlandı", description: "Yeni PIN kasiyere iletilebilir." });
      setResetTarget(null);
      setResetPin("");
      await load();
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await callOp("delete_cashier", { id: deleteTarget.id });
      toast({ title: "Silindi", description: "Kasiyer kaldırıldı." });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Kasiyerler</CardTitle>
          <CardDescription>
            Kasiyerler telefon ve 6 haneli PIN ile giriş yapar. PIN'i kasiyere kendiniz iletmeniz gerekir.
          </CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Yeni Kasiyer
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Yükleniyor...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Henüz kasiyer eklenmemiş. "Yeni Kasiyer" ile başlayın.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad Soyad</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Son Giriş</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.full_name}</TableCell>
                  <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch checked={c.is_active} onCheckedChange={(v) => toggleActive(c, v)} />
                      <span className="text-xs text-muted-foreground">
                        {c.is_active ? "Aktif" : "Pasif"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.last_login_at ? new Date(c.last_login_at).toLocaleString("tr-TR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="Düzenle">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setResetTarget(c);
                          setResetPin("");
                        }}
                        title="PIN sıfırla"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(c)}
                        title="Sil"
                      >
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
            <DialogTitle>{editing ? "Kasiyeri Düzenle" : "Yeni Kasiyer"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Ad ve telefon bilgilerini güncelleyin. PIN değiştirmek için anahtar simgesini kullanın."
                : "Kasiyer bilgilerini ve 6 haneli giriş PIN'ini belirleyin."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="c-name">Ad Soyad</Label>
              <Input
                id="c-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ahmet Yılmaz"
                maxLength={120}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-phone">Telefon</Label>
              <Input
                id="c-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05551234567"
                maxLength={20}
                inputMode="tel"
              />
            </div>
            {!editing && (
              <div className="space-y-2">
                <Label htmlFor="c-pin">PIN (6 haneli)</Label>
                <Input
                  id="c-pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  inputMode="numeric"
                  maxLength={6}
                  className="font-mono tracking-widest"
                />
                <p className="text-xs text-muted-foreground">
                  Bu PIN'i kasiyere kendiniz iletmelisiniz; sistem SMS göndermez.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              İptal
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Kaydet" : "Ekle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset PIN dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PIN Sıfırla</DialogTitle>
            <DialogDescription>
              {resetTarget?.full_name} için yeni 6 haneli bir PIN belirleyin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="r-pin">Yeni PIN</Label>
            <Input
              id="r-pin"
              value={resetPin}
              onChange={(e) => setResetPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              maxLength={6}
              className="font-mono tracking-widest"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={resetting}>
              İptal
            </Button>
            <Button onClick={submitReset} disabled={resetting}>
              {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              PIN'i Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kasiyer silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.full_name} kalıcı olarak silinecek ve giriş yapamayacak. Bu işlem geri alınamaz.
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
