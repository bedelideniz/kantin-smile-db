# KantinPay Veli (Parent) REST API Dökümantasyonu

Bu döküman, **veli paneli** için kullanılan `parent-api` edge function'ının REST arayüzünü açıklar. Tüm istekler tek bir endpoint'e `POST` yöntemiyle gönderilir; çağrılacak işlem `op` alanı ile, parametreler ise `params` alanı ile belirtilir (RPC stili).

> Yardımcı endpoint'ler (kantinci, yönetici, pazarlamacı, bağış yöneticisi, admin) aynı tasarım deseniyle çalışır. Bu döküman özellikle veli (parent) paneline odaklanır; sonda diğer API'ler için kısa bir özet verilmiştir.

---

## 1. Temel Bilgiler

| Alan | Değer |
|------|-------|
| Base URL | `https://cwrlhyuwgoxsmqotnccs.functions.supabase.co/parent-api` |
| HTTP Method | `POST` (her zaman) |
| Content-Type | `application/json` |
| Auth | OTP ile alınan `Bearer <token>` (korumalı işlemler için zorunlu) |
| CORS | Tüm originlere açık |

### İstek formatı

```json
{
  "op": "<işlem_adı>",
  "params": { ...parametreler }
}
```

### Başarılı yanıt

```json
{
  "ok": true,
  "data": { ...işleme özel veri }
}
```

### Hata yanıtı

```json
{ "error": "Hata mesajı" }
```

veya doğrulama hatasında:

```json
{ "error": { "fieldName": ["..."] } }
```

| HTTP Kodu | Anlamı |
|-----------|--------|
| 400 | Geçersiz parametre / iş kuralı (örn. yetersiz bakiye) |
| 401 | Oturum yok / OTP hatalı |
| 403 | Bu öğrenciye erişim yok |
| 404 | Kayıt bulunamadı / bilinmeyen işlem |
| 413 | Yüklenen dosya çok büyük |
| 429 | Çok fazla OTP isteği (5 dk / 3 istek limiti) |
| 500 | Sunucu hatası |
| 502 | SMS sağlayıcı hatası |

### Kimlik doğrulama akışı

1. `login_request` → telefon numarasına SMS ile 6 haneli OTP gönderilir.
2. `login_verify` → OTP doğrulanır, `token` ve `expires_at` döner.
3. Korumalı tüm isteklerde `Authorization: Bearer <token>` başlığı eklenir.
4. Token süresi varsayılan **14 gün**, "beni hatırla" ile **30 gün**.

---

## 2. Public (Auth Gerekmeyen) İşlemler

### `login_request` — OTP Gönder

Telefon numarasına bağlı en az bir aktif öğrenci varsa OTP üretip SMS ile gönderir. Yoksa `404` döner (veliler kendi kendine kayıt olmaz).

**Parametreler**

| Alan | Tip | Açıklama |
|------|-----|----------|
| `phone` | string | 10–20 karakter; `5xx…`, `05xx…`, `+905xx…` kabul edilir |

**İstek**
```http
POST /parent-api
Content-Type: application/json

{
  "op": "login_request",
  "params": { "phone": "5551112233" }
}
```

**Yanıt**
```json
{ "ok": true, "data": { "ok": true, "student_count": 2 } }
```

**Hatalar**
- `404` — Bu telefona kayıtlı aktif öğrenci yok
- `429` — Son 5 dakikada 3 OTP istendi
- `502` — SMS gönderilemedi

---

### `login_verify` — OTP Doğrula & Oturum Aç

**Parametreler**

| Alan | Tip | Açıklama |
|------|-----|----------|
| `phone` | string | login_request ile aynı numara |
| `code` | string (6 hane) | SMS ile gelen OTP |
| `remember` | boolean (ops.) | `true` ise token 30 gün geçerli |

**Yanıt**
```json
{
  "ok": true,
  "data": {
    "token": "9f8e…",
    "expires_at": "2026-05-21T10:00:00.000Z",
    "students": [
      {
        "id": "uuid",
        "school_id": "uuid",
        "school_name": "Test Okulu",
        "full_name": "Ali Yılmaz",
        "class_name": "5-A",
        "student_no": "123",
        "balance": 245.50
      }
    ]
  }
}
```

