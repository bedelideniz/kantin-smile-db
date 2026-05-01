import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface NfcReaderDialogProps {
  open: boolean;
  onClose: () => void;
  onResult: (uid: string) => void;
}

// Web NFC is only available on Android Chrome. We expose a graceful fallback.
declare global {
  interface Window { NDEFReader?: any }
}

export function NfcReaderDialog({ open, onClose, onResult }: NfcReaderDialogProps) {
  const [status, setStatus] = useState<string>("Hazırlanıyor...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStatus("Kart okutmaya hazır");

    if (!("NDEFReader" in window)) {
      setError("Bu cihaz/tarayıcı NFC okumayı desteklemiyor. Android Chrome gerekiyor.");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const reader = new window.NDEFReader();
        await reader.scan({ signal: controller.signal });
        setStatus("Kartı telefona yaklaştırın...");
        reader.onreadingerror = () => setError("Kart okunamadı, tekrar deneyin");
        reader.onreading = (e: any) => {
          if (cancelled) return;
          const uid = (e.serialNumber || "").replace(/:/g, "").toUpperCase();
          if (!uid) {
            setError("Kart UID'si alınamadı");
            return;
          }
          cancelled = true;
          controller.abort();
          onResult(uid);
        };
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "NFC başlatılamadı");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, onResult]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>NFC Kart Okut</DialogTitle>
          <DialogDescription>{status}</DialogDescription>
        </DialogHeader>
        <div className="flex h-40 items-center justify-center rounded-md bg-muted">
          <span className="text-4xl">📡</span>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
