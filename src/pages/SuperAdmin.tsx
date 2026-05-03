import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
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
import { callAdminApi, MODULE_LABELS, type AppModule } from "@/lib/adminApi";

const TAB_ORDER: AppModule[] = [
  "schools","students","marketers","splashes","donations","payments","sms","alarms","logs","staff","infrastructure",
];

export default function SuperAdmin() {
  const { user, roles, loading, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [myModules, setMyModules] = useState<AppModule[] | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user || !hasRole("super_admin")) return;
    callAdminApi<{ modules: AppModule[]; is_owner: boolean }>("whoami")
      .then((r) => setMyModules(r.modules))
      .catch(() => setMyModules([]));
  }, [user, hasRole]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center">Yükleniyor…</div>;
  }

  if (roles !== null && !hasRole("super_admin")) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Yetkisiz</CardTitle>
            <CardDescription>
              Bu hesabın SüperAdmin rolü yok.
            </CardDescription>
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

  const hasMod = (m: AppModule) => myModules.includes(m);
  const visibleTabs = TAB_ORDER.filter(hasMod);
  const defaultTab = visibleTabs[0] ?? "schools";

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">SüperAdmin Paneli</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {hasMod("infrastructure") && (
              <Button onClick={runMigration} disabled={running}>
                {running ? "Çalışıyor…" : "Migration'ları Çalıştır"}
              </Button>
            )}
            <Button variant="outline" onClick={signOut}>Çıkış</Button>
          </div>
        </header>

        {visibleTabs.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">
            Henüz hiçbir modüle yetkiniz tanımlanmamış. Yöneticinize başvurun.
          </CardContent></Card>
        ) : (
          <Tabs defaultValue={defaultTab} className="space-y-4">
            <TabsList className="flex-wrap h-auto">
              {visibleTabs.map((m) => (
                <TabsTrigger key={m} value={m}>{MODULE_LABELS[m]}</TabsTrigger>
              ))}
            </TabsList>

            {hasMod("schools") && <TabsContent value="schools"><Card><CardContent className="pt-6"><SchoolsManager /></CardContent></Card></TabsContent>}
            {hasMod("students") && <TabsContent value="students"><StudentsBySchool /></TabsContent>}
            {hasMod("marketers") && <TabsContent value="marketers"><Card><CardContent className="pt-6"><MarketersManager /></CardContent></Card></TabsContent>}
            {hasMod("splashes") && <TabsContent value="splashes"><Card><CardContent className="pt-6"><SchoolSplashesManager /></CardContent></Card></TabsContent>}
            {hasMod("donations") && <TabsContent value="donations"><Card><CardContent className="pt-6"><DonationManagersManager /></CardContent></Card></TabsContent>}
            {hasMod("payments") && <TabsContent value="payments"><Card><CardContent className="pt-6"><PaymentSettings /></CardContent></Card></TabsContent>}
            {hasMod("sms") && (
              <TabsContent value="sms">
                <div className="space-y-4">
                  <Card><CardContent className="pt-6"><NetgsmSettings /></CardContent></Card>
                  <Card><CardContent className="pt-6"><ParentWelcomeSmsSettings /></CardContent></Card>
                </div>
              </TabsContent>
            )}
            {hasMod("alarms") && <TabsContent value="alarms"><AlarmsManager /></TabsContent>}
            {hasMod("staff") && <TabsContent value="staff"><StaffManager /></TabsContent>}
            {hasMod("infrastructure") && (
              <TabsContent value="infrastructure">
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
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </main>
  );
}
