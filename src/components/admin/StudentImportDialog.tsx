import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Download, Loader2, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  schoolId: string;
  schoolName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported?: () => void;
}

interface ParsedRow {
  rowNum: number;
  full_name: string;
  class_name: string;
  parent_full_name: string;
  parent_phone: string;
  errors: string[];
}

const REQUIRED_HEADERS = [
  "ogrenci_ad_soyad",
  "sinif",
  "veli_ad",
  "veli_soyad",
  "veli_telefon",
];

// Map of accepted header variants -> canonical key
const HEADER_ALIASES: Record<string, string> = {
  "öğrenci adı soyadı": "ogrenci_ad_soyad",
  "ogrenci adi soyadi": "ogrenci_ad_soyad",
  "öğrenci ad soyad": "ogrenci_ad_soyad",
  "ogrenci_ad_soyad": "ogrenci_ad_soyad",
  "ad soyad": "ogrenci_ad_soyad",
  "sınıf": "sinif",
  "sinif": "sinif",
  "sınıfı": "sinif",
  "veli adı": "veli_ad",
  "veli ad": "veli_ad",
  "veli_ad": "veli_ad",
  "veli soyadı": "veli_soyad",
  "veli soyad": "veli_soyad",
  "veli_soyad": "veli_soyad",
  "veli telefon": "veli_telefon",
  "veli telefonu": "veli_telefon",
  "veli_telefon": "veli_telefon",
  "telefon": "veli_telefon",
};

const PHONE_RE = /^[0-9+\s()-]{10,20}$/;

function normalizeHeader(h: string): string {
  return String(h ?? "").trim().toLowerCase();
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["ogrenci_ad_soyad", "sinif", "veli_ad", "veli_soyad", "veli_telefon"],
    ["Ahmet Yılmaz", "6-A", "Mehmet", "Yılmaz", "05551234567"],
    ["Ayşe Demir", "5-B", "Fatma", "Demir", "05559876543"],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Öğrenciler");
  XLSX.writeFile(wb, "ogrenci-yukleme-sablonu.xlsx");
}

