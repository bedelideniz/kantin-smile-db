import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ShieldCheck, Pencil } from "lucide-react";
import { callAdminApi, MODULE_LABELS, type AppModule } from "@/lib/adminApi";

interface Staff {
  user_id: string;
  email: string | null;
  modules: AppModule[];
  is_owner: boolean;
  created_at: string;
}

const ALL_MODULES = Object.keys(MODULE_LABELS) as AppModule[];

export default function StaffManager() {
  const { toast } = useToast();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callAdminApi<{ staff: Staff[] }>("list_staff");
      setStaff(r.staff);
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (s: Staff) => {
    try {
      await callAdminApi("delete_staff", { user_id: s.user_id });
      toast({ title: "Silindi", description: s.email });
      load();
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Personel
          </h2>
          <p className="text-sm text-muted-foreground">
            Süperadmin paneline modül bazlı erişimi olan kullanıcılar.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" /> Yeni Personel</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Yükleniyor…</div>
          ) : staff.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Kayıt yok.</div>
          ) : (
            <div className="divide-y">
              {staff.map((s) => (
                <div key={s.user_id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{s.email ?? s.user_id}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.is_owner ? (
                        <Badge variant="default">Sahip — tüm modüller</Badge>
                      ) : (
                        s.modules.map((m) => (
                          <Badge key={m} variant="secondary">{MODULE_LABELS[m]}</Badge>
                        ))
                      )}
                    </div>
                  </div>
                  {!s.is_owner && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Yetkiler
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive">
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Sil
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Personeli sil</AlertDialogTitle>
                            <AlertDialogDescription>
                              {s.email} hesabı kalıcı olarak silinecek.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(s)}>Sil</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateStaffDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      {editing && (
        <EditModulesDialog
          staff={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function CreateStaffDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [modules, setModules] = useState<Set<AppModule>>(new Set());
  const [saving, setSaving] = useState(false);

  const reset = () => { setEmail(""); setPassword(""); setModules(new Set()); };

  const submit = async () => {
    if (modules.size === 0) {
      toast({ title: "En az bir modül seçin", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      await callAdminApi("create_staff", {
        email, password, modules: Array.from(modules),
      });
      toast({ title: "Personel oluşturuldu", description: email });
      reset(); onOpenChange(false); onCreated();
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni süperadmin personeli</DialogTitle>
          <DialogDescription>
            E-posta + şifre ile giriş yapacak yeni bir yetkili kullanıcı oluşturun.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>E-posta</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Şifre (en az 8 karakter)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} />
          </div>
          <div>
            <Label>Modül yetkileri</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ALL_MODULES.map((m) => (
                <label key={m} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent">
                  <Checkbox
                    checked={modules.has(m)}
                    onCheckedChange={(v) => {
                      const ns = new Set(modules);
                      if (v) ns.add(m); else ns.delete(m);
                      setModules(ns);
                    }}
                  />
                  <span className="text-sm">{MODULE_LABELS[m]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button onClick={submit} disabled={saving || !email || password.length < 8 || modules.size === 0}>
            {saving ? "Oluşturuluyor…" : "Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditModulesDialog({ staff, onClose, onSaved }: {
  staff: Staff; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [modules, setModules] = useState<Set<AppModule>>(new Set(staff.modules));
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (modules.size === 0) {
      toast({ title: "En az bir modül seçin", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      await callAdminApi("update_staff_modules", { user_id: staff.user_id, modules: Array.from(modules) });
      toast({ title: "Yetkiler güncellendi" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yetkileri düzenle</DialogTitle>
          <DialogDescription>{staff.email}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {ALL_MODULES.map((m) => (
            <label key={m} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent">
              <Checkbox
                checked={modules.has(m)}
                onCheckedChange={(v) => {
                  const ns = new Set(modules);
                  if (v) ns.add(m); else ns.delete(m);
                  setModules(ns);
                }}
              />
              <span className="text-sm">{MODULE_LABELS[m]}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={submit} disabled={saving}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
