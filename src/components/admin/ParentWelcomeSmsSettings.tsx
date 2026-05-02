import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";

export default function ParentWelcomeSmsSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("db-proxy", {
        body: { op: "get_parent_welcome_template" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : "Yüklenemedi");
      setTemplate((data.data as { template: string }).template ?? "");
    } catch (e) {
      toast({ title: "Yüklenemedi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (template.trim().length < 10) {
      toast({ title: "Çok kısa", description: "Mesaj en az 10 karakter olmalı.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("db-proxy", {
        body: { op: "save_parent_welcome_template", params: { template: template.trim() } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : "Kaydedilemedi");
      toast({ title: "Şablon kaydedildi" });
    } catch (e) {
      toast({ title: "Hata", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">Veli Hoş Geldin SMS Şablonu</h3>
        <p className="text-sm text-muted-foreground">
          Excel ile toplu yükleme yapıldığında yeni eklenen velilere bu mesaj gönderilir.
          Değişkenler: <code className="rounded bg-muted px-1">{"{parent_name}"}</code>,{" "}
          <code className="rounded bg-muted px-1">{"{school_name}"}</code>
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="welcome-tpl">Mesaj İçeriği</Label>
        <Textarea
          id="welcome-tpl"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={4}
          maxLength={500}
          disabled={loading}
          placeholder="Sayin {parent_name}, {school_name} kantin sisteminde hesabiniz aktiftir..."
        />
        <p className="text-xs text-muted-foreground text-right">{template.length} / 500</p>
      </div>
      <Button onClick={save} disabled={saving || loading}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Kaydet
      </Button>
    </div>
  );
}
