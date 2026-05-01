import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { callCashierApi, getCashierSession, saveCashierSession, type CashierSession } from "@/lib/cashierApi";

export default function KasiyerGiris() {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // If already logged in, jump to POS.
  useEffect(() => {
    if (getCashierSession()) navigate("/kasiyer", { replace: true });
  }, [navigate]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!phone || pin.length !== 6) {
      toast({ title: "Eksik bilgi", description: "Telefon ve 6 haneli PIN gerekli", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const session = await callCashierApi<CashierSession>("login", { phone, pin });
      saveCashierSession(session);
      toast({ title: "Giriş başarılı", description: `Hoş geldiniz ${session.cashier.full_name}` });
      navigate("/kasiyer", { replace: true });
    } catch (err: any) {
      toast({ title: "Giriş başarısız", description: err?.message ?? "Bilinmeyen hata", variant: "destructive" });
      setPin("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Kasiyer Girişi</CardTitle>
          <CardDescription>Telefon numaranızı ve 6 haneli PIN kodunuzu girin.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="numeric"
                placeholder="5XXXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>PIN</Label>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={pin}
                  onChange={(v) => setPin(v.replace(/\D/g, ""))}
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
            </div>
            <Button type="submit" className="w-full" disabled={submitting || pin.length !== 6 || !phone}>
              {submitting ? "Giriş yapılıyor..." : "Giriş Yap"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