---

### `get_school_splash` — Okulun Aktif Splash Görseli

Okul dashboard duyurusunu döner. Yoksa `null`.

**Parametreler:** `school_id: uuid`

**Yanıt**
```json
{ "ok": true, "data": { "image_url": "...", "link_url": "https://..." } }
```

---

### `get_school_donation_info` — Okulun Bağış Ayarları

**Parametreler:** `school_id: uuid`

**Yanıt**
```json
{
  "ok": true,
  "data": {
    "presets": [10, 25, 50, 100, 250],
    "is_enabled": true,
    "thank_you_message": "Teşekkürler!"
  }
}
```

---

## 3. Korumalı İşlemler

> Tüm bu istekler için `Authorization: Bearer <token>` zorunludur. Token geçersiz/süresi dolmuşsa `401` döner.

### `me` — Oturum Sahibinin Öğrencileri

Telefon numarasına bağlı tüm aktif öğrencileri (ek olarak `photo_url`, `card_lost`, `has_card` ile birlikte) döner.

**Parametre:** yok

**Yanıt**
```json
{
  "ok": true,
  "data": {
    "phone": "5551112233",
    "students": [
      {
        "id": "uuid",
        "school_id": "uuid",
        "school_name": "Test Okulu",
        "full_name": "Ali Yılmaz",
        "class_name": "5-A",
        "student_no": "123",
        "balance": 245.50,
        "photo_url": "https://…/student.jpg",
        "card_lost": false,
        "has_card": true
      }
    ]
  }
}
```

---

### `logout` — Oturumu Kapat

Mevcut token'ı silinir.

**Yanıt:** `{ "ok": true, "data": { "ok": true } }`

---

### `get_student` — Tek Öğrenci Detayı

**Parametreler:** `student_id: uuid`

Velinin sahip olduğu öğrencinin güncel bilgilerini döner. Sahip değilse `404`.

---

### `set_card_lost` — Kart Kayıp/Bulundu İşareti

**Parametreler**

| Alan | Tip |
|------|-----|
| `student_id` | uuid |
| `card_lost` | boolean |

`true` yapıldığında kart kantinde geçersizdir, satış engellenir. Kantinci "Kart Bulundu" diyerek kapatabilir.

**Yanıt:** `{ "id": "uuid", "card_lost": true }`

---

### `list_notifications` — Bildirimler

**Parametreler**

| Alan | Tip | Varsayılan |
|------|-----|-----------|
| `limit` | int 1–100 | 50 |
| `only_unread` | boolean | false |

