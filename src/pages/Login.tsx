import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const navigate = useNavigate();
  const { toast } = useToast();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/admin", { replace: true });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/admin` },
        });
        if (error) throw error;
        toast({
          title: "Kayıt oluşturuldu",
          description:
            "E-postanıza gönderilen doğrulama bağlantısına tıklayın. Ardından giriş yapıp Lovable Cloud panelinden hesabınıza super_admin rolü atayın.",
        });
        setMode("signin");
      }
    } catch (err: any) {
      toast({
        title: mode === "signin" ? "Giriş başarısız" : "Kayıt başarısız",
        description: err?.message ?? "Bilinmeyen hata",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Kantin Otomasyonu</CardTitle>
          <CardDescription>SüperAdmin / Yönetici Erişimi</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="signin">Giriş Yap</TabsTrigger>
              <TabsTrigger value="signup">Kayıt Ol</TabsTrigger>
            </TabsList>
            <TabsContent value={mode} forceMount>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-posta</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Şifre</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting
                    ? mode === "signin"
                      ? "Giriş yapılıyor..."
                      : "Kayıt oluşturuluyor..."
                    : mode === "signin"
                      ? "Giriş Yap"
                      : "Kayıt Ol"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}
