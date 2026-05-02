import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, CreditCard } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { callParentApi, type ParentStudent } from "@/lib/parentApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: ParentStudent | null;
  onUpdated: (next: ParentStudent) => void;
}

export default function StudentSettingsModal({ open, onOpenChange, student, onUpdated }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [cardLost, setCardLost] = useState<boolean>(!!student?.card_lost);

  useEffect(() => {
    setCardLost(!!student?.card_lost);
  }, [student?.id, student?.card_lost, open]);

  const handleToggle = async (next: boolean) => {
    if (!student) return;
    setSaving(true);
    const prev = cardLost;
    setCardLost(next);
    try {
      const r = await callParentApi<{ id: string; card_lost: boolean }>("set_card_lost", {
        student_id: student.id,
        card_lost: next,
      });
      onUpdated({ ...student, card_lost: r.card_lost });
      toast({
        title: next ? "Kart kayıp olarak işaretlendi" : "Kart tekrar aktif",
        description: next
          ? "Kart bulunana kadar kantinde satış yapılamayacak."
          : "Kart artık kantinde kullanılabilir.",
      });
    } catch (e) {
      setCardLost(prev);
      toast({
        title: "İşlem başarısız",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Öğrenci Ayarları</DialogTitle>
          <DialogDescription>
            {student ? `${student.full_name} için ayarlar` : ""}
          </DialogDescription>
        </DialogHeader>

        {!student ? null : (
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      cardLost ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {cardLost ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      Kart Kayıp / Bulundu
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Açtığınızda kart kantinde geçersiz olur ve hiçbir satış yapılamaz.
                      Kantinci "Kart Bulundu" diyerek tekrar açabilir.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={cardLost}
                  disabled={saving}
                  onCheckedChange={handleToggle}
                  aria-label="Kart kayıp"
                />
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs">
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span className="text-muted-foreground">Kaydediliyor…</span>
                  </>
                ) : cardLost ? (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                    Kart şu an KAYIP — satış engelli
                  </span>
                ) : (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                    Kart aktif
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Kapat</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
