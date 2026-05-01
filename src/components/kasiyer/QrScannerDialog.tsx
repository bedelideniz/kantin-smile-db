import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface QrScannerDialogProps {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}

export function QrScannerDialog({ open, onClose, onResult }: QrScannerDialogProps) {
  const containerId = "qr-scanner-region";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);

    const start = async () => {
      try {
        const scanner = new Html5Qrcode(containerId, /* verbose */ false);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (cancelled) return;
            cancelled = true;
            scanner.stop().then(() => scanner.clear()).catch(() => {});
            onResult(decoded);
          },
          () => { /* per-frame error: ignore */ },
        );
      } catch (e: any) {
        setError(e?.message ?? "Kamera açılamadı");
      }
    };
    start();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop().then(() => s.clear()).catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [open, onResult]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>QR Kod Okut</DialogTitle>
          <DialogDescription>Öğrencinin QR kodunu kameraya gösterin.</DialogDescription>
        </DialogHeader>
        <div id={containerId} className="w-full overflow-hidden rounded-md bg-muted" style={{ minHeight: 280 }} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
