import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Image as ImageIcon, Loader2, Pencil, Trash2, Upload, Link as LinkIcon, School, ChevronsUpDown, Check } from "lucide-react";

interface SplashRow {
  school_id: string;
  school_name: string;
  image_url: string | null;
  link_url: string | null;
  is_active: boolean | null;
  updated_at: string | null;
}

async function callOp<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  return data?.data as T;
}

const GLOBAL_KEY = "__global__";

export default function SchoolSplashesManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SplashRow[]>([]);
  const [globalSplash, setGlobalSplash] = useState<SplashRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<SplashRow | null>(null);
  const [deleting, setDeleting] = useState<SplashRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, g] = await Promise.all([
        callOp<SplashRow[]>("list_school_splashes"),
        callOp<{ school_id: string; school_name: string; image_url: string | null; link_url: string | null; is_active: boolean | null; updated_at: string | null } | null>("get_global_splash"),
      ]);
      setRows(r);
      setGlobalSplash(g ? { ...g, school_id: GLOBAL_KEY, school_name: "Tüm Okullar" } : null);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const allRows = useMemo(() => {
    const globalRow: SplashRow = globalSplash ?? {
      school_id: GLOBAL_KEY,
      school_name: "Tüm Okullar",
      image_url: null,
      link_url: null,
      is_active: null,
      updated_at: null,
    };
    return [globalRow, ...rows];
  }, [rows, globalSplash]);

  const current = allRows.find((r) => r.school_id === selectedSchool) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Veli Splash Ekranları</h2>
        <p className="text-sm text-muted-foreground">
          Her okul için veli giriş sonrasında günde bir kez gösterilecek reklam görselini yönetin.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <Label className="text-xs text-muted-foreground">Önce okul seçin</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                className="mt-1 w-full justify-between font-normal"
              >
                <span className="flex items-center gap-2 truncate">
                  <School className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {current ? (
                    <>
                      <span className="truncate">{current.school_name}</span>
                      {current.image_url && (
                        current.is_active
                          ? <Badge className="ml-1">Aktif</Badge>
                          : <Badge variant="secondary" className="ml-1">Pasif</Badge>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Okul seçin…</span>
                  )}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Okul ara..." />
                <CommandList>
                  <CommandEmpty>Okul bulunamadı.</CommandEmpty>
                  <CommandGroup>
                    {rows.map((r) => (
                      <CommandItem
                        key={r.school_id}
                        value={r.school_name}
                        onSelect={() => { setSelectedSchool(r.school_id); setPickerOpen(false); }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", selectedSchool === r.school_id ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 truncate">{r.school_name}</span>
                        {r.image_url == null ? (
                          <Badge variant="outline" className="ml-2">Tanımsız</Badge>
                        ) : r.is_active ? (
                          <Badge className="ml-2">Aktif</Badge>
                        ) : (
                          <Badge variant="secondary" className="ml-2">Pasif</Badge>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </CardContent>
      </Card>

      {loading ? (
        <Card><CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent></Card>
      ) : !current ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Splash ekranını görüntülemek için yukarıdan bir okul seçin.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{current.school_name}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {current.image_url == null ? (
                    <Badge variant="outline">Tanımsız</Badge>
                  ) : current.is_active ? (
                    <Badge>Aktif</Badge>
                  ) : (
                    <Badge variant="secondary">Pasif</Badge>
                  )}
                  {current.link_url && (
                    <a href={current.link_url} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 truncate text-primary hover:underline">
                      <LinkIcon className="h-3 w-3" /> {current.link_url}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(current)}>
                  <Pencil className="mr-1 h-4 w-4" /> {current.image_url ? "Düzenle" : "Ekle"}
                </Button>
                {current.image_url && (
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(current)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>

            {current.image_url ? (
              <img src={current.image_url} alt="" className="mx-auto max-h-[60vh] rounded border bg-muted object-contain" />
            ) : (
              <div className="flex h-48 flex-col items-center justify-center gap-2 rounded border border-dashed bg-muted text-muted-foreground">
                <ImageIcon className="h-8 w-8 opacity-40" />
                <p className="text-sm">Bu okul için splash tanımlı değil.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SplashEditDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Splash silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleting?.school_name}</strong> okulu için splash ekranı tamamen kaldırılacak.
              Veliler artık reklam görmeyecek.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleting) return;
                try {
                  await callOp("delete_school_splash", { school_id: deleting.school_id });
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

function SplashEditDialog({
  row, onClose, onSaved,
}: { row: SplashRow | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (row) {
      setImageUrl(row.image_url ?? "");
      setLinkUrl(row.link_url ?? "");
      setIsActive(row.is_active ?? true);
    }
  }, [row]);

  if (!row) return null;

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
      const path = `${row.school_id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("school-splashes")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("school-splashes").getPublicUrl(path);
      setImageUrl(pub.publicUrl);
      toast({ title: "Görsel yüklendi" });
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!imageUrl) {
      toast({ title: "Görsel gerekli", description: "Lütfen önce bir görsel yükleyin.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await callOp("upsert_school_splash", {
        school_id: row.school_id,
        image_url: imageUrl,
        link_url: linkUrl.trim() || null,
        is_active: isActive,
      });
      toast({ title: "Kaydedildi" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.school_name} — Splash</DialogTitle>
          <DialogDescription>
            Veli giriş sonrasında günde bir kez gösterilecek reklam görselini ayarlayın.
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
            <p className="text-xs text-muted-foreground">Önerilen oran: 9:16 (dikey) — Maks 5 MB.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="link">Tıklama bağlantısı (opsiyonel)</Label>
            <Input
              id="link"
              type="url"
              placeholder="https://..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Veli görsele tıkladığında yeni sekmede açılacak. Boş bırakılırsa sadece görüntüleme olur.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="active">Aktif</Label>
              <p className="text-xs text-muted-foreground">Pasif yapılırsa veliler splash'ı görmez.</p>
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
