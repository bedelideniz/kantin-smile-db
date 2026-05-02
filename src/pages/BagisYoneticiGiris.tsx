import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { HandHeart, Loader2, Phone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { callDmApi, saveDmSession, type DonationManagerSession } from "@/lib/donationManagerApi";
import logo from "@/assets/kantinpay-logo.png";

export default function BagisYoneticiGiris() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await callDmApi("login_request", { phone });
      toast({ title: "Kod gönderildi", description: "Telefonunuza gelen 6 haneli kodu girin." });
      setStep("code");
    } catch (e: any) {
      toast({ title: "Giriş başarısız", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await callDmApi<DonationManagerSession>("login_verify", { phone, code });
      saveDmSession(r);
      navigate("/bagis-yonetici", { replace: true });
    } catch (e: any) {
      toast({ title: "Doğrulanamadı", description: e?.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-primary/10 via-background to-background p-4">
      <Card className="w-full max-w-sm border-primary/20 shadow-xl">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-white p-2 shadow-md ring-2 ring-primary/30">
            <img src={logo} alt="KantinPay" className="h-full w-full object-contain" />
          </div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <HandHeart className="h-5 w-5 text-primary" /> Bağış Yöneticisi Girişi
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Okul tarafından yetkilendirilmiş bağış yöneticileri için
          </p>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <form onSubmit={requestOtp} className="space-y-3">
              <Label htmlFor="phone">Telefon Numarası</Label>
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="phone"
                  inputMode="tel"
                  placeholder="5XX XXX XX XX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
              <Button type="submit" disabled={loading || phone.length < 10} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kod Gönder"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-3">
              <Label htmlFor="code">Doğrulama Kodu</Label>
              <div className="relative">
                <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 haneli kod"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="pl-9 tracking-widest"
                  required
                />
              </div>
              <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Giriş Yap"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep("phone")} className="w-full text-xs">
                Telefon numarasını değiştir
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
