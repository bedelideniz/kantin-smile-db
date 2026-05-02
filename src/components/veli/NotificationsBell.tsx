import { useEffect, useState, useCallback } from "react";
import { Bell, Loader2, CheckCheck, ShieldOff, ShieldCheck, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { callParentApi } from "@/lib/parentApi";

interface Notif {
  id: string;
  student_id: string;
  student_name: string;
  kind: string;
  title: string;
  body: string | null;
  meta: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const iconForKind = (kind: string) => {
  if (kind === "card_seized") return <ShieldOff className="h-4 w-4 text-destructive" />;
  if (kind === "card_found") return <ShieldCheck className="h-4 w-4 text-primary" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
};

export default function NotificationsBell() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callParentApi<{ notifications: Notif[]; unread_count: number }>(
        "list_notifications",
        { limit: 50 },
      );
      setItems(r.notifications);
      setUnread(r.unread_count);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  // When opening: also mark all as read (after fetching once)
  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (next) {
      await refresh();
      if (unread > 0) {
        try {
          await callParentApi("mark_notifications_read", { all: true });
          setUnread(0);
          setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
        } catch {
          // ignore
        }
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Bildirimler"
          className="relative text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-1.5rem)] max-w-sm p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-semibold">Bildirimler</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="h-7 px-2 text-xs"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {loading ? "Yükleniyor…" : "Henüz bildiriminiz yok."}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id} className={`px-3 py-3 ${!n.read_at ? "bg-accent/30" : ""}`}>
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 shrink-0">{iconForKind(n.kind)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{n.title}</p>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(n.created_at)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.student_name}</p>
                      {n.body && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{n.body}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
