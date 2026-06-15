import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, CreditCard, Wallet, Users, UserPlus, Trash2, Bell } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { callParentApi, type ParentStudent } from "@/lib/parentApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: ParentStudent | null;
  onUpdated: (next: ParentStudent) => void;
}

const fmtTL = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StudentSettingsModal({ open, onOpenChange, student, onUpdated }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [cardLost, setCardLost] = useState<boolean>(!!student?.card_lost);

  // Daily limit
  const hasLimitInitial = student?.daily_spend_limit != null;
  const [limitEnabled, setLimitEnabled] = useState<boolean>(hasLimitInitial);
  const [limitInput, setLimitInput] = useState<string>(
    student?.daily_spend_limit != null ? String(student.daily_spend_limit) : "",
  );
  const [savingLimit, setSavingLimit] = useState(false);

  // Co-parents (eş / diğer veli)
  interface CoParent { id: string; phone: string; full_name: string | null; created_at: string }
  const [coParents, setCoParents] = useState<CoParent[]>([]);
  const [primaryPhone, setPrimaryPhone] = useState<string | null>(null);
  const [loadingCo, setLoadingCo] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Notification prefs (per parent phone)
  const [salePush, setSalePush] = useState<boolean>(true);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);


  useEffect(() => {
    setCardLost(!!student?.card_lost);
    const has = student?.daily_spend_limit != null;
    setLimitEnabled(has);
    setLimitInput(has ? String(student!.daily_spend_limit) : "");
  }, [student?.id, student?.card_lost, student?.daily_spend_limit, open]);

  const loadCoParents = async (sid: string) => {
    setLoadingCo(true);
    try {
      const r = await callParentApi<{ primary: { parent_phone: string | null } | null; co_parents: CoParent[] }>(
        "list_co_parents", { student_id: sid },
      );
      setCoParents(r.co_parents ?? []);
      setPrimaryPhone(r.primary?.parent_phone ?? null);
    } catch (e) {
      toast({ title: "Veliler yüklenemedi", description: (e as Error).message, variant: "destructive" });
    } finally { setLoadingCo(false); }
  };

  useEffect(() => {
    if (open && student?.id) {
      loadCoParents(student.id);
      setInviteName("");
      setInvitePhone("");
    }
    if (open) {
      setPrefsLoading(true);
      callParentApi<{ sale_push: boolean }>("get_notification_prefs")
        .then((r) => setSalePush(!!r.sale_push))
        .catch(() => {})
        .finally(() => setPrefsLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);

  const handleToggleSalePush = async (next: boolean) => {
    const prev = salePush;
    setSalePush(next);
    setPrefsSaving(true);
    try {
      await callParentApi("set_notification_prefs", { sale_push: next });
      toast({
        title: next ? "Harcama bildirimleri açık" : "Harcama bildirimleri kapalı",
        description: next
          ? "Çocuğunuz her harcama yaptığında bildirim alırsınız."
          : "Kantin harcamaları için otomatik bildirim gönderilmeyecek.",
      });
    } catch (e) {
      setSalePush(prev);
      toast({ title: "Kaydedilemedi", description: (e as Error).message, variant: "destructive" });
    } finally { setPrefsSaving(false); }
  };

  const formatPhone = (raw: string) => raw.replace(/\D+/g, "").slice(0, 11);

  const handleInvite = async () => {
    if (!student) return;
    const name = inviteName.trim();
    const digits = formatPhone(invitePhone);
    if (name.length < 2) {
      toast({ title: "Ad soyad girin", variant: "destructive" });
      return;
    }
    if (digits.length < 10) {
      toast({ title: "Geçersiz numara", description: "10 haneli cep numarası girin", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      await callParentApi("invite_co_parent", { student_id: student.id, full_name: name, phone: digits });
      toast({ title: "Davet gönderildi", description: `${name} numarasına giriş bilgisi SMS ile iletildi.` });
      setInviteName(""); setInvitePhone("");
      await loadCoParents(student.id);
    } catch (e) {
      toast({ title: "Davet gönderilemedi", description: (e as Error).message, variant: "destructive" });
    } finally { setInviting(false); }
  };

  const handleRemove = async (id: string) => {
    if (!student) return;
    if (!confirm("Bu veliyi öğrenciden kaldırmak istediğinize emin misiniz?")) return;
    setRemovingId(id);
    try {
      await callParentApi("remove_co_parent", { student_id: student.id, co_parent_id: id });
      setCoParents((cur) => cur.filter((x) => x.id !== id));
      toast({ title: "Veli kaldırıldı" });
    } catch (e) {
      toast({ title: "İşlem başarısız", description: (e as Error).message, variant: "destructive" });
    } finally { setRemovingId(null); }
  };



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

  const saveLimit = async (nextEnabled: boolean) => {
    if (!student) return;
    let value: number | null = null;
    if (nextEnabled) {
      const n = Number(limitInput.replace(",", "."));
      if (!isFinite(n) || n < 0) {
        toast({ title: "Geçersiz tutar", description: "0 veya pozitif bir sayı girin", variant: "destructive" });
        return;
      }
      value = Math.round(n * 100) / 100;
    }
    setSavingLimit(true);
    try {
      const r = await callParentApi<{ id: string; daily_spend_limit: number | null }>(
        "set_daily_limit",
        { student_id: student.id, daily_spend_limit: value },
      );
      onUpdated({ ...student, daily_spend_limit: r.daily_spend_limit });
      setLimitEnabled(r.daily_spend_limit != null);
      setLimitInput(r.daily_spend_limit != null ? String(r.daily_spend_limit) : "");
      toast({
        title: r.daily_spend_limit == null ? "Günlük limit kaldırıldı" : "Günlük limit güncellendi",
        description: r.daily_spend_limit == null
          ? "Öğrenci tüm bakiyesini harcayabilir."
          : `Yeni limit: ${fmtTL(r.daily_spend_limit)} ₺/gün`,
      });
    } catch (e) {
      toast({ title: "Kaydedilemedi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingLimit(false);
    }
  };

  const todaySpent = Number(student?.today_spent ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
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

            {/* Daily spend limit */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Wallet className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">Günlük Harcama Limiti</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Açıkken öğrenci günde belirlediğiniz tutardan fazlasını kantinde
                      harcayamaz. Limit her gece sıfırlanır.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={limitEnabled}
                  disabled={savingLimit}
                  onCheckedChange={(v) => {
                    setLimitEnabled(v);
                    if (!v) saveLimit(false);
                  }}
                  aria-label="Günlük limit"
                />
              </div>

              {limitEnabled && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        inputMode="decimal"
                        placeholder="0,00"
                        value={limitInput}
                        onChange={(e) => setLimitInput(e.target.value.replace(/[^\d,.]/g, ""))}
                        className="pr-8 text-right"
                        disabled={savingLimit}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">₺</span>
                    </div>
                    <Button onClick={() => saveLimit(true)} disabled={savingLimit}>
                      {savingLimit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kaydet"}
                    </Button>
                  </div>
                  {student.daily_spend_limit != null && (
                    <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                      Bugünkü harcama:{" "}
                      <span className="font-semibold text-foreground">
                        {fmtTL(todaySpent)} ₺ / {fmtTL(Number(student.daily_spend_limit))} ₺
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Co-parents (eş / diğer veli) */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">Eş / Diğer Veli</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bu öğrenci için başka bir veli (eşiniz vb.) davet edin. Davet ettiğiniz numaraya
                    SMS gider, kendi numarasıyla giriş yaptığında aynı öğrenci için aksiyon alabilir.
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {primaryPhone && (
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">Birincil veli</div>
                      <div className="text-xs text-muted-foreground">0{primaryPhone}</div>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Asıl
                    </span>
                  </div>
                )}
                {loadingCo ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Yükleniyor…
                  </div>
                ) : coParents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Henüz davet edilen ek veli yok.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {coParents.map((cp) => (
                      <li key={cp.id} className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{cp.full_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">0{cp.phone}</div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemove(cp.id)}
                          disabled={removingId === cp.id}
                          aria-label="Kaldır"
                        >
                          {removingId === cp.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-4 space-y-2 rounded-lg border border-dashed p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <UserPlus className="h-4 w-4" /> Yeni veli davet et
                </div>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="co-name" className="text-xs">Ad Soyad</Label>
                    <Input
                      id="co-name"
                      placeholder="Örn: Ayşe Yılmaz"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      disabled={inviting}
                      maxLength={100}
                    />
                  </div>
                  <div>
                    <Label htmlFor="co-phone" className="text-xs">Cep telefonu</Label>
                    <Input
                      id="co-phone"
                      type="tel"
                      inputMode="numeric"
                      placeholder="5XX XXX XX XX"
                      value={invitePhone}
                      onChange={(e) => setInvitePhone(e.target.value.replace(/\D+/g, "").slice(0, 11))}
                      disabled={inviting}
                    />
                  </div>
                  <Button onClick={handleInvite} disabled={inviting} className="w-full">
                    {inviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                    Davet Gönder
                  </Button>
                </div>
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
