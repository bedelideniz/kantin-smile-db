import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, HandHeart, Heart, Loader2, CreditCard, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  callParentApi,
  getParentSession,
  getSelectedStudentId,
  updateParentStudents,
  type ParentStudent,
} from "@/lib/parentApi";
import BottomNav from "@/components/veli/BottomNav";

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

interface DonationInfo {
  presets: number[];
  is_enabled: boolean;
  thank_you_message: string | null;
}

export default function VeliBagis() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [student, setStudent] = useState<ParentStudent | null>(null);
  const [info, setInfo] = useState<DonationInfo | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [source, setSource] = useState<"balance" | "card">("balance");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const s = getParentSession();
    if (!s) { navigate("/veli-giris", { replace: true }); return; }
    const id = getSelectedStudentId() ?? s.students[0]?.id ?? null;
    setStudent(s.students.find((x) => x.id === id) ?? null);
  }, [navigate]);

  useEffect(() => {
    if (!student?.school_id) return;
    (async () => {
      try {
        const r = await callParentApi<DonationInfo>("get_school_donation_info", {
          school_id: student.school_id,
        });
        setInfo(r);
        if (r.presets?.length) setAmount(r.presets[0]);
      } catch (e: any) {
        toast({ title: "Bağış bilgileri yüklenemedi", description: e?.message, variant: "destructive" });
      }
    })();
  }, [student?.school_id, toast]);

  const finalAmount = useMemo(() => {
    if (customAmount.trim()) {
      const n = Number(customAmount.replace(",", "."));
      return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    }
    return amount;
  }, [amount, customAmount]);

  const canSubmit = student && finalAmount >= 1 && info?.is_enabled !== false && !loading;

  const handleDonate = async () => {
    if (!student || !canSubmit) return;
    if (source === "card") {
      toast({
        title: "Çok yakında",
        description: "Kart ile bağış için online ödeme entegrasyonu yakında aktif olacak.",
      });
      return;
    }
    if (Number(student.balance) < finalAmount) {
      toast({ title: "Bakiye yetersiz", description: "Önce bakiye yükleyin veya daha küçük bir tutar seçin.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const r = await callParentApi<{ student_balance_after: number }>("donate_from_balance", {
        student_id: student.id,
        amount: finalAmount,
      });
      // Refresh local cache
      const session = getParentSession();
      if (session) {
        const updated = session.students.map((s) =>
          s.id === student.id ? { ...s, balance: r.student_balance_after } : s,
        );
        updateParentStudents(updated);
        setStudent({ ...student, balance: r.student_balance_after });
      }
      setSuccess(true);
    } catch (e: any) {
      toast({ title: "Bağış başarısız", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <main className="min-h-[100dvh] bg-gradient-to-b from-primary/5 via-background to-background">
        <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full text-primary-foreground shadow-xl"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Heart className="h-12 w-12" fill="currentColor" />
          </div>
          <h1 className="text-2xl font-bold">Teşekkür ederiz! 🙏</h1>
          <p className="text-muted-foreground">
            {info?.thank_you_message ??
              `${student?.school_name ?? "Okul"} bağış havuzuna ${fmtTL(finalAmount)} katkıda bulundunuz. Komisyon alınmadı; tutarın tamamı havuza eklendi.`}
          </p>
          <div className="flex w-full flex-col gap-2 pt-4">
            <Button onClick={() => { setSuccess(false); setCustomAmount(""); }} className="w-full">
              Tekrar Bağış Yap
            </Button>
            <Button variant="outline" onClick={() => navigate("/veli")} className="w-full">
              Panele Dön
            </Button>
          </div>
        </div>
        <BottomNav />
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gradient-to-b from-primary/5 via-background to-background">
      <header
        className="sticky top-0 z-20 px-4 py-3 text-primary-foreground shadow-md"
        style={{ background: "var(--gradient-primary)" }}
      >
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/veli")}
            className="text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
            aria-label="Geri"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <HandHeart className="h-5 w-5" /> Bağış Yap
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-4 p-4">
        {student && (
          <Card className="border-primary/20 bg-card">
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{student.school_name}</div>
              <div className="mt-0.5 font-semibold">{student.full_name}</div>
              <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" /> Bakiye: <span className="font-semibold text-foreground">{fmtTL(student.balance)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {info?.is_enabled === false ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Bu okul için bağış kabulü şu anda kapalı.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-5 p-5">
              <div>
                <div className="mb-2 text-sm font-medium">Bağış Tutarı</div>
                <div className="grid grid-cols-3 gap-2">
                  {(info?.presets ?? [10, 25, 50, 100, 250]).map((v) => {
                    const active = !customAmount && amount === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => { setAmount(v); setCustomAmount(""); }}
                        className={`rounded-lg border py-3 text-sm font-semibold transition ${
                          active ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
                        }`}
                      >
                        {v} ₺
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">veya istediğiniz tutarı yazın</label>
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value.replace(/[^\d,.]/g, ""))}
                    className="pr-10 text-right text-base"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">₺</span>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium">Ödeme Kaynağı</div>
                <Tabs value={source} onValueChange={(v) => setSource(v as "balance" | "card")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="balance" className="gap-1.5">
                      <Wallet className="h-3.5 w-3.5" /> Bakiyeden
                    </TabsTrigger>
                    <TabsTrigger value="card" className="gap-1.5">
                      <CreditCard className="h-3.5 w-3.5" /> Kart ile
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="balance" className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Tutar, seçili öğrencinin KantinPay bakiyesinden düşülerek okulun bağış havuzuna aktarılır.
                  </TabsContent>
                  <TabsContent value="card" className="mt-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Kredi kartı ile bağış için online ödeme entegrasyonu yakında aktif olacak.
                  </TabsContent>
                </Tabs>
              </div>

              <div className="rounded-lg bg-primary/10 p-3 text-xs text-primary">
                💝 Bağışlardan komisyon alınmaz; tutarın tamamı okulun bağış havuzuna eklenir.
              </div>

              <Button
                disabled={!canSubmit}
                onClick={handleDonate}
                className="h-14 w-full text-lg"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <><HandHeart className="h-5 w-5" /> {fmtTL(finalAmount || 0)} Bağış Yap</>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
