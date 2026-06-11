import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Loader2, Save, Eye, Code as CodeIcon, ListChecks, Download, Search,
} from "lucide-react";

interface LegalDoc {
  id: string;
  slug: string;
  title: string;
  content_html: string;
  version: number;
  sort_order: number;
  is_required: boolean;
  updated_at: string;
  created_at: string;
}

interface Consent {
  id: string;
  parent_phone: string;
  document_id: string;
  document_slug: string;
  document_title: string;
  document_version: number;
  accepted_at: string;
  ip: string | null;
  user_agent: string | null;
}

interface Summary {
  id: string;
  slug: string;
  title: string;
  version: number;
  total_consents: number;
  unique_parents: number;
}

const DEFAULT_FILES: Record<string, string> = {
  "uyelik-sozlesmesi": "/legal/uyelik-sozlesmesi.html",
  "kvkk-aydinlatma": "/legal/kvkk-aydinlatma.html",
  "acik-riza": "/legal/acik-riza.html",
  "ticari-elektronik-ileti": "/legal/ticari-elektronik-ileti.html",
};

async function callOp<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("db-proxy", { body: { op, params } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  return data?.data as T;
}

export default function LegalDocumentsManager() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<LegalDoc[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string>("");
  const [draft, setDraft] = useState<{ title: string; content_html: string; is_required: boolean; bump: boolean }>({
    title: "", content_html: "", is_required: true, bump: false,
  });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"edit" | "tracking">("edit");
  const [previewMode, setPreviewMode] = useState<"html" | "preview">("preview");

  const load = async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        callOp<LegalDoc[]>("list_legal_documents"),
        callOp<Summary[]>("legal_consents_summary"),
      ]);
      setDocs(d);
      setSummary(s);
      if (d.length > 0 && !activeId) setActiveId(d[0].id);
    } catch (e: any) {
      toast({ title: "Yüklenemedi", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const active = useMemo(() => docs.find((d) => d.id === activeId) ?? null, [docs, activeId]);

  useEffect(() => {
    if (active) {
      setDraft({
        title: active.title,
        content_html: active.content_html,
        is_required: active.is_required,
        bump: false,
      });
    }
  }, [active?.id]); // eslint-disable-line

  const loadDefault = async () => {
    if (!active) return;
    const url = DEFAULT_FILES[active.slug];
    if (!url) {
      toast({ title: "Şablon yok", description: "Bu belge için varsayılan bir şablon tanımlı değil.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(url);
      const html = await res.text();
      setDraft((s) => ({ ...s, content_html: html }));
      toast({ title: "Şablon yüklendi", description: "Kaydedene kadar uygulanmayacak." });
    } catch (e: any) {
      toast({ title: "Şablon getirilemedi", description: e?.message, variant: "destructive" });
    }
  };

  const save = async () => {
    if (!active) return;
    if (!draft.content_html.trim()) {
      toast({ title: "İçerik boş", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await callOp("update_legal_document", {
        id: active.id,
        title: draft.title,
        content_html: draft.content_html,
        is_required: draft.is_required,
        bump_version: draft.bump,
      });
      toast({
        title: "Kaydedildi",
        description: draft.bump
          ? "Yeni versiyon yayınlandı; veliler yeniden onay vermek zorunda."
          : "İçerik güncellendi (versiyon korundu).",
      });
      await load();
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <div className="text-base font-semibold">Veli Sözleşmeleri</div>
              <div className="text-xs text-muted-foreground">
                Veliler ilk girişlerinde aşağıdaki belgeleri onaylamak zorundadır. Versiyon arttığında tekrar onay istenir.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.map((s) => (
              <div key={s.id} className="rounded-lg border bg-muted/40 px-3 py-1.5 text-xs">
                <div className="font-medium">{s.title}</div>
                <div className="text-muted-foreground">
                  v{s.version} · <strong>{s.unique_parents}</strong> veli onayladı
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="edit"><FileText className="mr-2 h-4 w-4" /> Düzenle</TabsTrigger>
          <TabsTrigger value="tracking"><ListChecks className="mr-2 h-4 w-4" /> Onay Takibi</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="space-y-1">
                {docs.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setActiveId(d.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${activeId === d.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                  >
                    <span className="truncate">{d.title}</span>
                    <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">v{d.version}</Badge>
                  </button>
                ))}
              </div>

              {active && (
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Başlık</Label>
                        <Input value={draft.title} onChange={(e) => setDraft((s) => ({ ...s, title: e.target.value }))} />
                      </div>
                      <div className="flex items-end gap-4">
                        <div className="flex items-center gap-2">
                          <Switch checked={draft.is_required} onCheckedChange={(v) => setDraft((s) => ({ ...s, is_required: v }))} id="req" />
                          <Label htmlFor="req" className="text-xs cursor-pointer">Zorunlu</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={draft.bump} onCheckedChange={(v) => setDraft((s) => ({ ...s, bump: v }))} id="bump" />
                          <Label htmlFor="bump" className="text-xs cursor-pointer">Yeni versiyon yayınla</Label>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant={previewMode === "preview" ? "default" : "outline"} onClick={() => setPreviewMode("preview")}>
                          <Eye className="mr-1.5 h-3.5 w-3.5" /> Önizle
                        </Button>
                        <Button size="sm" variant={previewMode === "html" ? "default" : "outline"} onClick={() => setPreviewMode("html")}>
                          <CodeIcon className="mr-1.5 h-3.5 w-3.5" /> HTML
                        </Button>
                      </div>
                      <Button size="sm" variant="outline" onClick={loadDefault}>
                        <Download className="mr-1.5 h-3.5 w-3.5" /> Varsayılan şablonu yükle
                      </Button>
                    </div>

                    {previewMode === "html" ? (
                      <Textarea
                        value={draft.content_html}
                        onChange={(e) => setDraft((s) => ({ ...s, content_html: e.target.value }))}
                        rows={22}
                        className="font-mono text-xs"
                      />
                    ) : (
                      <ScrollArea className="h-[55vh] rounded border bg-background p-4">
                        <article
                          className="prose prose-sm max-w-none dark:prose-invert"
                          dangerouslySetInnerHTML={{ __html: draft.content_html || "<p class='text-muted-foreground'>(boş)</p>" }}
                        />
                      </ScrollArea>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Mevcut versiyon: <strong>v{active.version}</strong> · Son güncelleme: {new Date(active.updated_at).toLocaleString("tr-TR")}
                      </div>
                      <Button onClick={save} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Kaydet
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tracking" className="mt-4">
          <ConsentTracking docs={docs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConsentTracking({ docs }: { docs: LegalDoc[] }) {
  const { toast } = useToast();
  const [docFilter, setDocFilter] = useState<string>("__all__");
  const [phone, setPhone] = useState("");
  const [items, setItems] = useState<Consent[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (docFilter !== "__all__") params.document_id = docFilter;
      if (phone.trim()) params.phone = phone.trim();
      const r = await callOp<Consent[]>("list_legal_consents", params);
      setItems(r);
    } catch (e: any) {
      toast({ title: "Listelenemedi", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [docFilter]);
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 350);
    return () => { if (debounce.current) window.clearTimeout(debounce.current); };
    // eslint-disable-next-line
  }, [phone]);

  const exportCsv = () => {
    const rows = [["Telefon", "Belge", "Versiyon", "Onay Tarihi", "IP"]];
    items.forEach((c) => rows.push([c.parent_phone, c.document_title, String(c.document_version), c.accepted_at, c.ip ?? ""]));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sozlesme-onaylari-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={docFilter}
            onChange={(e) => setDocFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="__all__">Tüm belgeler</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Telefon ara (5XX...)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={items.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
        </div>

        <div className="overflow-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Telefon</th>
                <th className="px-3 py-2 text-left">Belge</th>
                <th className="px-3 py-2 text-left">Versiyon</th>
                <th className="px-3 py-2 text-left">Tarih</th>
                <th className="px-3 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Onay kaydı yok.</td></tr>
              )}
              {!loading && items.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono">{c.parent_phone}</td>
                  <td className="px-3 py-2">{c.document_title}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">v{c.document_version}</Badge></td>
                  <td className="px-3 py-2 text-xs">{new Date(c.accepted_at).toLocaleString("tr-TR")}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-muted-foreground">Toplam: {items.length} kayıt</div>
      </CardContent>
    </Card>
  );
}
