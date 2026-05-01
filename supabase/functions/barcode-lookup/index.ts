// Barcode lookup: queries Open Food Facts + UPCitemdb (free tier).
// Returns a normalized product hint the admin can confirm before saving.
// Auth: requires school_admin (we don't want this endpoint scraped).
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import { authenticate, HttpError, requireSchoolAdminSchool } from "../_shared/auth.ts";

interface ProductHint {
  barcode: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  category_hint: string | null;
  source: "open_food_facts" | "upcitemdb" | "manual";
}

const BodySchema = z.object({
  op: z.literal("lookup"),
  params: z.object({
    barcode: z.string().trim().regex(/^\d{4,32}$/u, "Barkod 4-32 haneli olmalı"),
  }),
});

const UA = "KantinPay/1.0 (+https://kantinpay.app)";
const FETCH_TIMEOUT_MS = 4000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(t);
  }
}

/** Open Food Facts — best for Turkish food/drink products, free, no key required. */
async function tryOpenFoodFacts(barcode: string): Promise<ProductHint | null> {
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json` +
      `?fields=product_name,product_name_tr,brands,image_front_url,image_url,categories_tags`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json?.status !== 1 || !json?.product) return null;
    const p = json.product;
    const name = (p.product_name_tr as string | undefined)?.trim()
      || (p.product_name as string | undefined)?.trim()
      || null;
    if (!name) return null;
    const cats = Array.isArray(p.categories_tags) ? p.categories_tags : [];
    const lastCat = cats.length ? String(cats[cats.length - 1]).replace(/^[a-z]{2}:/i, "").replace(/-/g, " ") : null;
    return {
      barcode,
      name,
      brand: (p.brands as string | undefined)?.split(",")[0]?.trim() || null,
      image_url: (p.image_front_url as string | undefined) || (p.image_url as string | undefined) || null,
      category_hint: lastCat,
      source: "open_food_facts",
    };
  } catch (_e) {
    return null;
  }
}

/** UPCitemdb trial endpoint — wider catalog (incl. stationery, electronics). 100 req/day free. */
async function tryUpcItemDb(barcode: string): Promise<ProductHint | null> {
  try {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json: any = await res.json();
    const item = Array.isArray(json?.items) && json.items.length ? json.items[0] : null;
    if (!item) return null;
    const name = (item.title as string | undefined)?.trim() || null;
    if (!name) return null;
    const images: string[] = Array.isArray(item.images) ? item.images : [];
    return {
      barcode,
      name,
      brand: (item.brand as string | undefined)?.trim() || null,
      image_url: images[0] || null,
      category_hint: (item.category as string | undefined) || null,
      source: "upcitemdb",
    };
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    requireSchoolAdminSchool(ctx); // ensure caller is a school_admin

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { barcode } = parsed.data.params;

    // Run both lookups in parallel; prefer Open Food Facts (more accurate for TR groceries).
    const [off, upc] = await Promise.all([tryOpenFoodFacts(barcode), tryUpcItemDb(barcode)]);
    const hint: ProductHint = off ?? upc ?? {
      barcode,
      name: null,
      brand: null,
      image_url: null,
      category_hint: null,
      source: "manual",
    };

    return new Response(JSON.stringify({ ok: true, data: hint }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("barcode-lookup error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
