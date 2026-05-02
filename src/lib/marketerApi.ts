import { supabase } from "@/integrations/supabase/client";

export async function callMarketerApi<T = any>(action: string, payload?: any): Promise<T> {
  const { data, error } = await supabase.functions.invoke("marketer-api", {
    body: { action, payload },
  });
  if (error) throw error;
  if ((data as any)?.error) {
    const msg = typeof (data as any).error === "string"
      ? (data as any).error
      : JSON.stringify((data as any).error);
    throw new Error(msg);
  }
  return data as T;
}

export interface MarketerSummary {
  school_count: number;
  bonus_pending: number;
  bonus_approved: number;
  bonus_paid: number;
  earnings_pending: number;
  earnings_approved: number;
  earnings_paid: number;
  payouts_total: number;
  owed_total: number;
  lifetime_earned: number;
  current_month_share: number;
}

export interface MarketerListItem {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  signup_bonus: string | number;
  commission_share_rate: string | number;
  is_active: boolean;
  notes: string | null;
  auth_user_id: string | null;
  created_at: string;
  school_count: number;
  bonus_approved: string | number;
  bonus_paid: string | number;
  earnings_approved: string | number;
  earnings_paid: string | number;
  earnings_pending: string | number;
  total_payouts: string | number;
}

export const formatTRY = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(v ?? 0));

export const formatPercent = (v: number | string | null | undefined) =>
  `${(Number(v ?? 0) * 100).toFixed(2)}%`;

export const MONTH_NAMES_TR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
