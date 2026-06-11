import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { BellRing, Loader2, Send } from "lucide-react";


type Target = "all" | "school" | "phones";
interface School { id: string; name: string }

export default function PushNotificationsManager() {
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [target, setTarget] = useState<Target>("all");
  const [schoolId, setSchoolId] = useState<string>("");
  const [phonesRaw, setPhonesRaw] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  useEffect(() => {
    callAdminApi<School[]>("list_schools").then(setSchools).catch(() => {});
  }, []);

  const send = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ title: "Başlık ve mesaj zorunlu", variant: "destructive" });
      return;
    }
    if (target === "school" && !schoolId) {
      toast({ title: "Okul seçin", variant: "destructive" });
      return;
    }
    const phones = target === "phones"
      ? phonesRaw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean)
      : undefined;
    if (target === "phones" && (!phones || phones.length === 0)) {
      toast({ title: "En az bir telefon girin", variant: "destructive" });
      return;
    }

    setSending(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-push", {
        body: {
          title: title.trim(),
          message: message.trim(),
          url: url.trim() || undefined,
          target,
          school_id: target === "school" ? schoolId : undefined,
          phones,
        },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const r = (data as any)?.data;
      const recipients = r?.recipients ?? 0;
      setLastResult(`Gönderildi · ${recipients} alıcıya iletildi · id: ${r?.notification_id ?? "-"}`);
      toast({ title: "Bildirim gönderildi", description: `${recipients} alıcı` });
      setTitle("");
      setMessage("");
      setUrl("");
      setPhonesRaw("");
    } catch (e: any) {
      const msg = e?.message ?? "Hata";
      setLastResult(`Hata: ${msg}`);
      toast({ title: "Gönderilemedi", description: msg, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-5 w-5 text-primary" /> Push Bildirim Gönder
        </CardTitle>
        <CardDescription>
          OneSignal üzerinden velilere anlık bildirim gönderin. Yalnızca KantinPay mobil uygulamasını yükleyip bildirime izin vermiş veliler alır.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Hedef</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {([
              { v: "all", l: "Tüm veliler" },
              { v: "school", l: "Okul" },
              { v: "phones", l: "Telefon listesi" },
            ] as { v: Target; l: string }[]).map((o) => (
              <Button
                key={o.v}
                type="button"
                size="sm"
                variant={target === o.v ? "default" : "outline"}
                onClick={() => setTarget(o.v)}
              >
                {o.l}
              </Button>
            ))}
          </div>
        </div>

        {target === "school" && (
          <div>
            <Label className="text-xs">Okul</Label>
            <select
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— Okul seçin —</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {target === "phones" && (
          <div>
            <Label className="text-xs">Telefon numaraları</Label>
            <Textarea
              rows={3}
              placeholder="05XX… veya 5XXXXXXXXX — virgül veya satır ile ayırın"
              value={phonesRaw}
              onChange={(e) => setPhonesRaw(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Numaralar otomatik normalize edilir (son 10 hane).
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Başlık <span className="text-muted-foreground">({title.length}/120)</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="ör. Yeni kampanya!" />
          </div>
          <div>
            <Label className="text-xs">Tıklama URL'i (opsiyonel)</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>

        <div>
          <Label className="text-xs">Mesaj <span className="text-muted-foreground">({message.length}/500)</span></Label>
          <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="Bildirim metni" />
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div className="text-xs text-muted-foreground">{lastResult ?? ""}</div>
          <Button onClick={send} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Gönder
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
