import { useEffect, useState } from "react";
import { callParentApi } from "@/lib/parentApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck } from "lucide-react";

interface LegalDoc {
  id: string;
  slug: string;
  title: string;
  content_html: string;
  version: number;
  sort_order: number;
  is_required: boolean;
  accepted_version: number | null;
  accepted_at: string | null;
  pending: boolean;
}

export default function ConsentGate() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<LegalDoc[] | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    callParentApi<LegalDoc[]>("list_legal_documents")
      .then((rows) => {
        if (cancelled) return;
        // Only block on documents that are required, pending, AND have content set by admin.
        const pending = rows.filter((d) => d.pending && d.is_required && d.content_html && d.content_html.trim().length > 20);
        setDocs(pending);
        if (pending.length > 0) setActiveTab(pending[0].id);
      })
      .catch(() => { /* fail silent — non-blocking */ });
    return () => { cancelled = true; };
  }, []);

  if (!docs || docs.length === 0) return null;

  const currentIndex = Math.max(0, docs.findIndex((d) => d.id === activeTab));
  const currentDoc = docs[currentIndex];
  const isLast = currentIndex === docs.length - 1;
  const currentChecked = currentDoc ? !!accepted[currentDoc.id] : false;
  const allChecked = docs.every((d) => accepted[d.id]);

  const handleNext = async () => {
    if (!currentChecked) return;
    if (!isLast) {
      setActiveTab(docs[currentIndex + 1].id);
      return;
    }
    if (!allChecked) return;
    setSubmitting(true);
    try {
      await callParentApi("accept_legal_documents", { document_ids: docs.map((d) => d.id) });
      setDocs([]);
      toast({ title: "Teşekkürler", description: "Sözleşmeler onaylandı." });
    } catch (e: any) {
      toast({ title: "Onaylanamadı", description: e?.message ?? "Hata", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent
        className="max-w-3xl w-[calc(100vw-1rem)] sm:w-full p-0 overflow-hidden gap-0 max-h-[95vh] sm:max-h-[92vh] [&>button.absolute]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b bg-muted/40 p-3 sm:p-4">
          <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">Sözleşme ve aydınlatma metinleri</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            KantinPay'i kullanmaya başlamadan önce aşağıdaki {docs.length} belgeyi okuyup onaylamanız gerekmektedir.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col min-w-0">
          <TabsList className="m-2 sm:m-3 mb-0 h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
            {docs.map((d, i) => (
              <TabsTrigger key={d.id} value={d.id} className="text-[11px] sm:text-xs data-[state=active]:bg-background px-2 py-1">
                {i + 1}. {d.title}
                {accepted[d.id] && <span className="ml-1 text-primary">✓</span>}
              </TabsTrigger>
            ))}
          </TabsList>

          {docs.map((d) => (
            <TabsContent key={d.id} value={d.id} className="m-0 flex flex-col min-w-0">
              <ScrollArea className="h-[50vh] sm:h-[55vh] px-3 sm:px-4 py-3">
                <article
                  className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-table:text-xs break-words [&_*]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: d.content_html || "<p class='text-muted-foreground'>Bu belgenin içeriği henüz yüklenmemiş.</p>" }}
                />
              </ScrollArea>
              <label className="flex cursor-pointer items-start gap-3 border-t bg-muted/30 p-3 sm:p-4 hover:bg-muted/60">
                <Checkbox
                  checked={!!accepted[d.id]}
                  onCheckedChange={(v) => setAccepted((s) => ({ ...s, [d.id]: !!v }))}
                  className="mt-0.5"
                />
                <span className="text-xs leading-relaxed">
                  <strong>"{d.title}"</strong> belgesini okudum, anladım ve kabul ediyorum.
                </span>
              </label>
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex items-center justify-between gap-2 border-t bg-background p-3">
          <div className="text-xs text-muted-foreground shrink-0">
            Adım <strong>{currentIndex + 1}</strong> / {docs.length}
          </div>
          <Button onClick={handleNext} disabled={!currentChecked || submitting || (isLast && !allChecked)} size="sm" className="shrink-0">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLast ? "Onayla ve bitir" : "Onayla ve devam et"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
