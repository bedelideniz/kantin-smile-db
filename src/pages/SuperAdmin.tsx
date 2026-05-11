import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
import { callAdminApi, MODULE_LABELS, type AppModule } from "@/lib/adminApi";

const TAB_ORDER: AppModule[] = [
  "dashboard","schools","students","marketers","splashes","announcements","donations","payments","sms","alarms","payouts","logs","staff","infrastructure",
];

export default function SuperAdmin() {
  const { user, roles, loading, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [myModules, setMyModules] = useState<AppModule[] | null>(null);
  const [active, setActive] = useState<AppModule>("dashboard");
  const [openAlarms, setOpenAlarms] = useState<number>(0);
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
    toast({ title: "Migration tamamlandı", description: JSON.stringify(data?.results ?? data) });
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
      case "dashboard": return <AdminDashboard openAlarms={openAlarms} />;
      case "schools": return <Card><CardContent className="pt-6"><SchoolsManager /></CardContent></Card>;
      case "students": return <StudentsBySchool />;
      case "marketers": return <Card><CardContent className="pt-6"><MarketersManager /></CardContent></Card>;
      case "splashes": return <Card><CardContent className="pt-6"><SchoolSplashesManager /></CardContent></Card>;
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
    </SidebarProvider>
  );
}
