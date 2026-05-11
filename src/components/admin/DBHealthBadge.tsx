import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "checking" | "ok" | "down";

export default function DBHealthBadge() {
  const [status, setStatus] = useState<Status>("checking");
  const [latency, setLatency] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const check = async () => {
    setStatus((s) => (s === "ok" ? "ok" : "checking"));
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op: "ping" } });
      const ms = Math.round(performance.now() - t0);
      if (error) throw error;
      const ok = (data as any)?.ok === true || (data as any)?.data?.ok === true;
      if (ok) {
        setStatus("ok"); setLatency(ms); setDetail(null);
      } else {
        setStatus("down"); setLatency(null);
        setDetail((data as any)?.error ?? "Bağlantı başarısız");
      }
    } catch (e: any) {
      setStatus("down"); setLatency(null);
      setDetail(e?.message ?? "Sunucuya ulaşılamadı (timeout)");
    } finally {
      setCheckedAt(new Date());
    }
  };

  useEffect(() => {
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const label =
    status === "checking" ? "DB kontrol ediliyor…" :
    status === "ok" ? `DB bağlandı${latency != null ? ` · ${latency}ms` : ""}` :
    "DB ulaşılamıyor";

  const Icon =
    status === "checking" ? Loader2 :
    status === "ok" ? CheckCircle2 : AlertTriangle;

  const tooltip = [
    detail ?? "",
    checkedAt ? `Son kontrol: ${checkedAt.toLocaleTimeString("tr-TR")}` : "",
  ].filter(Boolean).join(" — ");

  return (
    <button
      onClick={check}
      title={tooltip || "Yeniden kontrol et"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        status === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        status === "down" && "border-destructive/40 bg-destructive/10 text-destructive",
        status === "checking" && "border-border bg-muted text-muted-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", status === "checking" && "animate-spin")} />
      <span>{label}</span>
    </button>
  );
}
