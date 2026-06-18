import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertTriangle, Database, Copy } from "lucide-react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminDashboard from "@/components/admin/AdminDashboard";
import SchoolsManager from "@/components/admin/SchoolsManager";
import NetgsmSettings from "@/components/admin/NetgsmSettings";
import PaymentSettings from "@/components/admin/PaymentSettings";
import MarketersManager from "@/components/admin/MarketersManager";
import StudentsBySchool from "@/components/admin/StudentsBySchool";
import SchoolSplashesManager from "@/components/admin/SchoolSplashesManager";
import DonationManagersManager from "@/components/admin/DonationManagersManager";
import ParentWelcomeSmsSettings from "@/components/admin/ParentWelcomeSmsSettings";
import StaffManager from "@/components/admin/StaffManager";
import AlarmsManager from "@/components/admin/AlarmsManager";
import SaleLogsManager from "@/components/admin/SaleLogsManager";
import CanteenPayoutsManager from "@/components/admin/CanteenPayoutsManager";
import CanteenAnnouncementsManager from "@/components/admin/CanteenAnnouncementsManager";
import SchoolStoriesManager from "@/components/admin/SchoolStoriesManager";
import LegalDocumentsManager from "@/components/admin/LegalDocumentsManager";
import PushNotificationsManager from "@/components/admin/PushNotificationsManager";
import DisputesManager from "@/components/admin/DisputesManager";
import { callAdminApi, MODULE_LABELS, type AppModule } from "@/lib/adminApi";

const TAB_ORDER: AppModule[] = [
  "dashboard","schools","students","marketers","splashes","stories","announcements","donations","payments","sms","push","alarms","disputes","payouts","logs","legal","staff","infrastructure",
];

export default function SuperAdmin() {
  const { user, roles, loading, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [myModules, setMyModules] = useState<AppModule[] | null>(null);
  const [active, setActive] = useState<AppModule>("dashboard");
  const [openAlarms, setOpenAlarms] = useState<number>(0);
  const [openDisputes, setOpenDisputes] = useState<number>(0);
  const [migrationResult, setMigrationResult] = useState<any[] | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const visibleTabs = myModules ? TAB_ORDER.filter((m) => myModules.includes(m)) : [];

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user || !hasRole("super_admin")) return;
    callAdminApi<{ modules: AppModule[]; is_owner: boolean }>("whoami")
      .then((r) => setMyModules(r.modules))
      .catch(() => setMyModules([]));
  }, [user, hasRole]);

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.includes(active)) setActive(visibleTabs[0]);
  }, [active, visibleTabs]);

  useEffect(() => {
    if (!myModules?.includes("alarms")) return;
    const refresh = () => {
      callAdminApi<{ count: number }>("count_open_alarms")
        .then((r) => setOpenAlarms(r?.count ?? 0))
        .catch(() => {});
    };
    refresh();
    const handler = () => refresh();
    window.addEventListener("alarms:changed", handler);
    const id = setInterval(refresh, 30_000);
    return () => { window.removeEventListener("alarms:changed", handler); clearInterval(id); };
  }, [myModules, active]);

  useEffect(() => {
    if (!myModules?.includes("disputes")) return;
    const refresh = () => {
      callAdminApi<{ count: number }>("count_open_disputes")
        .then((r) => setOpenDisputes(r?.count ?? 0))
        .catch(() => {});
    };
    refresh();
    const handler = () => refresh();
    window.addEventListener("disputes:changed", handler);
    const id = setInterval(refresh, 30_000);
    return () => { window.removeEventListener("disputes:changed", handler); clearInterval(id); };
  }, [myModules, active]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center">Yükleniyor…</div>;
  }

  if (roles !== null && !hasRole("super_admin")) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Yetkisiz</CardTitle>
            <CardDescription>Bu hesabın SüperAdmin rolü yok.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground break-all">user_id: <code>{user.id}</code></p>
            <Button variant="outline" onClick={signOut}>Çıkış Yap</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const runMigration = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("migrate-external-db");
    setRunning(false);
    if (error) { toast({ title: "Migration hatası", description: error.message, variant: "destructive" }); return; }
    const results = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    setMigrationResult(results);
    setMigrationOpen(true);
  };

  const pingDb = async () => {
    const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op: "ping" } });
    if (error) { toast({ title: "Bağlantı hatası", description: error.message, variant: "destructive" }); setPingResult(null); return; }
    setPingResult(JSON.stringify(data?.data, null, 2));
  };

  if (myModules === null) {
    return <div className="flex min-h-screen items-center justify-center">Yetkiler yükleniyor…</div>;
  }

  if (visibleTabs.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Henüz hiçbir modüle yetkiniz tanımlanmamış. Yöneticinize başvurun.
        </CardContent></Card>
      </main>
    );
  }

  const renderContent = () => {
    switch (active) {
      case "dashboard": return (
        <div className="space-y-4">
          <AdminDashboard openAlarms={openAlarms} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Altyapı</CardTitle>
              <CardDescription>Hızlı erişim</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button onClick={runMigration} disabled={running}>
                  {running ? "Çalışıyor…" : "Migration'ları Çalıştır"}
                </Button>
                <Button variant="secondary" onClick={pingDb}>DB Bağlantısını Test Et</Button>
              </div>
              {pingResult && <pre className="overflow-auto rounded bg-muted p-3 text-xs">{pingResult}</pre>}
            </CardContent>
          </Card>
        </div>
      );
      case "schools": return <Card><CardContent className="pt-6"><SchoolsManager /></CardContent></Card>;
      case "students": return <StudentsBySchool />;
      case "marketers": return <Card><CardContent className="pt-6"><MarketersManager /></CardContent></Card>;
      case "splashes": return <Card><CardContent className="pt-6"><SchoolSplashesManager /></CardContent></Card>;
      case "stories": return <Card><CardContent className="pt-6"><SchoolStoriesManager /></CardContent></Card>;
      case "announcements": return <Card><CardContent className="pt-6"><CanteenAnnouncementsManager /></CardContent></Card>;
      case "donations": return <Card><CardContent className="pt-6"><DonationManagersManager /></CardContent></Card>;
      case "payments": return <Card><CardContent className="pt-6"><PaymentSettings /></CardContent></Card>;
      case "sms": return (
        <div className="space-y-4">
          <Card><CardContent className="pt-6"><NetgsmSettings /></CardContent></Card>
          <Card><CardContent className="pt-6"><ParentWelcomeSmsSettings /></CardContent></Card>
        </div>
      );
      case "alarms": return <AlarmsManager />;
      case "payouts": return <CanteenPayoutsManager />;
      case "logs": return <SaleLogsManager />;
      case "staff": return <StaffManager />;
      case "legal": return <LegalDocumentsManager />;
      case "disputes": return <DisputesManager />;
      case "push": return <PushNotificationsManager />;
      case "infrastructure": return (
        <Card>
          <CardHeader>
            <CardTitle>Faz 0 — Altyapı</CardTitle>
            <CardDescription>Kendi PostgreSQL sunucunuzdaki şemayı kurun ve bağlantıyı test edin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={runMigration} disabled={running}>
                {running ? "Çalışıyor…" : "Migration'ları Çalıştır"}
              </Button>
              <Button variant="secondary" onClick={pingDb}>DB Bağlantısını Test Et</Button>
            </div>
            {pingResult && <pre className="overflow-auto rounded bg-muted p-3 text-xs">{pingResult}</pre>}
          </CardContent>
        </Card>
      );
      default: return null;
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar
          modules={visibleTabs}
          active={active}
          onSelect={setActive}
          openAlarms={openAlarms}
          openDisputes={openDisputes}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold truncate">{MODULE_LABELS[active]}</h1>
              <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={signOut}>Çıkış</Button>
          </header>
          <main className="flex-1 p-6">
            <div className="mx-auto max-w-7xl">{renderContent()}</div>
          </main>
        </div>
      </div>
      <MigrationResultDialog
        open={migrationOpen}
        onOpenChange={setMigrationOpen}
        results={migrationResult}
      />
    </SidebarProvider>
  );
}

