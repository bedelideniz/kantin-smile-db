import { useEffect, useRef, useState } from "react";

export type UsbReaderStatus = "listening" | "disabled";

interface Options {
  enabled: boolean;
  onScan: (uid: string) => void;
  /** Min characters to accept as a valid scan. Defaults to 4. */
  minLength?: number;
  /** Max ms between keystrokes to count as a single scan burst. Defaults to 50ms. */
  maxInterKeyMs?: number;
}

/**
 * Listens for input from a USB HID scanner (QR/Barcode reader or RFID/NFC reader).
 *
 * These devices act as keyboards: when a code is scanned, they "type" it
 * very quickly (usually < 50ms between keys) and finish with Enter.
 *
 * Accepts alphanumeric chars plus `-`, `.`, `_`, `:` so UUID-style QR
 * tokens (e.g. `c4e8a2b1-1234-...`) survive intact. Case is preserved.
 */
export function useUsbCardReader({
  enabled,
  onScan,
  minLength = 4,
  maxInterKeyMs = 50,
}: Options) {
  const [status, setStatus] = useState<UsbReaderStatus>(enabled ? "listening" : "disabled");
  const [lastUid, setLastUid] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      setStatus("disabled");
      return;
    }
    setStatus("listening");

    let buffer = "";
    let lastKeyAt = 0;

    const flush = (commit: boolean) => {
      const value = buffer;
      buffer = "";
      if (commit && value.length >= minLength) {
        setLastUid(value);
        onScanRef.current(value);
      }
    };

    const handler = (e: KeyboardEvent) => {
      const now = Date.now();
      const delta = now - lastKeyAt;
      lastKeyAt = now;

      if (delta > maxInterKeyMs && buffer.length > 0) {
        buffer = "";
      }

      if (e.key === "Enter") {
        if (buffer.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          flush(true);
        } else {
          buffer = "";
        }
        return;
      }

      // Accept alphanumerics + common QR/UUID separators
      if (e.key.length === 1 && /[a-zA-Z0-9\-._:]/.test(e.key)) {
        buffer += e.key;
      } else if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") {
        buffer = "";
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled, minLength, maxInterKeyMs]);

  return { status, lastUid };
}
