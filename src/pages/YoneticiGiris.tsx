import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";

type Step = "phone" | "code";

export default function YoneticiGiris() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("school-admin-login", {
        body: { phone },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Kod gönderildi", description: "SMS ile gönderilen 6 haneli kodu girin." });
      setStep("code");
    } catch (err: any) {
      toast({ title: "Gönderilemedi", description: err?.message ?? "Bilinmeyen hata", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const verifyOtp = async (otpValue?: string) => {
    const c = otpValue ?? code;
    if (c.length !== 6) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("school-admin-verify", {
        body: { phone, code: c },
      });
      if (error) throw error;
      const payload = data as any;
      if (payload?.error) throw new Error(payload.error);
      const session = payload?.session;
      if (!session?.access_token || !session?.refresh_token) {
        throw new Error("Oturum bilgisi alınamadı");
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (setErr) throw setErr;
      toast({ title: "Giriş başarılı", description: `Hoş geldiniz ${payload.admin?.full_name ?? ""}` });
      navigate("/yonetici", { replace: true });
    } catch (err: any) {
      toast({ title: "Giriş başarısız", description: err?.message ?? "Bilinmeyen hata", variant: "destructive" });
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Okul Yöneticisi Girişi</CardTitle>
          <CardDescription>
            {step === "phone"
              ? "Kayıtlı telefon numaranıza SMS ile giriş kodu göndereceğiz."
              : `${phone} numarasına gönderilen 6 haneli kodu girin.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="5XXXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoComplete="tel"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Gönderiliyor..." : "Kod Gönder"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    if (v.length === 6) verifyOtp(v);
                  }}
                  disabled={submitting}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                onClick={() => verifyOtp()}
                className="w-full"
                disabled={submitting || code.length !== 6}
              >
                {submitting ? "Doğrulanıyor..." : "Giriş Yap"}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                }}
                disabled={submitting}
              >
                Telefonu değiştir
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
