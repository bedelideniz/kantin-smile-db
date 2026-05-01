import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CashiersManager from "@/components/yonetici/CashiersManager";
import StudentsManager from "@/components/yonetici/StudentsManager";
import ProductsManager from "@/components/yonetici/ProductsManager";

export default function YoneticiPanel() {
  const { user, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/yonetici-giris", { replace: true });
      return;
    }
    if (roles && !roles.some((r) => r.role === "school_admin")) {
      navigate("/yonetici-giris", { replace: true });
    }
  }, [loading, user, roles, navigate]);

  if (loading || !user) {
    return <main className="flex min-h-screen items-center justify-center">Yükleniyor...</main>;
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Okul Yönetici Paneli</h1>
            <p className="text-sm text-muted-foreground">
              {user.user_metadata?.full_name ?? user.email}
            </p>
          </div>
          <Button variant="outline" onClick={() => signOut().then(() => navigate("/yonetici-giris"))}>
            Çıkış Yap
          </Button>
        </div>

        <Tabs defaultValue="cashiers" className="space-y-4">
          <TabsList>
            <TabsTrigger value="cashiers">Kasiyerler</TabsTrigger>
            <TabsTrigger value="users">Veli & Öğrenci</TabsTrigger>
            <TabsTrigger value="settings" disabled>
              Okul Ayarları
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cashiers">
            <CashiersManager />
          </TabsContent>

          <TabsContent value="users">
            <StudentsManager />
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Okul Ayarları</CardTitle>
                <CardDescription>Yakında eklenecek.</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
