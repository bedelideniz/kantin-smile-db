// Super-admin push notification sender — proxies OneSignal REST API.
import { corsHeaders } from "npm:@supabase/supabase-js@2.95.0/cors";
import { z } from "npm:zod@3.23.8";
import { authenticate, HttpError, requireRole } from "../_shared/auth.ts";
import { isDbConnectionError, query } from "../_shared/external-db.ts";

const ONESIGNAL_APP_ID = "be926903-6bc2-43a0-8be0-e66249b2a72a";
const ONESIGNAL_URL = "https://api.onesignal.com/notifications";

const BodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  url: z.string().trim().url().max(500).optional().or(z.literal("")),
  image_url: z.string().trim().url().max(800).optional().or(z.literal("")),
  target: z.enum(["all", "phones", "school"]),
  phones: z.array(z.string().trim().min(3).max(20)).max(2000).optional(),
  school_id: z.string().uuid().optional(),
});

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D+/g, "");
  // Keep only last 10 digits (TR national format) — matches what parent-api uses for external_id.
  return d.slice(-10);
}

async function resolveSchoolPhones(schoolId: string): Promise<string[]> {
  const r = await query<{ parent_phone: string }>(
    `SELECT DISTINCT parent_phone FROM students
      WHERE school_id = $1 AND parent_phone IS NOT NULL AND parent_phone <> ''`,
    [schoolId],
  );
  return r.rows.map((x) => normalizePhone(x.parent_phone)).filter((x) => x.length >= 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authenticate(req);
    requireRole(auth, "super_admin");

    const restKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    if (!restKey) throw new HttpError(500, "ONESIGNAL_REST_API_KEY tanımlı değil");

    const rawBody = await req.json();
    if (rawBody?.debug_view === true) {
      const r = await fetch(`${ONESIGNAL_URL}?app_id=${ONESIGNAL_APP_ID}&limit=10`, {
        headers: { "Authorization": `Key ${restKey}` },
      });
      const b = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ ok: true, debug: b }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const p = parsed.data;

    const payload: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      headings: { tr: p.title, en: p.title },
      contents: { tr: p.message, en: p.message },
      target_channel: "push",
      // Yalnızca mobil uygulamaya gönder — aynı veli web push'a da aboneyse
      // çift bildirim almasın diye web/Chrome/Safari/Firefox abonelikleri hariç tutulur.
      isIos: true,
      isAndroid: true,
      isAnyWeb: false,
      isChromeWeb: false,
      isFirefox: false,
      isSafari: false,
    };
    if (p.url) payload.url = p.url;

    let recipientCount = 0;
    if (p.target === "all") {
      payload.included_segments = ["Subscribed Users"];
    } else {
      let phones: string[] = [];
      if (p.target === "school") {
        if (!p.school_id) throw new HttpError(400, "school_id zorunlu");
        phones = await resolveSchoolPhones(p.school_id);
      } else {
        phones = (p.phones ?? []).map(normalizePhone).filter((x) => x.length >= 10);
      }
      phones = Array.from(new Set(phones));
      if (phones.length === 0) throw new HttpError(400, "Hedef veli bulunamadı");
      recipientCount = phones.length;
      payload.include_aliases = { external_id: phones };
    }

    const res = await fetch(ONESIGNAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${restKey}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.errors ? JSON.stringify(body.errors) : `OneSignal ${res.status}`;
      throw new HttpError(502, msg);
    }
    return new Response(JSON.stringify({
      ok: true,
      data: {
        notification_id: body?.id ?? null,
        recipients: body?.recipients ?? recipientCount,
        target: p.target,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (isDbConnectionError(e)) {
      return new Response(JSON.stringify({ error: "DB ulaşılamıyor", code: "DB_UNAVAILABLE" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-push error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
