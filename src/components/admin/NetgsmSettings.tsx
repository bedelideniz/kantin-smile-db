import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Send } from "lucide-react";

interface NetgsmConfig {
  username: string | null;
  msgheader: string | null;
  is_active: boolean;
  has_password: boolean;
  updated_at?: string;
}

interface SmsLogRow {
  id: string;
  phone: string;
  message: string;
  status: string;
  provider_response: string | null;
  created_at: string;
}

async function callOp<T = unknown>(op: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", {
    body: { op, params },
  });
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  }
  return (data as { data: T }).data;
}

export default function NetgsmSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [msgheader, setMsgheader] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [logs, setLogs] = useState<SmsLogRow[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await callOp<NetgsmConfig>("get_netgsm_config");
      setUsername(cfg.username ?? "");
      setMsgheader(cfg.msgheader ?? "");
      setIsActive(!!cfg.is_active);
      setHasPassword(!!cfg.has_password);
      setPassword("");
      const l = await callOp<SmsLogRow[]>("recent_sms_log");
      setLogs(l);
    } catch (e) {
      toast({ title: "Yükleme hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await callOp("save_netgsm_config", {
        username: username.trim(),
        password: password.trim(), // boş = mevcut şifreyi koru
        msgheader: msgheader.trim(),
        is_active: isActive,
      });
      toast({ title: "NetGSM ayarları kaydedildi" });
      setPassword("");
      await load();
    } catch (e) {
      toast({ title: "Kayıt hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) return;
    setTesting(true);
    try {
      const r = await callOp<{ ok: boolean; status: string; raw: string }>("test_sms", {
        phone: testPhone.trim(),
      });
      toast({
        title: r.ok ? "Test SMS gönderildi" : "Test SMS başarısız",
        description: `Durum: ${r.status}${r.raw ? ` — ${r.raw}` : ""}`,
        variant: r.ok ? "default" : "destructive",
      });
      await load();
    } catch (e) {
      toast({ title: "Test hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">NetGSM Ayarları</h2>
        <p className="text-sm text-muted-foreground">
          SMS sağlayıcı bilgilerini girin. Aktif olduğunda okul oluşturma ve giriş kodları SMS olarak gönderilir.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="username">Kullanıcı Kodu (usercode)</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">
            Şifre {hasPassword && <span className="text-xs text-muted-foreground">(kayıtlı — değiştirmek için yazın)</span>}
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasPassword ? "••••••••" : ""}
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="msgheader">Gönderici Başlığı (msgheader)</Label>
          <Input
            id="msgheader"
            value={msgheader}
            onChange={(e) => setMsgheader(e.target.value)}
            placeholder="KANTINPAY"
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            NetGSM panelinde onaylı başlık olmalı.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <Switch
            id="netgsm_active"
            checked={isActive}
            onCheckedChange={setIsActive}
            disabled={loading}
          />
          <Label htmlFor="netgsm_active">Aktif</Label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      <div className="space-y-2 rounded-md border p-4">
        <h3 className="font-medium">Test SMS</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="05XX XXX XX XX"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="sm:max-w-xs"
          />
          <Button variant="secondary" onClick={sendTest} disabled={testing || !testPhone.trim()}>
            <Send className="mr-1 h-4 w-4" />
            {testing ? "Gönderiliyor…" : "Test Mesajı Gönder"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Son SMS Kayıtları</h3>
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Tarih</th>
                <th className="p-2">Telefon</th>
                <th className="p-2">Durum</th>
                <th className="p-2">Mesaj</th>
                <th className="p-2">Yanıt</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-center text-muted-foreground">
                    Henüz kayıt yok.
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2 whitespace-nowrap text-xs">
                    {new Date(l.created_at).toLocaleString("tr-TR")}
                  </td>
                  <td className="p-2 whitespace-nowrap">{l.phone}</td>
                  <td className="p-2">
                    <span
                      className={
                        l.status === "sent"
                          ? "text-green-600"
                          : "text-destructive"
                      }
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="p-2 max-w-[280px] truncate" title={l.message}>
                    {l.message}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground max-w-[200px] truncate" title={l.provider_response ?? ""}>
                    {l.provider_response}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
