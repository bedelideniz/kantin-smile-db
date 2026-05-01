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
 * Listens for input from a USB HID RFID/NFC card reader.
 *
 * These readers act as keyboards: when a card is tapped, they "type" the
 * UID very quickly (usually < 50ms between keys) and finish with Enter.
 *
 * Strategy:
 *  - Capture keydown events globally.
 *  - If keys arrive in a fast burst and finish with Enter, treat as a scan.
 *  - Ignore bursts that originate from a focused input/textarea (so the
 *    cashier can still type in the search field), UNLESS the burst clearly
 *    looks like a card scan (very fast + finishes with Enter).
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
        const uid = value.toUpperCase();
        setLastUid(uid);
        onScanRef.current(uid);
      }
    };

    const handler = (e: KeyboardEvent) => {
      const now = Date.now();
      const delta = now - lastKeyAt;
      lastKeyAt = now;

      // Reset if too slow between keys (human typing)
      if (delta > maxInterKeyMs && buffer.length > 0) {
        buffer = "";
      }

      if (e.key === "Enter") {
        // Only treat as scan if buffer was built rapidly
        if (buffer.length >= minLength) {
          // Prevent form submit / default behavior when this looks like a scan
          e.preventDefault();
          e.stopPropagation();
          flush(true);
        } else {
          buffer = "";
        }
        return;
      }

      // Accept printable single chars (alphanumerics typical for card UIDs)
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        buffer += e.key;
      } else if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Alt" && e.key !== "Meta") {
        // Other keys break the burst
        buffer = "";
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled, minLength, maxInterKeyMs]);

  return { status, lastUid };
}
