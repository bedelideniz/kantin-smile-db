import { useEffect, useState } from "react";
import { callParentApi } from "@/lib/parentApi";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ExternalLink } from "lucide-react";

interface Props {
  schoolId: string | null;
}

interface Splash { image_url: string; link_url: string | null; }

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const seenKey = (schoolId: string) => `kantinpay.parent.splashSeen.${schoolId}`;

export default function ParentSplash({ schoolId }: Props) {
  const [splash, setSplash] = useState<Splash | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    const lastSeen = localStorage.getItem(seenKey(schoolId));
    if (lastSeen === todayKey()) return; // already seen today

    let cancelled = false;
    callParentApi<Splash | null>("get_school_splash", { school_id: schoolId })
      .then((r) => {
        if (cancelled || !r?.image_url) return;
        setSplash(r);
        setOpen(true);
      })
      .catch(() => { /* silently ignore */ });
    return () => { cancelled = true; };
  }, [schoolId]);

  const close = () => {
    if (schoolId) localStorage.setItem(seenKey(schoolId), todayKey());
    setOpen(false);
  };

  if (!splash) return null;

  const content = (
    <img
      src={splash.image_url}
      alt="Okul duyurusu"
      className="block max-h-[80vh] w-full object-contain"
    />
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="max-w-md p-0 overflow-hidden border-0 bg-background"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <button
          onClick={close}
          aria-label="Kapat"
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur hover:bg-background"
        >
          <X className="h-5 w-5" />
        </button>
        {splash.link_url ? (
          <a href={splash.link_url} target="_blank" rel="noopener noreferrer" onClick={close}>
            {content}
          </a>
        ) : content}
        {splash.link_url && (
          <div className="border-t bg-muted/50 p-3">
            <Button
              asChild
              variant="default"
              className="w-full"
              onClick={close}
            >
              <a href={splash.link_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" /> Detayları Gör
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
