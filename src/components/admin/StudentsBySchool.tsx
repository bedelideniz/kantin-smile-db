import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import StudentsManager from "@/components/yonetici/StudentsManager";
import { generateStudentCardsPdf, type CardStudent } from "@/lib/cardPdf";

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
