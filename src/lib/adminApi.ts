import { supabase } from "@/integrations/supabase/client";

export type AppModule =
  | "schools" | "students" | "marketers" | "splashes" | "donations"
  | "payments" | "sms" | "infrastructure" | "alarms" | "staff";

export const MODULE_LABELS: Record<AppModule, string> = {
  schools: "Okullar",
  students: "Veli & Öğrenci",
  marketers: "Pazarlamacılar",
  splashes: "Veli Splash",
  donations: "Bağış",
  payments: "Ödeme",
  sms: "SMS / NetGSM",
  infrastructure: "Altyapı",
  alarms: "Alarmlar",
  staff: "Personel",
};

export class AdminApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function callAdminApi<T = any>(op: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-api", {
    body: { op, params },
  });
  if (error) {
    // FunctionsHttpError carries the body in .context
    let msg = error.message;
    try {
      const body = await (error as any).context?.json?.();
      if (body?.error) msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
    } catch { /* ignore */ }
    throw new AdminApiError(500, msg);
  }
  if ((data as any)?.error) {
    throw new AdminApiError(400, (data as any).error);
  }
  return (data as any).data as T;
}