type MigrationItem = { version?: string; status?: string; error?: any; [k: string]: any };

function MigrationResultDialog({
  open,
  onOpenChange,
  results,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  results: MigrationItem[] | null;
}) {
  const { toast } = useToast();
  const items = results ?? [];

  const stats = useMemo(() => {
    let ok = 0, fail = 0, other = 0;
    for (const r of items) {
      const s = String(r?.status ?? "").toLowerCase();
      if (s === "ok" || s === "verified" || s === "success") ok++;
      else if (s === "error" || s === "failed") fail++;
      else other++;
    }
    return { ok, fail, other, total: items.length };
  }, [items]);

  const statusMeta = (s?: string) => {
    const v = String(s ?? "").toLowerCase();
    if (v === "ok" || v === "verified" || v === "success")
      return { label: s ?? "ok", icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900" };
    if (v === "error" || v === "failed")
      return { label: s ?? "error", icon: XCircle, cls: "text-red-600 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900" };
    return { label: s ?? "—", icon: AlertTriangle, cls: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900" };
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(items, null, 2));
      toast({ title: "Panoya kopyalandı" });
    } catch {
      toast({ title: "Kopyalanamadı", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-background to-background border-b px-6 py-5">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg">Migration Tamamlandı</DialogTitle>
                <DialogDescription>
                  Veritabanı şeması güncellendi. Aşağıda her bir adımın durumu listelenmiştir.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">
            <StatCell label="Toplam" value={stats.total} tone="muted" />
            <StatCell label="Başarılı" value={stats.ok} tone="ok" />
            <StatCell label="Uyarı" value={stats.other} tone="warn" />
            <StatCell label="Hata" value={stats.fail} tone="err" />
          </div>
        </div>

        <ScrollArea className="max-h-[55vh]">
          <ul className="divide-y">
            {items.length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-muted-foreground">
                Sonuç verisi bulunamadı.
              </li>
            )}
            {items.map((r, i) => {
              const meta = statusMeta(r?.status);
              const Icon = meta.icon;
              return (
                <li key={i} className="flex items-start gap-3 px-6 py-3">
                  <Icon className={`h-4 w-4 mt-0.5 ${meta.cls.split(" ")[0]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium truncate">{r?.version ?? `#${i + 1}`}</code>
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${meta.cls}`}>
                        {meta.label}
                      </Badge>
                    </div>
                    {r?.error && (
                      <p className="mt-1 text-xs text-red-600 break-all">
                        {typeof r.error === "string" ? r.error : JSON.stringify(r.error)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>

        <DialogFooter className="border-t bg-muted/30 px-6 py-3 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={copyJson}>
            <Copy className="h-4 w-4 mr-2" /> JSON kopyala
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>Kapat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCell({ label, value, tone }: { label: string; value: number; tone: "muted" | "ok" | "warn" | "err" }) {
  const cls =
    tone === "ok" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "err" ? "text-red-600" :
    "text-foreground";
  return (
    <div className="rounded-lg border bg-background/60 px-2 py-2">
      <div className={`text-xl font-semibold ${cls}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}
