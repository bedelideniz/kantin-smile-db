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

export default function SuperAdmin() {
  const { user, roles, loading, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, user, navigate]);

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
              Bu hesabın SüperAdmin rolü yok. İlk SüperAdmin'i Lovable Cloud arayüzünden
              <code className="mx-1 rounded bg-muted px-1">user_roles</code>
              tablosuna ekleyebilirsiniz.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground break-all">
              user_id: <code>{user.id}</code>
            </p>
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
    if (error) {
      toast({ title: "Migration hatası", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Migration tamamlandı", description: JSON.stringify(data?.results ?? data) });
  };

  const pingDb = async () => {
    const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op: "ping" } });
    if (error) {
      toast({ title: "Bağlantı hatası", description: error.message, variant: "destructive" });
      setPingResult(null);
      return;
    }
    setPingResult(JSON.stringify(data?.data, null, 2));
  };

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">SüperAdmin Paneli</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <Button variant="outline" onClick={signOut}>Çıkış</Button>
        </header>

        <Tabs defaultValue="schools" className="space-y-4">
          <TabsList>
            <TabsTrigger value="schools">Okullar</TabsTrigger>
            <TabsTrigger value="payments">Ödeme</TabsTrigger>
            <TabsTrigger value="netgsm">SMS / NetGSM</TabsTrigger>
            <TabsTrigger value="infrastructure">Altyapı</TabsTrigger>
          </TabsList>

          <TabsContent value="schools">
            <Card>
              <CardContent className="pt-6">
                <SchoolsManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="netgsm">
            <Card>
              <CardContent className="pt-6">
                <NetgsmSettings />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="infrastructure">
            <Card>
              <CardHeader>
                <CardTitle>Faz 0 — Altyapı</CardTitle>
                <CardDescription>
                  Kendi PostgreSQL sunucunuzdaki şemayı kurun ve bağlantıyı test edin.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={runMigration} disabled={running}>
                    {running ? "Çalışıyor…" : "Migration'ları Çalıştır"}
                  </Button>
                  <Button variant="secondary" onClick={pingDb}>DB Bağlantısını Test Et</Button>
                </div>
                {pingResult && (
                  <pre className="overflow-auto rounded bg-muted p-3 text-xs">{pingResult}</pre>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

