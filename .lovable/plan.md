## Amaç
SüperAdmin panelini daha kullanışlı hale getirmek için:
1. Üstteki yatay tab menüsünü **sol tarafta sidebar** yapısına dönüştürmek
2. **İlk sayfaya (Dashboard)** özet KPI kartları ve grafikler eklemek

## Yapılacaklar

### 1. Sol Sidebar (shadcn `Sidebar`)
- `src/pages/SuperAdmin.tsx` `SidebarProvider` + `AppSidebar` mimarisine geçirilir.
- `TAB_ORDER` aynı kalır; her modül sidebar'da bir `SidebarMenuItem` olur (Lucide ikonlarıyla):
  - dashboard (LayoutDashboard), schools (School), students (Users), marketers (Megaphone), splashes (Image), announcements (Megaphone), donations (HandCoins), payments (CreditCard), sms (MessageSquare), alarms (BellRing), payouts (Wallet), logs (ScrollText), staff (UserCog), infrastructure (Server)
- Alarm sayısı badge'i `alarms` menü öğesinin yanında kırmızı rozet olarak korunur.
- `collapsible="icon"` ile daraltılabilir; üstte `SidebarTrigger` + başlık + Çıkış butonu bulunan sticky header.
- Aktif modül `useState` ile tutulur, içerik sağ tarafta tek bir `<section>` içinde render edilir (mevcut `TabsContent` blokları `if (active === "x") <Component/>` mantığına çevrilir).

### 2. Yeni Dashboard Ana Sayfası
Mevcut `dashboard` sekmesi sadece "Tam Ekran Aç" butonu içeriyor. Bunu zenginleştir:
- `callAdminApi("dashboard_stats")` ve `recent_topups` zaten mevcut → aynı endpoint'leri kullan.
- Üstte **KPI kart şeridi**: Bugün Yükleme, Bugün Ödeme, Bekleyen Ödeme, Havuz Bakiyesi, Açık Alarmlar, SMS Kalan.
- 2 sütunlu grafik bölümü (`recharts`, projede mevcut `chart.tsx` üzerinden):
  - **Yükleme/Ödeme Trendi** — Bugün/Hafta/Ay/Toplam buckets'tan stacked bar chart.
  - **Akış Dağılımı** — Yüklemeler, Ödemeler, Bağışlar, Dağıtımlar pie/donut chart (toplam değerler).
- Altta **Son Yüklemeler** mini liste (mevcut `recent_topups` kullanır, kompakt tablo).
- "Tam Ekran TV Dashboard Aç" butonu sağ üst köşede ikincil eylem olarak korunur.

### 3. Teknik notlar
- Yeni dosya: `src/components/admin/AdminSidebar.tsx` — sidebar bileşeni (props: aktif modül, openAlarms, modül listesi, onSelect).
- Yeni dosya: `src/components/admin/AdminDashboard.tsx` — KPI + grafikler için.
- `Tabs` kullanımı kaldırılır. `MODULE_LABELS` aynı, ikon eşlemesi sidebar dosyasında lokal sabit olarak tutulur.
- Tasarım sistemine sadık kalınır: `bg-card`, `text-muted-foreground`, `text-primary`, `bg-destructive` gibi semantic token'lar; özel renk yok.
- Mobilde sidebar `offcanvas` davranışına otomatik düşer (shadcn default).
- `SidebarProvider` etrafındaki div `min-h-screen flex w-full` kullanır.

### Etki Alanı
- Değişen: `src/pages/SuperAdmin.tsx`
- Yeni: `src/components/admin/AdminSidebar.tsx`, `src/components/admin/AdminDashboard.tsx`
- Diğer modül bileşenleri (`SchoolsManager`, `StudentsBySchool`, vb.) **dokunulmaz** — sadece içerik alanına render edilir.
