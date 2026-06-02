import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import StudentsManager from "@/components/yonetici/StudentsManager";
import { generateStudentCardsPdf, type CardStudent } from "@/lib/cardPdf";
import { generateParentLettersPdf, type LetterStudent } from "@/lib/letterPdf";

interface School {
  id: string;
  name: string;
  is_active: boolean;
}

export default function StudentsBySchool() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [printing, setPrinting] = useState(false);
  const [printingLetters, setPrintingLetters] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("db-proxy", {
        body: { op: "list_schools" },
      });
      setLoading(false);
      if (error || (data && (data as any).error)) {
        toast({
          title: "Okullar yüklenemedi",
          description: error?.message ?? (data as any).error,
          variant: "destructive",
        });
        return;
      }
      const rows = ((data as any)?.data ?? []) as School[];
      setSchools(rows);
      if (rows.length === 1) setSelectedId(rows[0].id);
    })();
  }, [toast]);

  const selectedSchool = schools.find((s) => s.id === selectedId);

  async function handlePrintCards() {
    if (!selectedSchool) return;
    setPrinting(true);
    try {
      const { data, error } = await supabase.functions.invoke("db-proxy", {
        body: { op: "list_students", params: { school_id: selectedId } },
      });
      if (error) throw new Error(error.message);
      if (data && (data as any).error) throw new Error((data as any).error);
      const students = (((data as any)?.data ?? []) as CardStudent[]).filter((s) => s.full_name);
      if (students.length === 0) {
        toast({ title: "Öğrenci bulunamadı", variant: "destructive" });
        return;
      }
      await generateStudentCardsPdf({ schoolName: selectedSchool.name, students });
      toast({ title: "PDF hazır", description: `${students.length} kart oluşturuldu.` });
    } catch (e) {
      toast({
        title: "PDF oluşturulamadı",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
  }

  async function handlePrintLetters() {
    if (!selectedSchool) return;
    setPrintingLetters(true);
    try {
      const { data, error } = await supabase.functions.invoke("db-proxy", {
        body: { op: "list_students", params: { school_id: selectedId } },
      });
      if (error) throw new Error(error.message);
      if (data && (data as any).error) throw new Error((data as any).error);
      const students = (((data as any)?.data ?? []) as LetterStudent[]).filter((s) => s.full_name);
      if (students.length === 0) {
        toast({ title: "Öğrenci bulunamadı", variant: "destructive" });
        return;
      }
      await generateParentLettersPdf({
        schoolName: selectedSchool.name,
        students,
        withCard: true,
      });
      toast({ title: "PDF hazır", description: `${students.length} veli mektubu (kart ile) oluşturuldu.` });
    } catch (e) {
      toast({
        title: "PDF oluşturulamadı",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPrintingLetters(false);
    }
  }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="school-select">Okul Seçin</Label>
              {loading ? (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Yükleniyor...
                </div>
              ) : (
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger id="school-select">
                    <SelectValue placeholder="Okul seçin..." />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} {!s.is_active && "(pasif)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handlePrintCards}
              disabled={!selectedId || printing || printingLetters}
              className="sm:w-auto"
            >
              {printing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Kartları PDF
            </Button>
            <Button
              type="button"
              onClick={handlePrintLetters}
              disabled={!selectedId || printing || printingLetters}
              className="sm:w-auto"
            >
              {printingLetters ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              Mektup + Kart PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedId ? (
        <StudentsManager key={selectedId} schoolId={selectedId} />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Öğrencileri görmek için yukarıdan bir okul seçin.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
