import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Smartphone, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  callParentApi,
  getParentSession,
  saveParentSession,
  type ParentSession,
} from "@/lib/parentApi";

import { linkOneSignalToParent } from "@/lib/oneSignal";

type Step = "phone" | "change_pin";

export default function VeliGiris() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = getParentSession();
    if (s && !s.must_change) navigate("/veli", { replace: true });
    if (s && s.must_change) setStep("change_pin");
  }, [navigate]);

  const formatPhone = (raw: string) => raw.replace(/\D+/g, "").slice(0, 11);

  const login = async () => {
    const digits = formatPhone(phone);
    if (digits.length < 10) {
      toast({ title: "Geçersiz numara", description: "10 haneli cep numarası girin.", variant: "destructive" });
      return;
    }
    if (pin.length !== 6) {
      toast({ title: "PIN eksik", description: "6 haneli PIN'i girin.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const session = await callParentApi<Omit<ParentSession, "phone">>("login_with_pin", {
        phone: digits, pin, remember,
      });
      saveParentSession({ ...session, phone: digits });
      if (session.must_change) {
        setStep("change_pin");
        setPin("");
      } else {
        linkOneSignalToParent(digits).catch(() => {});
        navigate("/veli", { replace: true });
      }
    } catch (e: any) {
      toast({ title: "Giriş yapılamadı", description: e?.message ?? "Bilinmeyen hata", variant: "destructive" });
    } finally { setLoading(false); }
  };

  const forgot = async () => {
    const digits = formatPhone(phone);
    if (digits.length < 10) {
      toast({ title: "Önce telefonunuzu girin", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await callParentApi("forgot_pin", { phone: digits });
      toast({
        title: "Yeni PIN gönderildi",
        description: `${digits} numarasına yeni 6 haneli PIN SMS olarak iletildi.`,
      });
    } catch (e: any) {
      toast({ title: "Gönderilemedi", description: e?.message ?? "Bilinmeyen hata", variant: "destructive" });
    } finally { setLoading(false); }
  };

  const changePin = async () => {
    if (newPin.length !== 6 || newPin2.length !== 6) {
      toast({ title: "PIN eksik", description: "Yeni PIN 6 haneli olmalı.", variant: "destructive" });
      return;
    }
    if (newPin !== newPin2) {
      toast({ title: "PIN'ler eşleşmiyor", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await callParentApi("change_pin", { new_pin: newPin });
      const cur = getParentSession();
      if (cur) saveParentSession({ ...cur, must_change: false });
      if (cur?.phone) linkOneSignalToParent(cur.phone).catch(() => {});
      toast({ title: "PIN güncellendi" });
      navigate("/veli", { replace: true });
    } catch (e: any) {
      toast({ title: "Değiştirilemedi", description: e?.message ?? "Bilinmeyen hata", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden p-4"
      style={{
        background:
          "radial-gradient(1200px 600px at 10% -10%, hsl(218 65% 22% / 0.18), transparent 60%)," +
          "radial-gradient(900px 500px at 110% 10%, hsl(45 85% 60% / 0.15), transparent 60%)," +
          "linear-gradient(180deg, hsl(220 30% 97%) 0%, hsl(220 30% 94%) 100%)",
      }}
    >
      <div className="pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, hsl(218 70% 35%) 0%, transparent 70%)" }} />
      <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, hsl(45 85% 60%) 0%, transparent 70%)" }} />

      <div className="relative w-full max-w-sm">


        <Card className="border-white/60 bg-white/70 shadow-2xl backdrop-blur-xl" style={{ borderRadius: "1.75rem" }}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {step === "phone" ? <Smartphone className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              </span>
              {step === "phone" ? "Telefon ve PIN ile giriş" : "Yeni PIN belirleyin"}
            </CardTitle>
            <CardDescription>
              {step === "phone"
                ? "Okul tarafından SMS ile gönderilen 6 haneli PIN kodunu kullanın."
                : "Güvenliğiniz için 6 haneli yeni bir PIN belirlemeniz gerekiyor."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {step === "phone" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="phone">Cep telefonu</Label>
                  <Input
                    id="phone" type="tel" inputMode="numeric" autoComplete="tel"
                    placeholder="5XX XXX XX XX"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    className="h-12 text-base"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pin">PIN (6 hane)</Label>
                  <Input
                    id="pin" type="password" inputMode="numeric" autoComplete="current-password"
                    pattern="\d{6}" maxLength={6} placeholder="••••••"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && login()}
                    className="h-14 text-center text-2xl font-semibold tracking-[0.5em]"
                    disabled={loading}
                  />
                </div>
                <label className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 cursor-pointer select-none">
                  <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} disabled={loading} />
                  <span className="text-sm">Beni hatırla <span className="text-muted-foreground">(30 gün)</span></span>
                </label>
                <Button onClick={login} disabled={loading || pin.length !== 6} className="h-12 w-full text-base bg-gradient-primary">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Giriş Yap
                </Button>
                <Button variant="ghost" type="button" className="h-10 w-full" onClick={forgot} disabled={loading}>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Şifremi unuttum (SMS ile yeni PIN)
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="newpin">Yeni PIN</Label>
                  <Input
                    id="newpin" type="password" inputMode="numeric"
                    pattern="\d{6}" maxLength={6} placeholder="••••••"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                    className="h-14 text-center text-2xl font-semibold tracking-[0.5em]"
                    disabled={loading}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newpin2">Yeni PIN (tekrar)</Label>
                  <Input
                    id="newpin2" type="password" inputMode="numeric"
                    pattern="\d{6}" maxLength={6} placeholder="••••••"
                    value={newPin2}
                    onChange={(e) => setNewPin2(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && changePin()}
                    className="h-14 text-center text-2xl font-semibold tracking-[0.5em]"
                    disabled={loading}
                  />
                </div>
                <Button onClick={changePin} disabled={loading || newPin.length !== 6 || newPin2.length !== 6} className="h-12 w-full text-base bg-gradient-primary">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  PIN'i Kaydet
                </Button>
                <Button
                  variant="ghost" className="h-10 w-full"
                  onClick={() => { setStep("phone"); setPin(""); setNewPin(""); setNewPin2(""); }}
                  disabled={loading}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Vazgeç
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Numaranız sistemde tanımlı değilse okul yöneticinize başvurun.
        </p>
      </div>
    </main>
  );
}
