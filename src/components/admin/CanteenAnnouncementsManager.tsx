import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Image as ImageIcon, Loader2, Pencil, Trash2, Upload, Megaphone } from "lucide-react";

interface Row {
  school_id: string;
  school_name: string;
  slot: number | null;
  image_url: string | null;
  title: string | null;
  is_active: boolean | null;
  updated_at: string | null;
}

interface SlotData {
  slot: number;
  image_url: string | null;
  title: string | null;
  is_active: boolean | null;
}

interface SchoolGroup {
  school_id: string;
  school_name: string;
  slots: Map<number, SlotData>;
}

async function callOp<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  return data?.data as T;
}

const SLOTS = [1, 2, 3, 4] as const;

export default function CanteenAnnouncementsManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ schoolId: string; schoolName: string; slot: number; current: SlotData | null } | null>(null);
  const [deleting, setDeleting] = useState<{ schoolId: string; schoolName: string; slot: number } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callOp<Row[]>("list_canteen_announcements");
      setRows(r);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const groups = useMemo<SchoolGroup[]>(() => {
    const map = new Map<string, SchoolGroup>();
    for (const r of rows) {
      let g = map.get(r.school_id);
      if (!g) {
        g = { school_id: r.school_id, school_name: r.school_name, slots: new Map() };
        map.set(r.school_id, g);
      }
      if (r.slot != null) {
        g.slots.set(r.slot, {
          slot: r.slot,
          image_url: r.image_url,
          title: r.title,
          is_active: r.is_active,
        });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  useEffect(() => {
    if (!selectedSchool && groups.length > 0) setSelectedSchool(groups[0].school_id);
  }, [groups, selectedSchool]);

  const current = groups.find((g) => g.school_id === selectedSchool) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone className="h-5 w-5" /> Kantin Duyuru Görselleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Kasiyer paneli sol tarafında gösterilecek 4 duyuru görselini okul bazlı yönetin.
          </p>
        </div>
        <div className="min-w-[260px]">
          <Label className="text-xs text-muted-foreground">Okul</Label>
          <Select value={selectedSchool ?? ""} onValueChange={setSelectedSchool}>
            <SelectTrigger>
              <SelectValue placeholder="Okul seçin" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.school_id} value={g.school_id}>{g.school_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent></Card>
      ) : !current ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Okul yok.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SLOTS.map((slot) => {
            const s = current.slots.get(slot) ?? null;
            return (
              <Card key={slot} className="overflow-hidden">
                <div className="flex aspect-[3/4] items-center justify-center bg-muted relative">
                  {s?.image_url ? (
                    <img src={s.image_url} alt={s.title ?? `Slot ${slot}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ImageIcon className="h-10 w-10 opacity-40" />
                      <span className="text-xs">Boş</span>
                    </div>
                  )}
                  <Badge className="absolute left-2 top-2" variant="secondary">#{slot}</Badge>
                  {s?.image_url && (
                    s.is_active ? (
                      <Badge className="absolute right-2 top-2">Aktif</Badge>
                    ) : (
                      <Badge className="absolute right-2 top-2" variant="outline">Pasif</Badge>
                    )
                  )}
                </div>
                <CardContent className="space-y-2 p-3">
                  {s?.title && <p className="truncate text-sm font-medium">{s.title}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1"
                      onClick={() => setEditing({ schoolId: current.school_id, schoolName: current.school_name, slot, current: s })}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> {s ? "Düzenle" : "Ekle"}
                    </Button>
                    {s?.image_url && (
                      <Button size="sm" variant="ghost"
                        onClick={() => setDeleting({ schoolId: current.school_id, schoolName: current.school_name, slot })}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SlotEditDialog
        open={!!editing}
        data={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Duyuru silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleting?.schoolName}</strong> okulunun #{deleting?.slot} duyurusu kaldırılacak.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleting) return;
                try {
                  await callOp("delete_canteen_announcement", { school_id: deleting.schoolId, slot: deleting.slot });
                  toast({ title: "Silindi" });
                  setDeleting(null);
                  load();
                } catch (e: any) {
                  toast({ title: "Silinemedi", description: e?.message, variant: "destructive" });
                }
              }}
            >Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SlotEditDialog({ open, data, onClose, onSaved }: {
  open: boolean;
  data: { schoolId: string; schoolName: string; slot: number; current: SlotData | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [title, setTitle] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setImageUrl(data.current?.image_url ?? "");
      setTitle(data.current?.title ?? "");
      setIsActive(data.current?.is_active ?? true);
    }
  }, [data]);

  if (!data) return null;

  const onPickFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Geçersiz dosya", description: "Lütfen bir görsel seçin.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Dosya çok büyük", description: "Maksimum 5 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${data.schoolId}/slot-${data.slot}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("canteen-announcements")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("canteen-announcements").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
      toast({ title: "Görsel yüklendi" });
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!imageUrl) {
      toast({ title: "Görsel gerekli", description: "Önce bir görsel yükleyin.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await callOp("upsert_canteen_announcement", {
        school_id: data.schoolId,
        slot: data.slot,
        image_url: imageUrl,
        title: title.trim() || null,
        is_active: isActive,
      });
      toast({ title: "Kaydedildi" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{data.schoolName} — Duyuru #{data.slot}</DialogTitle>
          <DialogDescription>
            Kasiyer paneli sol tarafında gösterilecek görsel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Görsel</Label>
            {imageUrl && (
              <img src={imageUrl} alt="" className="max-h-56 w-full rounded border object-contain bg-muted" />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.currentTarget.value = "";
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {imageUrl ? "Görseli Değiştir" : "Görsel Yükle"}
            </Button>
            <p className="text-xs text-muted-foreground">Önerilen oran: 3:4 (dikey) — Maks 5 MB.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Başlık (opsiyonel)</Label>
            <Input
              id="title"
              type="text"
              maxLength={120}
              placeholder="Örn: Yeni menü, kampanya..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="active">Aktif</Label>
              <p className="text-xs text-muted-foreground">Pasif yapılırsa kasiyer panelde görünmez.</p>
            </div>
            <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={save} disabled={saving || uploading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
