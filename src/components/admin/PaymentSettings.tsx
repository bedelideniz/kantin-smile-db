import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";

type Provider = "iyzico" | "paytr" | "";

interface PaymentConfig {
  active_provider: Provider | null;
  iyzico_api_key: string | null;
  iyzico_base_url: string | null;
  paytr_merchant_id: string | null;
  has_iyzico_secret: boolean;
  has_paytr_key: boolean;
  has_paytr_salt: boolean;
  updated_at?: string;
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

export default function PaymentSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [provider, setProvider] = useState<Provider>("");
  const [iyzicoApiKey, setIyzicoApiKey] = useState("");
  const [iyzicoSecret, setIyzicoSecret] = useState("");
  const [iyzicoBaseUrl, setIyzicoBaseUrl] = useState("https://api.iyzipay.com");
  const [hasIyzicoSecret, setHasIyzicoSecret] = useState(false);

  const [paytrMerchantId, setPaytrMerchantId] = useState("");
  const [paytrKey, setPaytrKey] = useState("");
  const [paytrSalt, setPaytrSalt] = useState("");
  const [hasPaytrKey, setHasPaytrKey] = useState(false);
  const [hasPaytrSalt, setHasPaytrSalt] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const cfg = await callOp<PaymentConfig>("get_payment_config");
      setProvider((cfg.active_provider ?? "") as Provider);
      setIyzicoApiKey(cfg.iyzico_api_key ?? "");
      setIyzicoBaseUrl(cfg.iyzico_base_url ?? "https://api.iyzipay.com");
      setHasIyzicoSecret(!!cfg.has_iyzico_secret);
      setPaytrMerchantId(cfg.paytr_merchant_id ?? "");
      setHasPaytrKey(!!cfg.has_paytr_key);
      setHasPaytrSalt(!!cfg.has_paytr_salt);
      setIyzicoSecret("");
      setPaytrKey("");
      setPaytrSalt("");
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
      await callOp("save_payment_config", {
        active_provider: provider === "" ? null : provider,
        iyzico_api_key: iyzicoApiKey.trim() || null,
        iyzico_secret_key: iyzicoSecret.trim(),
        iyzico_base_url: iyzicoBaseUrl.trim() || null,
        paytr_merchant_id: paytrMerchantId.trim() || null,
        paytr_merchant_key: paytrKey.trim(),
        paytr_merchant_salt: paytrSalt.trim(),
      });
      toast({ title: "Ödeme ayarları kaydedildi" });
      await load();
    } catch (e) {
      toast({ title: "Kayıt hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Ödeme Sağlayıcı Ayarları</h2>
        <p className="text-sm text-muted-foreground">
          Platform genelinde tek bir aktif sağlayıcı kullanılır. Sadece SüperAdmin değiştirebilir.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Aktif Sağlayıcı</Label>
        <RadioGroup
          value={provider}
          onValueChange={(v) => setProvider(v as Provider)}
          className="flex flex-wrap gap-4"
        >
          <label className="flex items-center gap-2">
            <RadioGroupItem value="iyzico" id="prov_iyzico" />
            <span>iyzico</span>
          </label>
          <label className="flex items-center gap-2">
            <RadioGroupItem value="paytr" id="prov_paytr" />
            <span>PayTR</span>
          </label>
          <label className="flex items-center gap-2">
            <RadioGroupItem value="" id="prov_none" />
            <span className="text-muted-foreground">Hiçbiri (devre dışı)</span>
          </label>
        </RadioGroup>
      </div>

      <div className="rounded-md border p-4 space-y-4">
        <h3 className="font-medium">iyzico</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="iyz_api">API Key</Label>
            <Input
              id="iyz_api"
              value={iyzicoApiKey}
              onChange={(e) => setIyzicoApiKey(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iyz_secret">
              Secret Key {hasIyzicoSecret && <span className="text-xs text-muted-foreground">(kayıtlı — değiştirmek için yazın)</span>}
            </Label>
            <Input
              id="iyz_secret"
              type="password"
              value={iyzicoSecret}
              onChange={(e) => setIyzicoSecret(e.target.value)}
              placeholder={hasIyzicoSecret ? "••••••••" : ""}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="iyz_base">Base URL</Label>
            <Input
              id="iyz_base"
              value={iyzicoBaseUrl}
              onChange={(e) => setIyzicoBaseUrl(e.target.value)}
              disabled={loading}
              placeholder="https://api.iyzipay.com"
            />
            <p className="text-xs text-muted-foreground">
              Test için: <code>https://sandbox-api.iyzipay.com</code>
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-md border p-4 space-y-4">
        <h3 className="font-medium">PayTR</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="pt_id">Merchant ID</Label>
            <Input
              id="pt_id"
              value={paytrMerchantId}
              onChange={(e) => setPaytrMerchantId(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt_key">
              Merchant Key {hasPaytrKey && <span className="text-xs text-muted-foreground">(kayıtlı)</span>}
            </Label>
            <Input
              id="pt_key"
              type="password"
              value={paytrKey}
              onChange={(e) => setPaytrKey(e.target.value)}
              placeholder={hasPaytrKey ? "••••••••" : ""}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt_salt">
              Merchant Salt {hasPaytrSalt && <span className="text-xs text-muted-foreground">(kayıtlı)</span>}
            </Label>
            <Input
              id="pt_salt"
              type="password"
              value={paytrSalt}
              onChange={(e) => setPaytrSalt(e.target.value)}
              placeholder={hasPaytrSalt ? "••••••••" : ""}
              disabled={loading}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        <Button variant="outline" onClick={load} disabled={loading || saving}>
          Yenile
        </Button>
      </div>
    </div>
  );
}
