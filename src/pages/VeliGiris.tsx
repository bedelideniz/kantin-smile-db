import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Smartphone, ShieldCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { callParentApi, getParentSession, saveParentSession, type ParentSession } from "@/lib/parentApi";
import logo from "@/assets/kantinpay-logo.png";

type Step = "phone" | "otp";

export default function VeliGiris() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [studentCount, setStudentCount] = useState(0);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getParentSession()) navigate("/veli", { replace: true });
  }, [navigate]);

  const formatPhone = (raw: string) => raw.replace(/\D+/g, "").slice(0, 11);

  const requestOtp = async () => {
    const digits = formatPhone(phone);
    if (digits.length < 10) {
      toast({ title: "Geçersiz numara", description: "Lütfen 10 haneli cep numarası girin (örn: 5XX XXX XX XX)", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const r = await callParentApi<{ ok: boolean; student_count: number }>("login_request", { phone: digits });
      setStudentCount(r.student_count);
      setStep("otp");
      toast({ title: "Kod gönderildi", description: `${digits} numarasına 6 haneli giriş kodu SMS olarak iletildi.` });
    } catch (e: any) {
      toast({ title: "Giriş yapılamadı", description: e?.message ?? "Bilinmeyen hata", variant: "destructive" });
    } finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    if (code.length !== 6) {
      toast({ title: "Eksik kod", description: "6 haneli kodu girin.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const session = await callParentApi<Omit<ParentSession, "phone">>("login_verify", { phone: formatPhone(phone), code, remember });
      saveParentSession({ ...session, phone: formatPhone(phone) });
      navigate("/veli", { replace: true });
    } catch (e: any) {
      toast({ title: "Kod doğrulanamadı", description: e?.message ?? "Bilinmeyen hata", variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src={logo}
            alt="KantinPay — Okulun Dijital Cüzdanı"
            className="h-32 w-auto object-contain"
          />
          <p className="mt-1 text-sm font-medium text-primary/70">Veli Paneli</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {step === "phone" ? <Smartphone className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
              {step === "phone" ? "Telefon ile giriş" : "Doğrulama kodu"}
            </CardTitle>
            <CardDescription>
              {step === "phone"
                ? "Okula kayıtlı veli numaranıza SMS ile giriş kodu göndereceğiz."
                : `${formatPhone(phone)} numarasına gelen 6 haneli kodu girin.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "phone" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="phone">Cep telefonu</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="5XX XXX XX XX"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    onKeyDown={(e) => e.key === "Enter" && requestOtp()}
                    className="h-12 text-base"
                    disabled={loading}
                  />
                </div>
                <Button onClick={requestOtp} disabled={loading} className="h-12 w-full text-base bg-gradient-primary">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Kod Gönder
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="code">6 haneli kod</Label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="••••••"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                    className="h-14 text-center text-2xl font-semibold tracking-[0.5em]"
                    disabled={loading}
                    autoFocus
                  />
                  {studentCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Bu numaraya kayıtlı <strong>{studentCount}</strong> öğrenci bulundu.
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 cursor-pointer select-none">
                  <Checkbox
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                    disabled={loading}
                  />
                  <span className="text-sm">
                    Beni hatırla <span className="text-muted-foreground">(30 gün tekrar kod istemesin)</span>
                  </span>
                </label>
                <Button onClick={verifyOtp} disabled={loading || code.length !== 6} className="h-12 w-full text-base bg-gradient-primary">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Giriş Yap
                </Button>
                <Button
                  variant="ghost"
                  className="h-10 w-full"
                  onClick={() => { setStep("phone"); setCode(""); }}
                  disabled={loading}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Numarayı değiştir
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
