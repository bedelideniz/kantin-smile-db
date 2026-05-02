// Mandatory student photo upload modal: shown on parent panel until every
// child has a photo. Crops to square, resizes to 600x600, encodes as JPEG ~85%.
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2, Camera, Image as ImageIcon, Check, ZoomIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { callParentApi, type ParentStudent } from "@/lib/parentApi";

const OUTPUT_SIZE = 600; // px (square)
const JPEG_QUALITY = 0.85;

interface Props {
  student: ParentStudent;
  open: boolean;
  onUploaded: (photoUrl: string) => void;
}

export default function PhotoUploadModal({ student, open, onUploaded }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Reset state when student changes
  useEffect(() => {
    setImg(null); setZoom(1); setOffset({ x: 0, y: 0 });
  }, [student.id]);

  // Redraw preview whenever inputs change
  useEffect(() => {
    if (!img || !previewRef.current) return;
    const canvas = previewRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width; // square preview
    ctx.clearRect(0, 0, size, size);
    // Compute base scale so image fits "cover" inside the preview at zoom=1
    const baseScale = Math.max(size / img.width, size / img.height);
    const scale = baseScale * zoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const dx = (size - drawW) / 2 + offset.x;
    const dy = (size - drawH) / 2 + offset.y;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, dx, dy, drawW, drawH);
  }, [img, zoom, offset]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Lütfen bir görsel dosyası seçin", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const i = new Image();
      i.onload = () => { setImg(i); setZoom(1); setOffset({ x: 0, y: 0 }); };
      i.onerror = () => toast({ title: "Görsel yüklenemedi", variant: "destructive" });
      i.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging || !dragStart.current) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setDragging(false); dragStart.current = null;
    try { (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const submit = async () => {
    if (!img || !previewRef.current) return;
    setUploading(true);
    try {
      // Render to OUTPUT_SIZE square at JPEG quality
      const previewSize = previewRef.current.width;
      const out = document.createElement("canvas");
      out.width = OUTPUT_SIZE; out.height = OUTPUT_SIZE;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("Canvas oluşturulamadı");
      const ratio = OUTPUT_SIZE / previewSize;
      const baseScale = Math.max(previewSize / img.width, previewSize / img.height);
      const scale = baseScale * zoom * ratio;
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const dx = (OUTPUT_SIZE - drawW) / 2 + offset.x * ratio;
      const dy = (OUTPUT_SIZE - drawH) / 2 + offset.y * ratio;
      octx.fillStyle = "#000";
      octx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      octx.drawImage(img, dx, dy, drawW, drawH);
      const blob: Blob | null = await new Promise((res) => out.toBlob(res, "image/jpeg", JPEG_QUALITY));
      if (!blob) throw new Error("Görsel kodlanamadı");
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Okuma hatası"));
        r.readAsDataURL(blob);
      });
      const r = await callParentApi<{ photo_url: string }>("upload_student_photo", {
        student_id: student.id,
        image_base64: dataUrl,
      });
      toast({ title: "Fotoğraf kaydedildi", description: student.full_name });
      onUploaded(r.photo_url);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message ?? "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md"
        // Block dismissing by ESC / outside-click / X-button: photo is mandatory.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Öğrenci Fotoğrafı Gerekli
          </DialogTitle>
          <DialogDescription>
            <strong>{student.full_name}</strong> için bir fotoğraf yükleyin. Bu fotoğraf öğrencinizin
            kantin kartında kullanılacak. Devam etmek için zorunludur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!img ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Galeriden seçin veya kameradan çekin
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                  <ImageIcon className="mr-1 h-4 w-4" /> Galeri
                </Button>
                <Button size="sm" onClick={() => cameraRef.current?.click()}>
                  <Camera className="mr-1 h-4 w-4" /> Kamera
                </Button>
              </div>
              <input
                ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <input
                ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2">
                <canvas
                  ref={previewRef}
                  width={300}
                  height={300}
                  className="touch-none cursor-move rounded-full ring-4 ring-primary/20"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
                <p className="text-xs text-muted-foreground">Fotoğrafı kaydırarak konumlandırın</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ZoomIn className="h-4 w-4 text-muted-foreground" />
                  <Slider value={[zoom]} onValueChange={(v) => setZoom(v[0])} min={1} max={3} step={0.05} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => { setImg(null); setZoom(1); setOffset({x:0,y:0}); }}>
                  Yeniden Seç
                </Button>
                <Button size="sm" onClick={submit} disabled={uploading} className="ml-auto">
                  {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                  Kaydet ve Devam Et
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
