import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Okul Yönetici Paneli</h1>
          <Button variant="outline" onClick={() => signOut().then(() => navigate("/yonetici-giris"))}>
            Çıkış Yap
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Hoş geldiniz</CardTitle>
            <CardDescription>{user.user_metadata?.full_name ?? user.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Bu ekran şimdilik bir yer tutucudur. Sıradaki adımda kasiyer yönetimi, veli/öğrenci listesi
              ve okul ayarları buraya eklenecektir.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
