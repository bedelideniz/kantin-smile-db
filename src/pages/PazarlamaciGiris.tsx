import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp } from "lucide-react";

export default function PazarlamaciGiris() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        const { data: roles } = await supabase.rpc("get_my_roles");
        if (roles?.some((r: any) => r.role === "marketer")) {
          navigate("/pazarlamaci", { replace: true });
        }
      }
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      });
      if (error) throw error;
      const { data: roles, error: rolesErr } = await supabase.rpc("get_my_roles");
      if (rolesErr) throw rolesErr;
      if (!roles?.some((r: any) => r.role === "marketer")) {
        await supabase.auth.signOut();
        throw new Error("Bu hesabın pazarlamacı yetkisi yok");
      }
      toast({ title: "Giriş başarılı", description: data.user?.email ?? "" });
      navigate("/pazarlamaci", { replace: true });
    } catch (err: any) {
      toast({ title: "Giriş başarısız", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Pazarlamacı Girişi</CardTitle>
          <CardDescription>E-posta ve şifrenizle giriş yapın</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-posta</Label>
              <Input id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw">Şifre</Label>
              <Input id="pw" type="password" autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Giriş yapılıyor..." : "Giriş Yap"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
