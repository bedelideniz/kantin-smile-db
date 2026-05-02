import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { LogOut, TrendingUp, School, Wallet, Calendar, Gift } from "lucide-react";
import { callMarketerApi, formatPercent, formatTRY, MarketerSummary, MONTH_NAMES_TR } from "@/lib/marketerApi";

interface Profile {
  id: string; full_name: string; email: string; phone: string | null;
  signup_bonus: string; commission_share_rate: string; notes: string | null;
}
interface MySchool { id: string; name: string; province: string | null; district: string | null; assigned_at: string; }
interface Earning {
  id: string; school_id: string; school_name: string;
  period_year: number; period_month: number;
  commission_amount: string; share_rate: string; share_amount: string; status: string;
}
interface Bonus { id: string; school_name: string; amount: string; status: string; created_at: string; }
interface Payout { id: string; amount: string; method: string | null; reference: string | null; note: string | null; paid_at: string; }

const statusBadge = (s: string) => {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    pending: "outline", approved: "default", paid: "secondary", cancelled: "destructive",
  };
  const label = { pending: "Beklemede", approved: "Onaylı", paid: "Ödendi", cancelled: "İptal" }[s] ?? s;
  return <Badge variant={map[s] ?? "outline"}>{label}</Badge>;
};

export default function PazarlamaciPanel() {
  const { user, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<MarketerSummary | null>(null);
  const [schools, setSchools] = useState<MySchool[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/pazarlamaci-giris", { replace: true }); return; }
    if (roles && !roles.some((r) => r.role === "marketer")) {
      navigate("/pazarlamaci-giris", { replace: true });
    }
  }, [loading, user, roles, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [me, sch, earn, bon, pay] = await Promise.all([
          callMarketerApi<{ profile: Profile; summary: MarketerSummary }>("me"),
          callMarketerApi<{ schools: MySchool[] }>("my_schools"),
          callMarketerApi<{ earnings: Earning[] }>("my_monthly_earnings"),
          callMarketerApi<{ bonuses: Bonus[] }>("my_bonuses"),
          callMarketerApi<{ payouts: Payout[] }>("my_payouts"),
        ]);
        setProfile(me.profile);
        setSummary(me.summary);
        setSchools(sch.schools);
        setEarnings(earn.earnings);
        setBonuses(bon.bonuses);
        setPayouts(pay.payouts);
      } catch (e: any) {
        toast({ title: "Veri alınamadı", description: e.message, variant: "destructive" });
      }
    })();
  }, [user, toast]);

  if (loading || !user) {
    return <main className="flex min-h-screen items-center justify-center">Yükleniyor…</main>;
  }

  const now = new Date();
  const currentMonthLabel = `${MONTH_NAMES_TR[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-background">
      {/* Header */}
      <header className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-md">
        <div className="mx-auto max-w-5xl px-4 py-5 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider opacity-80">Pazarlamacı Paneli</div>
            <div className="text-xl font-semibold">{profile?.full_name ?? user.email}</div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => signOut().then(() => navigate("/pazarlamaci-giris"))}>
            <LogOut className="mr-2 h-4 w-4" />Çıkış
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl p-4 space-y-4">
        {/* Big balance card */}
        <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wider opacity-80">Ödenecek Toplam Bakiye</div>
            <div className="text-4xl font-bold mt-1">{formatTRY(summary?.owed_total ?? 0)}</div>
            <div className="text-xs opacity-80 mt-2">
              Onaylanan ama henüz ödenmemiş bonus + aylık paylar
            </div>
          </CardContent>
        </Card>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Calendar className="h-5 w-5 text-primary" />}
            label={currentMonthLabel}
            value={formatTRY(summary?.current_month_share ?? 0)}
            sub="Bu ay hak edilen" />
          <StatCard icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
            label="Toplam Kazanç"
            value={formatTRY(summary?.lifetime_earned ?? 0)}
            sub="Hayat boyu" />
          <StatCard icon={<School className="h-5 w-5 text-blue-600" />}
            label="Okul"
            value={String(summary?.school_count ?? 0)}
            sub="Pazarladığım" />
          <StatCard icon={<Wallet className="h-5 w-5 text-amber-600" />}
            label="Toplam Ödenmiş"
            value={formatTRY(summary?.payouts_total ?? 0)}
            sub="Bana ödenen" />
        </div>

        {profile && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sözleşme Şartları</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-muted-foreground text-xs">Okul başına bonus</div>
                  <div className="font-semibold text-base">{formatTRY(profile.signup_bonus)}</div>
                </div>
                <Gift className="h-6 w-6 text-amber-500" />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-muted-foreground text-xs">Komisyon kâr payı</div>
                  <div className="font-semibold text-base">{formatPercent(profile.commission_share_rate)}</div>
                </div>
                <TrendingUp className="h-6 w-6 text-emerald-600" />
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="earnings">
          <TabsList>
            <TabsTrigger value="earnings">Aylık Kazanç</TabsTrigger>
            <TabsTrigger value="bonuses">Bonuslar</TabsTrigger>
            <TabsTrigger value="schools">Okullarım</TabsTrigger>
            <TabsTrigger value="payouts">Ödemeler</TabsTrigger>
          </TabsList>

          <TabsContent value="earnings">
            <Card><CardContent className="pt-4">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Dönem</TableHead><TableHead>Okul</TableHead>
                  <TableHead className="text-right">Komisyon</TableHead>
                  <TableHead className="text-right">Oran</TableHead>
                  <TableHead className="text-right">Payım</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {earnings.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                      Henüz kazanç kaydı yok
                    </TableCell></TableRow>
                  )}
                  {earnings.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{MONTH_NAMES_TR[e.period_month - 1]} {e.period_year}</TableCell>
                      <TableCell>{e.school_name}</TableCell>
                      <TableCell className="text-right">{formatTRY(e.commission_amount)}</TableCell>
                      <TableCell className="text-right">{formatPercent(e.share_rate)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatTRY(e.share_amount)}</TableCell>
                      <TableCell>{statusBadge(e.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="bonuses">
            <Card><CardContent className="pt-4">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Okul</TableHead><TableHead className="text-right">Tutar</TableHead>
                  <TableHead>Durum</TableHead><TableHead>Tarih</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {bonuses.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                      Henüz bonus yok
                    </TableCell></TableRow>
                  )}
                  {bonuses.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.school_name}</TableCell>
                      <TableCell className="text-right font-semibold">{formatTRY(b.amount)}</TableCell>
                      <TableCell>{statusBadge(b.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString("tr-TR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="schools">
            <Card><CardContent className="pt-4">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Okul</TableHead><TableHead>İl/İlçe</TableHead><TableHead>Atandığı Tarih</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {schools.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                      Henüz okul atanmamış
                    </TableCell></TableRow>
                  )}
                  {schools.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[s.province, s.district].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(s.assigned_at).toLocaleDateString("tr-TR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="payouts">
            <Card><CardContent className="pt-4">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Tarih</TableHead><TableHead className="text-right">Tutar</TableHead>
                  <TableHead>Yöntem</TableHead><TableHead>Not</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {payouts.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                      Henüz size yapılan ödeme yok
                    </TableCell></TableRow>
                  )}
                  {payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.paid_at).toLocaleDateString("tr-TR")}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600">{formatTRY(p.amount)}</TableCell>
                      <TableCell>{p.method ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[p.reference, p.note].filter(Boolean).join(" — ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          {icon}
        </div>
        <div className="text-xl font-bold mt-1">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
