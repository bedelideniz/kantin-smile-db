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

    const parsed = BodySchema.safeParse(await req.json());
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
    };
    if (p.url) payload.url = p.url;
    if (p.image_url) {
      // Görsel: Android (big_picture), iOS (ios_attachments), web (chrome_web_image)
      payload.big_picture = p.image_url;
      payload.ios_attachments = { image: p.image_url };
      payload.chrome_web_image = p.image_url;
      payload.huawei_big_picture = p.image_url;
    }

    let recipientCount = 0;
    if (p.target === "all") {
      // Bu OneSignal uygulamasındaki varsayılan segment adı "Total Subscriptions".
      payload.included_segments = ["Total Subscriptions"];
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

    let res = await fetch(ONESIGNAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${restKey}`,
      },
      body: JSON.stringify(payload),
    });
    let body = await res.json().catch(() => ({}));

    // Segment adı bulunamazsa eski varsayılan adla bir kez daha dene.
    if (!res.ok && p.target === "all" && JSON.stringify(body?.errors ?? "").includes("segment")) {
      payload.included_segments = ["Subscribed Users"];
      res = await fetch(ONESIGNAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Key ${restKey}` },
        body: JSON.stringify(payload),
      });
      body = await res.json().catch(() => ({}));
    }

    const errText = JSON.stringify(body?.errors ?? "");
    const noSubs = errText.includes("not subscribed") || errText.includes("no subscribers");

    if (!res.ok || !body?.id || noSubs) {
      console.error("send-push OneSignal error:", res.status, JSON.stringify(body));
      const msg = noSubs
        ? `Hedef veli(ler) henüz KantinPay mobil uygulamasını yükleyip bildirime izin vermemiş, bu yüzden bildirim ulaştırılamadı.${recipientCount ? ` (${recipientCount} numara denendi)` : ""}`
        : (body?.errors ? JSON.stringify(body.errors) : `OneSignal ${res.status}`);
      throw new HttpError(400, msg);
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
