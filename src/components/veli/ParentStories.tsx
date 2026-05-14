import { useEffect, useRef, useState } from "react";
import { callParentApi } from "@/lib/parentApi";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ExternalLink, Sparkles, X } from "lucide-react";

interface Story {
  id: string;
  image_url: string;
  link_url: string | null;
  title: string | null;
}

interface Props {
  schoolId: string | null;
}

const STORY_DURATION_MS = 5000;
const seenKey = (schoolId: string) => `kantinpay.parent.storiesSeen.${schoolId}`;

function readSeen(schoolId: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(schoolId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch { return new Set(); }
}
function writeSeen(schoolId: string, set: Set<string>) {
  try { localStorage.setItem(seenKey(schoolId), JSON.stringify(Array.from(set))); } catch { /* ignore */ }
}

export default function ParentStories({ schoolId }: Props) {
  const [stories, setStories] = useState<Story[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  // Load stories whenever school changes
  useEffect(() => {
    if (!schoolId) { setStories([]); return; }
    setSeen(readSeen(schoolId));
    let cancelled = false;
    callParentApi<Story[]>("list_school_stories", { school_id: schoolId })
      .then((r) => { if (!cancelled) setStories(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setStories([]); });
    return () => { cancelled = true; };
  }, [schoolId]);

  // Auto-advance timer
  useEffect(() => {
    if (!open) return;
    setProgress(0);
    startRef.current = Date.now();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const p = Math.min(1, elapsed / STORY_DURATION_MS);
      setProgress(p);
      if (p >= 1) {
        next();
      }
    }, 50);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  const markSeen = (id: string) => {
    if (!schoolId) return;
    if (seen.has(id)) return;
    const next = new Set(seen);
    next.add(id);
    setSeen(next);
    writeSeen(schoolId, next);
  };

  const openAt = (i: number) => {
    if (!stories[i]) return;
    setIndex(i);
    setOpen(true);
    markSeen(stories[i].id);
  };

  const next = () => {
    setIndex((i) => {
      const n = i + 1;
      if (n >= stories.length) { setOpen(false); return i; }
      if (stories[n]) markSeen(stories[n].id);
      return n;
    });
  };
  const prev = () => {
    setIndex((i) => Math.max(0, i - 1));
  };

  if (!schoolId || stories.length === 0) return null;

  const current = stories[index];

  return (
    <>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {stories.map((s, i) => {
          const isSeen = seen.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => openAt(i)}
              className="flex shrink-0 flex-col items-center gap-1.5 focus:outline-none"
              aria-label={s.title ?? "Hikaye"}
            >
              <span
                className="rounded-full p-[2.5px] transition-transform active:scale-95"
                style={{
                  background: isSeen
                    ? "hsl(var(--muted-foreground) / 0.35)"
                    : "var(--gradient-gold, linear-gradient(135deg, hsl(var(--gold)), hsl(var(--primary))))",
                }}
              >
                <span className="block rounded-full bg-background p-[2px]">
                  <span className="block h-16 w-16 overflow-hidden rounded-full bg-muted">
                    <img src={s.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </span>
                </span>
              </span>
              <span className="line-clamp-1 max-w-[72px] text-center text-[11px] font-medium text-foreground/80">
                {s.title ?? "Hikaye"}
              </span>
            </button>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent
          className="max-w-md border-0 bg-black p-0 overflow-hidden"
          onInteractOutside={(e) => e.preventDefault()}
        >
          {current && (
            <div className="relative flex aspect-[9/16] w-full select-none flex-col">
              {/* Progress bars */}
              <div className="absolute inset-x-0 top-0 z-20 flex gap-1 p-2">
                {stories.map((_, i) => (
                  <div key={i} className="h-0.5 flex-1 overflow-hidden rounded bg-white/30">
                    <div
                      className="h-full bg-white transition-[width] duration-100 ease-linear"
                      style={{
                        width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%",
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Header */}
              <div className="absolute inset-x-0 top-2 z-20 flex items-center justify-between px-3 pt-3 text-white">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Sparkles className="h-3.5 w-3.5" />
                  {current.title ?? "Hikaye"}
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Kapat"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur hover:bg-white/25"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Image */}
              <img
                src={current.image_url}
                alt={current.title ?? ""}
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* Tap zones */}
              <button
                type="button"
                aria-label="Önceki"
                onClick={prev}
                className="absolute left-0 top-0 z-10 h-full w-1/3"
              />
              <button
                type="button"
                aria-label="Sonraki"
                onClick={next}
                className="absolute right-0 top-0 z-10 h-full w-2/3"
              />

              {/* Side arrows (desktop hint) */}
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden items-center pl-1 sm:flex">
                {index > 0 && <ChevronLeft className="h-6 w-6 text-white/60" />}
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden items-center pr-1 sm:flex">
                <ChevronRight className="h-6 w-6 text-white/60" />
              </div>

              {/* Link CTA */}
              {current.link_url && (
                <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 to-transparent p-4">
                  <Button asChild className="w-full">
                    <a href={current.link_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" /> Detayları Gör
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