export default function StudentImportDialog({ schoolId, schoolName, open, onOpenChange, onImported }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [sendSms, setSendSms] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<null | {
    total: number; created: number; failed: number;
    new_parents: number; sms_sent: number; sms_failed: number;
  }>(null);

  const reset = () => {
    setRows(null); setFileName(""); setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Excel dosyasında sayfa bulunamadı.");
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
      if (aoa.length < 2) throw new Error("Dosya boş görünüyor (en az 1 başlık + 1 satır).");

      const headerRow = (aoa[0] as unknown[]).map((h) => normalizeHeader(String(h)));
      const colIdx: Record<string, number> = {};
      headerRow.forEach((h, i) => {
        const canon = HEADER_ALIASES[h];
        if (canon) colIdx[canon] = i;
      });
      const missing = REQUIRED_HEADERS.filter((h) => !(h in colIdx));
      if (missing.length) {
        throw new Error(`Şu sütunlar eksik: ${missing.join(", ")}. Şablonu indirip kullanın.`);
      }

      const parsed: ParsedRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const get = (k: string) => String(r[colIdx[k]] ?? "").trim();
        const full_name = get("ogrenci_ad_soyad");
        const class_name = get("sinif");
        const veli_ad = get("veli_ad");
        const veli_soyad = get("veli_soyad");
        const parent_phone = get("veli_telefon");
        // Skip wholly empty rows
        if (!full_name && !veli_ad && !veli_soyad && !parent_phone) continue;
        const parent_full_name = `${veli_ad} ${veli_soyad}`.trim();
        const errors: string[] = [];
        if (full_name.length < 2) errors.push("Öğrenci adı eksik");
        if (parent_full_name.length < 2) errors.push("Veli adı eksik");
        if (!parent_phone || !PHONE_RE.test(parent_phone)) errors.push("Telefon geçersiz");
        parsed.push({
          rowNum: i + 1, full_name, class_name, parent_full_name, parent_phone, errors,
        });
      }
      if (parsed.length === 0) throw new Error("Geçerli bir veri satırı bulunamadı.");
      setRows(parsed);
      setFileName(file.name);
    } catch (e) {
      toast({ title: "Excel okunamadı", description: (e as Error).message, variant: "destructive" });
      reset();
    } finally {
      setParsing(false);
    }
  };

  const validRows = rows?.filter((r) => r.errors.length === 0) ?? [];
  const errorCount = rows?.filter((r) => r.errors.length > 0).length ?? 0;

  const submitImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("db-proxy", {
        body: {
          op: "bulk_import_students",
          params: {
            school_id: schoolId,
            send_welcome_sms: sendSms,
            rows: validRows.map((r) => ({
              full_name: r.full_name,
              class_name: r.class_name || null,
              parent_full_name: r.parent_full_name,
              parent_phone: r.parent_phone,
            })),
          },
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      const d = data.data as typeof result;
      setResult(d);
      toast({
        title: "İçe aktarım tamamlandı",
        description: `${d?.created} öğrenci eklendi, ${d?.failed} başarısız. SMS: ${d?.sms_sent} gönderildi.`,
      });
      onImported?.();
    } catch (e) {
      toast({ title: "İçe aktarım hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Excel ile Öğrenci Yükle</DialogTitle>
          <DialogDescription>
            <strong>{schoolName}</strong> için öğrenci ve veli bilgilerini Excel'den toplu olarak yükleyin.
            Aynı telefona sahip veli zaten varsa öğrenci o veliye bağlanır.
          </DialogDescription>
        </DialogHeader>

        {!rows && !result && (
          <div className="space-y-4 py-4">
            <div className="rounded-md border border-dashed p-6 text-center">
              <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Bir .xlsx dosyası seçin</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sütunlar: ogrenci_ad_soyad, sinif, veli_ad, veli_soyad, veli_telefon
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="mr-1 h-4 w-4" /> Şablonu İndir
                </Button>
                <Button size="sm" onClick={() => fileRef.current?.click()} disabled={parsing}>
                  {parsing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                  Dosya Seç
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          </div>
        )}

        {rows && !result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{fileName}</span>
              <Badge variant="secondary">Toplam: {rows.length}</Badge>
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Geçerli: {validRows.length}
              </Badge>
              {errorCount > 0 && (
                <Badge variant="destructive">
                  <AlertTriangle className="mr-1 h-3 w-3" /> Hatalı: {errorCount}
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={reset} className="ml-auto">Temizle</Button>
            </div>

            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Öğrenci</TableHead>
                    <TableHead>Sınıf</TableHead>
                    <TableHead>Veli</TableHead>
                    <TableHead>Telefon</TableHead>
                    <TableHead>Durum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.rowNum} className={r.errors.length ? "bg-destructive/5" : ""}>
                      <TableCell className="text-xs text-muted-foreground">{r.rowNum}</TableCell>
                      <TableCell className="font-medium">{r.full_name || "—"}</TableCell>
                      <TableCell>{r.class_name || "—"}</TableCell>
                      <TableCell>{r.parent_full_name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.parent_phone || "—"}</TableCell>
                      <TableCell>
                        {r.errors.length === 0 ? (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-300">OK</Badge>
                        ) : (
                          <span className="text-xs text-destructive">{r.errors.join(", ")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center gap-3 rounded-md border p-3">
              <Switch id="send-sms" checked={sendSms} onCheckedChange={setSendSms} />
              <Label htmlFor="send-sms" className="text-sm cursor-pointer">
                Yeni eklenen velilere hoş geldin SMS'i gönder
              </Label>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3 py-4">
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" /> İçe aktarım tamamlandı
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <div>Toplam satır: <strong>{result.total}</strong></div>
                <div className="text-emerald-700">Eklenen: <strong>{result.created}</strong></div>
                <div className="text-destructive">Başarısız: <strong>{result.failed}</strong></div>
                <div>Yeni veli: <strong>{result.new_parents}</strong></div>
                <div className="text-emerald-700">SMS gönderildi: <strong>{result.sms_sent}</strong></div>
                <div className="text-destructive">SMS başarısız: <strong>{result.sms_failed}</strong></div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Kapat</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
                İptal
              </Button>
              {rows && (
                <Button onClick={submitImport} disabled={importing || validRows.length === 0}>
                  {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {validRows.length} Kaydı İçe Aktar
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
