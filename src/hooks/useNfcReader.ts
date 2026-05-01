import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { NDEFReader?: any }
}

export type NfcStatus = "unsupported" | "starting" | "listening" | "denied" | "error";

interface Options {
  enabled: boolean;
  onScan: (uid: string) => void;
}

/**
 * Continuously listens for NFC card taps via the Web NFC API.
 * Only works on Android Chrome over HTTPS. Calls `onScan` with the
 * normalized UID (uppercase hex, no colons) every time a card is tapped.
 */
export function useNfcReader({ enabled, onScan }: Options) {
  const [status, setStatus] = useState<NfcStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || !("NDEFReader" in window)) {
      setStatus("unsupported");
      return;
    }

    setStatus("starting");
    setError(null);

    const controller = new AbortController();
    let lastUid = "";
    let lastAt = 0;

    (async () => {
      try {
        const reader = new window.NDEFReader();
        await reader.scan({ signal: controller.signal });
        setStatus("listening");
        reader.onreadingerror = () => setError("Kart okunamadı, tekrar deneyin");
        reader.onreading = (e: any) => {
          const uid = (e.serialNumber || "").replace(/:/g, "").toUpperCase();
          if (!uid) return;
          // Debounce duplicate fires (some devices emit twice)
          const now = Date.now();
          if (uid === lastUid && now - lastAt < 1500) return;
          lastUid = uid;
          lastAt = now;
          onScanRef.current(uid);
        };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (msg.toLowerCase().includes("permission") || e?.name === "NotAllowedError") {
          setStatus("denied");
        } else {
          setStatus("error");
        }
        setError(msg);
      }
    })();

    return () => controller.abort();
  }, [enabled]);

  return { status, error };
}
