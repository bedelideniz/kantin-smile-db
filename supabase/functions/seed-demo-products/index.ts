// One-shot seeder: creates demo categories + ~12 products with photo URLs for a school.
// Requires super_admin auth. Safe to re-run: skips items whose names already exist.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { authenticate, HttpError, requireRole } from "../_shared/auth.ts";
import { query } from "../_shared/external-db.ts";

interface DemoProduct {
  name: string;
  price: number;
  image_url: string;
  category: string;
  barcode?: string;
  stock_qty?: number;
}

const CATEGORIES: { name: string; color: string }[] = [
  { name: "İçecekler", color: "#3B82F6" },
  { name: "Atıştırmalık", color: "#F59E0B" },
  { name: "Tatlı & Çikolata", color: "#EC4899" },
  { name: "Sandviç & Tost", color: "#10B981" },
  { name: "Sağlıklı", color: "#84CC16" },
];

const PRODUCTS: DemoProduct[] = [
  // İçecekler
  { name: "Su 0.5L", price: 10, category: "İçecekler",
    image_url: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400&q=80", stock_qty: 100 },
  { name: "Ayran 200ml", price: 15, category: "İçecekler",
    image_url: "https://images.unsplash.com/photo-1628621546208-f0bcb7321229?w=400&q=80", stock_qty: 60 },
  { name: "Portakal Suyu", price: 25, category: "İçecekler",
    image_url: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&q=80", stock_qty: 40 },
  { name: "Süt 200ml", price: 18, category: "İçecekler",
    image_url: "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80", stock_qty: 50 },
  // Atıştırmalık
  { name: "Simit", price: 12, category: "Atıştırmalık",
    image_url: "https://images.unsplash.com/photo-1620207418302-439b387441b0?w=400&q=80", stock_qty: 80 },
  { name: "Patates Cipsi", price: 22, category: "Atıştırmalık",
    image_url: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80", stock_qty: 70 },
  { name: "Kraker", price: 14, category: "Atıştırmalık",
    image_url: "https://images.unsplash.com/photo-1590005354167-6da97870c757?w=400&q=80", stock_qty: 90 },
  // Tatlı & Çikolata
  { name: "Çikolata", price: 20, category: "Tatlı & Çikolata",
    image_url: "https://images.unsplash.com/photo-1606312619070-d48b4c652a52?w=400&q=80", stock_qty: 60 },
  { name: "Kek", price: 18, category: "Tatlı & Çikolata",
    image_url: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80", stock_qty: 40 },
  { name: "Dondurma", price: 30, category: "Tatlı & Çikolata",
    image_url: "https://images.unsplash.com/photo-1567206563064-6f60f40a2b57?w=400&q=80", stock_qty: 35 },
  // Sandviç & Tost
  { name: "Kaşarlı Tost", price: 45, category: "Sandviç & Tost",
    image_url: "https://images.unsplash.com/photo-1528736235302-52922df5c122?w=400&q=80", stock_qty: 25 },
  { name: "Sucuklu Tost", price: 55, category: "Sandviç & Tost",
    image_url: "https://images.unsplash.com/photo-1539252554935-80c8cbe6647e?w=400&q=80", stock_qty: 25 },
  { name: "Sandviç", price: 40, category: "Sandviç & Tost",
    image_url: "https://images.unsplash.com/photo-1553909489-cd47e0ef937f?w=400&q=80", stock_qty: 30 },
  // Sağlıklı
  { name: "Elma", price: 8, category: "Sağlıklı",
    image_url: "https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=400&q=80", stock_qty: 50 },
  { name: "Muz", price: 10, category: "Sağlıklı",
    image_url: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80", stock_qty: 50 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    requireRole(ctx, "super_admin");

    const body = await req.json().catch(() => ({}));
    const schoolId = (body?.school_id as string | undefined)?.trim();
    if (!schoolId) throw new HttpError(400, "school_id required");

    // 1) Upsert categories (by name within school)
    const catMap = new Map<string, string>();
    for (let i = 0; i < CATEGORIES.length; i++) {
      const c = CATEGORIES[i];
      const ex = await query<{ id: string }>(
        "SELECT id FROM categories WHERE school_id=$1 AND name=$2 LIMIT 1",
        [schoolId, c.name],
      );
      if (ex.rows[0]) {
        catMap.set(c.name, ex.rows[0].id);
      } else {
        const r = await query<{ id: string }>(
          `INSERT INTO categories (school_id, name, color, sort_order, is_active)
           VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
          [schoolId, c.name, c.color, i],
        );
        catMap.set(c.name, r.rows[0].id);
      }
    }

    // 2) Insert products, skipping duplicates by name
    let created = 0, skipped = 0;
    for (let i = 0; i < PRODUCTS.length; i++) {
      const p = PRODUCTS[i];
      const catId = catMap.get(p.category);
      const ex = await query(
        "SELECT 1 FROM products WHERE school_id=$1 AND name=$2 LIMIT 1",
        [schoolId, p.name],
      );
      if (ex.rowCount && ex.rowCount > 0) { skipped++; continue; }
      await query(
        `INSERT INTO products (school_id, category_id, name, price, image_url, barcode,
                               stock_tracking, stock_qty, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,NULL,TRUE,$6,TRUE,$7)`,
        [schoolId, catId, p.name, p.price, p.image_url, p.stock_qty ?? 0, i],
      );
      created++;
    }

    return new Response(JSON.stringify({ ok: true, created, skipped, categories: catMap.size }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
