import { useEffect, useMemo, useState } from "react";
import { Loader2, HandHeart, Plus, Pencil, Trash2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

interface School { id: string; name: string; }
interface Manager {
  id: string; school_id: string; school_name: string;
  full_name: string; phone: string; is_active: boolean;
  last_login_at: string | null; created_at: string;
}
interface Pool {
  school_id: string; school_name: string;
  balance: string | number; total_received: string | number; total_distributed: string | number;
}

async function dbProxy<T = any>(op: string, params: any = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  return (data?.data ?? data) as T;
}

export default function DonationManagersManager() {
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Manager> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, m, p] = await Promise.all([
        dbProxy<School[]>("list_schools"),
        dbProxy<Manager[]>("list_donation_managers"),
        dbProxy<Pool[]>("list_donation_pools"),
      ]);
      setSchools(s); setManagers(m); setPools(p);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const totalPool = useMemo(
    () => pools.reduce((acc, p) => acc + Number(p.balance), 0),
    [pools],
  );

  const save = async () => {
    if (!editing?.school_id || !editing?.full_name?.trim() || !editing?.phone?.trim()) {
      toast({ title: "Eksik alan", description: "Okul, ad ve telefon zorunlu", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      await dbProxy("upsert_donation_manager", {
        id: editing.id,
        school_id: editing.school_id,
        full_name: editing.full_name.trim(),
        phone: editing.phone.trim(),
        is_active: editing.is_active ?? true,
      });
      toast({ title: editing.id ? "Güncellendi" : "Eklendi" });
      setEditing(null);
      load();
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const remove = async (m: Manager) => {
    if (!confirm(`${m.full_name} silinsin mi?`)) return;
    try {
      await dbProxy("delete_donation_manager", { id: m.id });
      toast({ title: "Silindi" });
      load();
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <HandHeart className="h-5 w-5 text-primary" /> Bağış Havuzları
          </CardTitle>
          <Badge variant="secondary" className="text-sm">Toplam: {fmtTL(totalPool)}</Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : pools.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Okul yok.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {pools.map((p) => (
                <div key={p.school_id} className="rounded-lg border bg-card p-3">
                  <div className="truncate font-semibold">{p.school_name}</div>
                  <div className="mt-1 text-2xl font-bold text-primary">{fmtTL(p.balance)}</div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>Toplanan: {fmtTL(p.total_received)}</span>
                    <span>Dağıtılan: {fmtTL(p.total_distributed)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Bağış Yöneticileri</CardTitle>
          <Button size="sm" onClick={() => setEditing({ is_active: true })}>
            <Plus className="h-4 w-4" /> Yeni
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : managers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Henüz bağış yöneticisi eklenmedi. Eklediğiniz kişi <code>/bagis-yonetici-giris</code> üzerinden telefon + SMS ile giriş yapabilir.
            </p>
          ) : (
            <div className="space-y-2">
              {managers.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{m.full_name}</span>
                      {!m.is_active && <Badge variant="outline" className="text-[10px]">Pasif</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" /> {m.phone}
                      <span>•</span>
                      <span className="truncate">{m.school_name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(m)} aria-label="Düzenle">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(m)} aria-label="Sil"
                      className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Yöneticiyi Düzenle" : "Yeni Bağış Yöneticisi"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Okul</Label>
                <Select
                  value={editing.school_id ?? ""}
                  onValueChange={(v) => setEditing({ ...editing, school_id: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Okul seçin" /></SelectTrigger>
                  <SelectContent>
                    {schools.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ad Soyad</Label>
                <Input value={editing.full_name ?? ""} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input
                  inputMode="tel"
                  placeholder="5XX XXX XX XX"
                  value={editing.phone ?? ""}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="font-medium">Aktif</Label>
                  <p className="text-xs text-muted-foreground">Pasif yöneticiler giriş yapamaz</p>
                </div>
                <Switch
                  checked={editing.is_active ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>İptal</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