**Yanıt**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "student_id": "uuid",
      "student_name": "Ali Yılmaz",
      "kind": "purchase",
      "title": "Satış",
      "body": "...",
      "meta": { },
      "read_at": null,
      "created_at": "2026-05-07T08:00:00Z"
    }
  ],
  "unread_count": 3
}
```

---

### `mark_notifications_read` — Bildirim(ler)i Okundu İşaretle

**Parametreler** (en az biri)

| Alan | Tip |
|------|-----|
| `ids` | uuid[] (belirli bildirimleri) |
| `all` | boolean (tümünü) |

---

### `upload_student_photo` — Öğrenci Profil Fotoğrafı

**Parametreler**

| Alan | Tip | Notlar |
|------|-----|--------|
| `student_id` | uuid | |
| `image_base64` | string | `data:image/jpeg;base64,...` veya saf base64; max **~1.5 MB** |

Görsel `student-photos` bucket'ına yüklenir, eski dosya temizlenir, `students.photo_url` güncellenir.

**Yanıt:** `{ "photo_url": "https://…/uuid-…jpg" }`

---

### `list_transactions` — Hesap Hareketleri

Satışları (`kind=sale`) ve iadeleri (`kind=refund`) tek listede döner.

**Parametreler**

| Alan | Tip | Varsayılan |
|------|-----|-----------|
| `student_id` | uuid | — |
| `limit` | int 1–100 | 50 |

**Yanıt** — her satır:

```json
{
  "id": "uuid",
  "kind": "sale",
  "total_amount": 35.00,
  "balance_before": 280.50,
  "balance_after": 245.50,
  "created_at": "...",
  "payment_method": "balance",
  "status": "completed",
  "items": [
    { "product_name": "Tost", "qty": 1, "unit_price": 25, "line_total": 25 },
    { "product_name": "Su",   "qty": 1, "unit_price": 10, "line_total": 10 }
  ]
}
```

---

### `list_school_products` — Okuldaki Tüm Aktif Ürünler

**Parametreler:** `student_id: uuid`

Yasaklı ürün ekranı için kullanılır. Her ürün kategori bilgisi ile birlikte döner.

**Yanıt** — örnek satır:
```json
{
  "id": "uuid",
  "name": "Çikolata",
  "price": "12.50",
  "image_url": null,
  "category_id": "uuid",
  "category_name": "Atıştırmalık",
  "category_color": "#FFAA00",
  "category_sort": 1
}
```

---

### `list_blocked_products` — Yasaklı Ürün ID'leri

**Parametreler:** `student_id: uuid`
**Yanıt:** `["uuid", "uuid", ...]`

---

### `set_product_block` — Ürün Yasakla / Kaldır

**Parametreler**

| Alan | Tip |
|------|-----|
| `student_id` | uuid |
| `product_id` | uuid |
| `blocked` | boolean |

`true`: kantinde bu ürün satılamaz. `false`: yasak kaldırılır.

---

### `donate_from_balance` — Bakiyeden Bağış

Öğrencinin bakiyesinden okul bağış havuzuna **komisyonsuz** atomik transfer yapar.

**Parametreler**

| Alan | Tip | Notlar |
|------|-----|--------|
| `student_id` | uuid | |
| `amount` | number | min **1 ₺**, max 100.000; 2 ondalık |

**Hatalar**
- `400` — Bakiye yetersiz / amount < 1
- `403` — Bu öğrenciye erişim yok

**Yanıt**
```json
{
  "ok": true,
  "donation_id": "uuid",
  "student_balance_after": 200.00,
  "pool_balance_after": 1245.00
}
```

---

## 4. Hızlı Başlangıç (cURL)

```bash
# 1) OTP iste
curl -X POST https://cwrlhyuwgoxsmqotnccs.functions.supabase.co/parent-api \
  -H 'Content-Type: application/json' \
  -d '{"op":"login_request","params":{"phone":"5551112233"}}'

# 2) OTP doğrula → token al
TOKEN=$(curl -s -X POST https://cwrlhyuwgoxsmqotnccs.functions.supabase.co/parent-api \
  -H 'Content-Type: application/json' \
  -d '{"op":"login_verify","params":{"phone":"5551112233","code":"123456","remember":true}}' \
  | jq -r '.data.token')

# 3) Korumalı işlem
curl -X POST https://cwrlhyuwgoxsmqotnccs.functions.supabase.co/parent-api \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"op":"me"}'
```

---

## 5. JavaScript / TypeScript İstemcisi

Frontend'de hazır bir wrapper var: `src/lib/parentApi.ts`

```ts
import { callParentApi } from "@/lib/parentApi";

// Login
await callParentApi("login_request", { phone });
const session = await callParentApi("login_verify", { phone, code, remember: true });

// Token otomatik olarak localStorage'dan eklenir
const me = await callParentApi("me");
const tx = await callParentApi("list_transactions", { student_id, limit: 20 });
```

---

## 6. Diğer API'ler (Özet)

Aynı `{ op, params }` desenini kullanan diğer edge function'lar:

| Endpoint | Kullanım |
|----------|----------|
| `/admin-api` | Süper admin paneli (okullar, öğrenciler, SMS, dashboard…) |
| `/cashier-api` | Kantinci POS işlemleri (satış, iade, kart sorgu) |
| `/donation-manager-api` | Bağış yöneticisi paneli |
| `/marketer-api` | Pazarlamacı paneli |
| `/school-admin-login` & `/school-admin-verify` | Okul yöneticisi OTP girişi |
| `/barcode-lookup` | Barkod → ürün araması |

İstenirse bu API'ler için de aynı formatta detaylı döküman hazırlanabilir.
