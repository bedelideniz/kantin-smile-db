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
import { Check, ChevronsUpDown, School } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { GripVertical, Image as ImageIcon, Loader2, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";

interface Row {
  school_id: string;
  school_name: string;
  story_id: string | null;
  image_url: string | null;
  link_url: string | null;
  title: string | null;
  sort_order: number | null;
  is_active: boolean | null;
  expires_at: string | null;
  updated_at: string | null;
}

interface Story {
  id: string;
  image_url: string;
  link_url: string | null;
  title: string | null;
  sort_order: number;
  is_active: boolean;
  expires_at: string | null;
}

interface SchoolGroup {
  school_id: string;
  school_name: string;
  stories: Story[];
}

function dateInputToExpiresIso(d: string): string | null {
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day, 23, 59, 59, 999).toISOString();
}
function expiresIsoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= Date.now();
}

async function callOp<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  return data?.data as T;
}

export default function SchoolStoriesManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<{ schoolId: string; schoolName: string; current: Story | null } | null>(null);
  const [deleting, setDeleting] = useState<{ schoolName: string; story: Story } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callOp<Row[]>("list_school_stories");
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
        g = { school_id: r.school_id, school_name: r.school_name, stories: [] };
        map.set(r.school_id, g);
      }
      if (r.story_id) {
        g.stories.push({
          id: r.story_id,
          image_url: r.image_url!,
          link_url: r.link_url,
          title: r.title,
          sort_order: r.sort_order ?? 0,
          is_active: !!r.is_active,
          expires_at: r.expires_at,
        });
      }
    }
    return Array.from(map.values());
  }, [rows]);

  const current = groups.find((g) => g.school_id === selectedSchool) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Veli Hikayeleri
        </h2>
        <p className="text-sm text-muted-foreground">
          Veli panelinde, öğrenci seçicinin üzerinde Instagram tarzı yuvarlak hikayeler gösterin. Okul başına birden fazla hikaye ekleyebilirsiniz.
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
                      {current.stories.length > 0 && (
                        <Badge variant="secondary" className="ml-1">{current.stories.length}</Badge>
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
                    {groups.map((g) => (
                      <CommandItem
                        key={g.school_id}
                        value={g.school_name}
                        onSelect={() => { setSelectedSchool(g.school_id); setPickerOpen(false); }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", selectedSchool === g.school_id ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 truncate">{g.school_name}</span>
                        {g.stories.length > 0 && (
                          <Badge variant="secondary" className="ml-2">{g.stories.length}</Badge>
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
          Hikayeleri görüntülemek için yukarıdan bir okul seçin.
        </CardContent></Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {current.stories.length === 0
                ? "Henüz hikaye eklenmemiş."
                : `${current.stories.length} hikaye tanımlı.`}
            </p>
            <Button
              size="sm"
              onClick={() => setEditing({ schoolId: current.school_id, schoolName: current.school_name, current: null })}
            >
              <Plus className="mr-1 h-4 w-4" /> Yeni Hikaye
            </Button>
          </div>

          {current.stories.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <Sparkles className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Bu okul için henüz hikaye yok. "Yeni Hikaye" ile ilk görseli ekleyin.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ReorderableStoryGrid
              key={current.school_id}
              schoolId={current.school_id}
              schoolName={current.school_name}
              stories={current.stories}
              onEdit={(s) => setEditing({ schoolId: current.school_id, schoolName: current.school_name, current: s })}
              onDelete={(s) => setDeleting({ schoolName: current.school_name, story: s })}
              onReordered={load}
            />
          )}
        </>
      )}

      <StoryEditDialog
        data={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hikaye silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleting?.schoolName}</strong> okulunun bu hikayesi kalıcı olarak silinecek.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleting) return;
                try {
                  await callOp("delete_school_story", { story_id: deleting.story.id });
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

function StoryEditDialog({ data, onClose, onSaved }: {
  data: { schoolId: string; schoolName: string; current: Story | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [title, setTitle] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [expiresDate, setExpiresDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setImageUrl(data.current?.image_url ?? "");
      setLinkUrl(data.current?.link_url ?? "");
      setTitle(data.current?.title ?? "");
      setIsActive(data.current?.is_active ?? true);
      setExpiresDate(expiresIsoToDateInput(data.current?.expires_at ?? null));
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
      const path = `${data.schoolId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("school-stories")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("school-stories").getPublicUrl(path);
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
      await callOp("upsert_school_story", {
        story_id: data.current?.id,
        school_id: data.schoolId,
        image_url: imageUrl,
        link_url: linkUrl.trim() || null,
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
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{data.schoolName} — {data.current ? "Hikayeyi Düzenle" : "Yeni Hikaye"}</DialogTitle>
          <DialogDescription>
            Veli panelinde, öğrenci seçicinin üstünde yuvarlak avatar olarak gösterilecek.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Görsel</Label>
            {imageUrl ? (
              <img src={imageUrl} alt="" className="max-h-64 w-full rounded border object-contain bg-muted" />
            ) : (
              <div className="flex h-40 items-center justify-center rounded border border-dashed bg-muted text-muted-foreground">
                <ImageIcon className="h-8 w-8 opacity-40" />
              </div>
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
            <Label htmlFor="title">Başlık (opsiyonel)</Label>
            <Input
              id="title"
              type="text"
              maxLength={120}
              placeholder="Avatar altında gösterilir"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
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
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="active">Aktif</Label>
              <p className="text-xs text-muted-foreground">Pasif yapılırsa veliler görmez.</p>
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

function ReorderableStoryGrid({
  schoolId, schoolName, stories, onEdit, onDelete, onReordered,
}: {
  schoolId: string;
  schoolName: string;
  stories: Story[];
  onEdit: (s: Story) => void;
  onDelete: (s: Story) => void;
  onReordered: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<Story[]>(stories);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync when parent stories change (e.g. after add/delete reload)
  useEffect(() => { setItems(stories); }, [stories]);

  const persist = async (next: Story[]) => {
    setSaving(true);
    try {
      await callOp("reorder_school_stories", {
        school_id: schoolId,
        story_ids: next.map((x) => x.id),
      });
      toast({ title: "Sıra güncellendi" });
      onReordered();
    } catch (e: any) {
      toast({ title: "Sıralanamadı", description: e?.message, variant: "destructive" });
      setItems(stories); // revert
    } finally { setSaving(false); }
  };

  const handleDrop = (toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) {
      setDragIdx(null); setOverIdx(null); return;
    }
    const next = items.slice();
    const [moved] = next.splice(dragIdx, 1);
    next.splice(toIdx, 0, moved);
    setItems(next);
    setDragIdx(null); setOverIdx(null);
    void persist(next);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        💡 Kartları sürükleyip bırakarak sırasını değiştirebilirsiniz.
        {saving && <span className="ml-2 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> kaydediliyor…</span>}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((s, idx) => (
          <Card
            key={s.id}
            draggable
            onDragStart={(e) => {
              setDragIdx(idx);
              e.dataTransfer.effectAllowed = "move";
              try { e.dataTransfer.setData("text/plain", s.id); } catch { /* noop */ }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overIdx !== idx) setOverIdx(idx);
            }}
            onDragLeave={() => { if (overIdx === idx) setOverIdx(null); }}
            onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            className={cn(
              "overflow-hidden transition",
              dragIdx === idx && "opacity-50",
              overIdx === idx && dragIdx !== null && dragIdx !== idx && "ring-2 ring-primary",
            )}
          >
            <div className="relative flex aspect-[9/16] items-center justify-center bg-muted">
              <img src={s.image_url} alt={s.title ?? ""} className="h-full w-full object-cover" />
              {s.is_active ? (
                <Badge className="absolute right-2 top-2">Aktif</Badge>
              ) : (
                <Badge className="absolute right-2 top-2" variant="outline">Pasif</Badge>
              )}
              <Badge variant="secondary" className="absolute left-2 top-2">#{idx + 1}</Badge>
              <div
                className="absolute bottom-2 right-2 flex h-8 w-8 cursor-grab items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm backdrop-blur active:cursor-grabbing"
                aria-label="Sürükle"
                title="Sürükle"
              >
                <GripVertical className="h-4 w-4" />
              </div>
            </div>
            <CardContent className="space-y-2 p-3">
              {s.title && <p className="truncate text-sm font-medium">{s.title}</p>}
              {s.link_url && <p className="truncate text-xs text-muted-foreground">🔗 {s.link_url}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => onEdit(s)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Düzenle
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(s)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
