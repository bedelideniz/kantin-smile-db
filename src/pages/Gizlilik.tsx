import { Link } from "react-router-dom";
import { ArrowLeft, Shield, Database, Lock, Users, Cookie, RefreshCw, Mail, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const LAST_UPDATED = "18 Haziran 2026";
const CONTACT_EMAIL = "destek@kantinpay.com";

export default function Gizlilik() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 sticky top-0 z-10">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Ana sayfa
            </Button>
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4" />
            KantinPay
          </div>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-10">
        {/* Title */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
            <Shield className="h-3.5 w-3.5" />
            Yasal Bilgilendirme
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Gizlilik Politikası
          </h1>
          <p className="text-muted-foreground">
            Son güncelleme: {LAST_UPDATED}
          </p>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            Bu sayfa, KantinPay uygulamasının sahibi tarafından düzenli olarak gözden geçirilir.
            Aşağıdaki metin yasal danışmanlık yerine geçmez; nihai metnin bir hukuk uzmanı tarafından
            onaylanması önerilir.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          <Section icon={<Shield className="h-5 w-5" />} title="1. Giriş">
            <p>
              Bu Gizlilik Politikası, <strong>KantinPay</strong> mobil uygulamasının ve ilgili web
              arayüzünün; veli, öğrenci ve kantin işletmecisi kullanıcılarının verilerini nasıl
              topladığını, kullandığını, koruduğunu ve üçüncü taraflarla nasıl paylaştığını açıklar.
            </p>
            <p>
              Kullanıcı, KantinPay'i indirerek, hesap oluşturarak veya hizmetleri herhangi bir
              şekilde kullanarak bu politikanın şartlarını kabul etmiş sayılır.
            </p>
          </Section>

          <Section icon={<Database className="h-5 w-5" />} title="2. Toplanan Veriler">
            <p>Hizmetlerin sağlanabilmesi için aşağıdaki veri kategorileri işlenebilir:</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>
                <strong>Kişisel kimlik bilgileri:</strong> Ad, soyad, telefon numarası, e-posta
                adresi, veli–öğrenci ilişkisi.
              </li>
              <li>
                <strong>Finansal veriler:</strong> Bakiye, harcama ve yükleme işlem geçmişi.
                Kart bilgileri KantinPay sunucularında saklanmaz; ödeme işlemleri, lisanslı
                ödeme kuruluşları ve bankaların güvenli sanal POS altyapıları üzerinden
                gerçekleştirilir.
              </li>
              <li>
                <strong>Cihaz ve kullanım verileri:</strong> IP adresi, cihaz türü, işletim
                sistemi, uygulama sürümü, oturum logları ve hata kayıtları.
              </li>
              <li>
                <strong>Bildirim verileri:</strong> Push bildirim aboneliği için gereken cihaz
                belirteçleri (OneSignal).
              </li>
            </ul>
          </Section>

          <Section icon={<Users className="h-5 w-5" />} title="3. Verilerin Kullanım Amacı">
            <ul className="list-disc pl-6 space-y-2">
              <li>Hizmetin sağlanması, hesap yönetimi ve oturum güvenliği.</li>
              <li>Ödeme ve bakiye yükleme işlemlerinin güvenli şekilde gerçekleştirilmesi.</li>
              <li>Satış sonrası bilgilendirme ve push bildirimlerinin iletilmesi.</li>
              <li>Kullanıcı destek talepleri ve itiraz süreçlerinin yönetimi.</li>
              <li>Yasal yükümlülüklerin (mali mevzuat, KVKK vb.) yerine getirilmesi.</li>
              <li>Dolandırıcılık ve kötüye kullanım tespiti, sistem güvenliğinin sağlanması.</li>
            </ul>
          </Section>

          <Section icon={<Building2 className="h-5 w-5" />} title="4. Veri Paylaşımı ve Üçüncü Taraflar">
            <p>
              Verileriniz, yalnızca aşağıda belirtilen amaç ve sınırlarla üçüncü taraflarla
              paylaşılır:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>
                <strong>Bankalar ve ödeme kuruluşları:</strong> Ödeme süreçlerinin
                yürütülmesi için zorunlu finansal veriler.
              </li>
              <li>
                <strong>Altyapı sağlayıcıları:</strong> Bulut barındırma, veritabanı, edge
                function ve bildirim hizmetlerini sağlayan kurumsal sağlayıcılar (örn. Lovable
                Cloud / Supabase altyapısı, OneSignal bildirim servisi).
              </li>
              <li>
                <strong>Yasal zorunluluklar:</strong> Yetkili kamu kurumlarının resmi talebi
                doğrultusunda mevzuatın gerektirdiği veriler.
              </li>
            </ul>
            <p className="mt-3">
              KantinPay <strong>verilerinizi reklam amaçlı üçüncü taraflara satmaz veya
              kiralamaz</strong>.
            </p>
          </Section>

          <Section icon={<Lock className="h-5 w-5" />} title="5. Güvenlik Önlemleri">
            <ul className="list-disc pl-6 space-y-2">
              <li>Tüm veri trafiği SSL/TLS şifreleme ile korunur.</li>
              <li>Hassas işlemler sunucu tarafında doğrulanır; istemci tarafı yetkilendirmeye güvenilmez.</li>
              <li>Veritabanı erişimi rol bazlı (RLS) politikalarla sınırlandırılmıştır.</li>
              <li>Şifreler ve PIN'ler tek yönlü olarak güvenli biçimde saklanır.</li>
              <li>Sistem, 6698 sayılı KVKK kapsamındaki teknik ve idari tedbirleri uygulayacak şekilde tasarlanmıştır.</li>
            </ul>
          </Section>

          <Section icon={<Users className="h-5 w-5" />} title="6. Kullanıcı Hakları (KVKK / GDPR)">
            <p>İlgili mevzuat çerçevesinde aşağıdaki haklara sahipsiniz:</p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>Hakkınızda işlenen verilere erişme.</li>
              <li>Yanlış veya eksik verilerin düzeltilmesini isteme.</li>
              <li>Belirli koşullarda verilerin silinmesini veya işlenmesinin durdurulmasını talep etme.</li>
              <li>Veri işlemeye itiraz etme ve hesap silme talebinde bulunma.</li>
            </ul>
            <p className="mt-3">
              Bu haklarınızı kullanmak için{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4">
                {CONTACT_EMAIL}
              </a>{" "}
              adresine yazabilirsiniz.
            </p>
          </Section>

          <Section icon={<Cookie className="h-5 w-5" />} title="7. Çerezler ve Takip Teknolojileri">
            <p>
              Web arayüzünde oturum yönetimi ve temel işlevsellik için zorunlu çerezler ve
              yerel depolama (localStorage) kullanılır. Reklam veya profil çıkarma amaçlı
              üçüncü taraf takip çerezleri kullanılmaz. Mobil uygulamada cihaz tanımlayıcıları
              yalnızca bildirim eşlemesi ve hata ayıklama amacıyla işlenir.
            </p>
          </Section>

          <Section icon={<RefreshCw className="h-5 w-5" />} title="8. Politika Değişiklikleri">
            <p>
              Bu Gizlilik Politikası zaman zaman güncellenebilir. Önemli değişikliklerde
              kullanıcılar uygulama içi bildirim veya e-posta yoluyla bilgilendirilir.
              Güncellenmiş metin bu sayfada yayımlandığı tarihten itibaren geçerli olur.
            </p>
          </Section>

          <Section icon={<Mail className="h-5 w-5" />} title="9. İletişim">
            <p>
              Gizlilik uygulamalarımız veya verilerinizle ilgili tüm soru, talep ve
              şikayetleriniz için bizimle iletişime geçebilirsiniz:
            </p>
            <div className="mt-3 p-4 rounded-lg bg-muted/40 border">
              <p className="text-sm">
                <strong>E-posta:</strong>{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4">
                  {CONTACT_EMAIL}
                </a>
              </p>
              <p className="text-sm mt-1">
                <strong>Web:</strong>{" "}
                <a href="https://kantinpay.com" className="text-primary underline underline-offset-4">
                  kantinpay.com
                </a>
              </p>
            </div>
          </Section>
        </div>

        <Separator className="my-10" />
        <p className="text-xs text-muted-foreground text-center">
          © {new Date().getFullYear()} KantinPay. Tüm hakları saklıdır.
        </p>
      </main>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-3">
        {children}
      </CardContent>
    </Card>
  );
}
