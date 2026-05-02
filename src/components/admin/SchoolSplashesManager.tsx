import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Image as ImageIcon, Loader2, Pencil, Trash2, Upload, Link as LinkIcon } from "lucide-react";

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

export default function SchoolSplashesManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SplashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SplashRow | null>(null);
  const [deleting, setDeleting] = useState<SplashRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callOp<SplashRow[]>("list_school_splashes");
      setRows(r);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Veli Splash Ekranları</h2>
          <p className="text-sm text-muted-foreground">
            Her okul için veli giriş sonrasında günde bir kez gösterilecek reklam görselini yönetin.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Henüz okul yok.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Okul</TableHead>
                  <TableHead>Önizleme</TableHead>
                  <TableHead>Bağlantı</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.school_id}>
                    <TableCell className="font-medium">{r.school_name}</TableCell>
                    <TableCell>
                      {r.image_url ? (
                        <img src={r.image_url} alt="" className="h-12 w-20 rounded border object-cover" />
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <ImageIcon className="h-3.5 w-3.5" /> yok
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs">
                      {r.link_url ? (
                        <a href={r.link_url} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-primary hover:underline">
                          <LinkIcon className="h-3 w-3" /> {r.link_url}
                        </a>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {r.image_url == null ? (
                        <Badge variant="outline">Tanımsız</Badge>
                      ) : r.is_active ? (
                        <Badge>Aktif</Badge>
                      ) : (
                        <Badge variant="secondary">Pasif</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {r.image_url && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
