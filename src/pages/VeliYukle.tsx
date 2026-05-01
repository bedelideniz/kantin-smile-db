import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getParentSession, getSelectedStudentId, type ParentStudent } from "@/lib/parentApi";
import BottomNav from "@/components/veli/BottomNav";

const fmtTL = (n: number | string) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

const PRESETS = [50, 100, 200, 500];

export default function VeliYukle() {
  const navigate = useNavigate();
  const [student, setStudent] = useState<ParentStudent | null>(null);
  const [amount, setAmount] = useState<number>(100);

  useEffect(() => {
    const s = getParentSession();
    if (!s) { navigate("/veli-giris", { replace: true }); return; }
    const id = getSelectedStudentId() ?? s.students[0]?.id ?? null;
    setStudent(s.students.find((x) => x.id === id) ?? null);
  }, [navigate]);

  return (
    <main className="min-h-[100dvh] bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/veli")} aria-label="Geri">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Wallet className="h-4 w-4" /> Bakiye Yükle
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-4 p-4">
        {student && (
          <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background">
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Mevcut Bakiye</div>
              <div className="mt-1 text-3xl font-bold">{fmtTL(student.balance)}</div>
              <div className="mt-1 text-sm text-muted-foreground">{student.full_name}</div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <div className="mb-2 text-sm font-medium">Yükleme Tutarı</div>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className={`rounded-lg border py-3 text-sm font-semibold transition ${
                      amount === v ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
                    }`}
                  >
                    {v} ₺
                  </button>
                ))}
              </div>
            </div>

            <Button disabled className="h-14 w-full text-lg">
              {fmtTL(amount)} Yükle
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Online ödeme entegrasyonu yakında eklenecek.
            </p>
          </CardContent>
        </Card>
      </div>

      <BottomNav />
    </main>
  );
}
