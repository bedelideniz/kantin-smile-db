// Parent welcome letter PDF — A4 portrait.
// Single-student or bulk; an optional bottom "tear-off" card can be drawn on
// the same page for combined letter+card output.
import jsPDF from "jspdf";
import QRCode from "qrcode";
import kantinLogo from "@/assets/kantinpay-logo.png";
import mebLogo from "@/assets/meb-logo.png";
import dmSansRegular from "@/assets/fonts/dmsans-regular.b64";
import dmSansBold from "@/assets/fonts/dmsans-bold.b64";
import type { CardStudent } from "@/lib/cardPdf";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const FONT = "DMSans";
const PARENT_LOGIN_URL = "https://dash.kantinpay.com/veli-giris";

export interface LetterStudent extends CardStudent {
  parent_phone?: string | null;
}

export interface LetterPdfOptions {
  schoolName: string;
  students: LetterStudent[];
  /** When true, draws an ID card at the bottom of each letter page. */
  withCard?: boolean;
  /** Optional support phone shown in the footer (e.g. WhatsApp). */
  supportPhone?: string;
}

function registerFonts(doc: jsPDF) {
  doc.addFileToVFS("DMSans-Regular.ttf", dmSansRegular);
  doc.addFont("DMSans-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("DMSans-Bold.ttf", dmSansBold);
  doc.addFont("DMSans-Bold.ttf", FONT, "bold");
}

function loadImage(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fetch(src)
      .then((r) => r.blob())
      .then((b) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(b);
      })
      .catch(reject);
  });
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function formatPhone(p?: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) {
    return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)}`;
  }
  if (d.length === 10) {
    return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
  }
  return p;
}

// ---------- Card drawing (compact version, mirrors cardPdf.ts) ----------
const CARD_W = 85.6;
const CARD_H = 53.98;

function drawCard(
  doc: jsPDF,
  x: number,
  y: number,
  s: LetterStudent,
  schoolName: string,
  mebData: string,
  kantinData: string,
  photoData: string | null,
) {
  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, CARD_W, CARD_H, 2.5, 2.5, "FD");

  const barH = 14;
  doc.setDrawColor(30, 58, 95);
  doc.setLineWidth(0.4);
  doc.line(x + 2, y + barH, x + CARD_W - 2, y + barH);

  const logoSize = 13;
  const logoY = y + (barH - logoSize) / 2;
  try {
    doc.addImage(mebData, "PNG", x + 2, logoY, logoSize, logoSize);
    doc.addImage(mebData, "PNG", x + CARD_W - logoSize - 2, logoY, logoSize, logoSize);
  } catch { /* ignore */ }

  doc.setTextColor(30, 58, 95);
  doc.setFont(FONT, "bold");
  const maxNameW = CARD_W - 2 * (logoSize + 5);
  let nameSize = 9;
  doc.setFontSize(nameSize);
  while (doc.getTextWidth(schoolName) > maxNameW && nameSize > 6) {
    nameSize -= 0.5;
    doc.setFontSize(nameSize);
  }
  let displayName = schoolName;
  while (doc.getTextWidth(displayName) > maxNameW && displayName.length > 4) {
    displayName = displayName.slice(0, -2);
  }
  if (displayName !== schoolName) displayName = displayName.slice(0, -1) + "…";
  doc.text(displayName, x + CARD_W / 2, y + 6, { align: "center", baseline: "middle" });

  doc.setFont(FONT, "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(110, 120, 140);
  doc.text("ÖĞRENCİ KİMLİK KARTI", x + CARD_W / 2, y + 10.5, { align: "center", baseline: "middle" });

  const photoX = x + 3;
  const photoY = y + barH + 2;
  const photoW = 22;
  const photoH = 28;
  doc.setDrawColor(200);
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(photoX, photoY, photoW, photoH, 1.5, 1.5, "FD");
  if (photoData) {
    try {
      doc.addImage(photoData, "JPEG", photoX + 0.4, photoY + 0.4, photoW - 0.8, photoH - 0.8);
    } catch {
      try {
        doc.addImage(photoData, "PNG", photoX + 0.4, photoY + 0.4, photoW - 0.8, photoH - 0.8);
      } catch { /* ignore */ }
    }
  } else {
    doc.setTextColor(160);
    doc.setFont(FONT, "normal");
    doc.setFontSize(6);
    doc.text("FOTO", photoX + photoW / 2, photoY + photoH / 2, { align: "center", baseline: "middle" });
  }

  const dx = photoX + photoW + 3;
  const labelColor: [number, number, number] = [120, 120, 120];
  const valueColor: [number, number, number] = [25, 30, 45];

  const drawField = (label: string, value: string, yy: number, valueSize = 8) => {
    doc.setFont(FONT, "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(...labelColor);
    doc.text(label, dx, yy);
    doc.setFont(FONT, "bold");
    doc.setFontSize(valueSize);
    doc.setTextColor(...valueColor);
    const maxW = x + CARD_W - dx - 18;
    let v = value || "-";
    let vs = valueSize;
    doc.setFontSize(vs);
    while (doc.getTextWidth(v) > maxW && vs > 5.5) {
      vs -= 0.3;
      doc.setFontSize(vs);
    }
    while (doc.getTextWidth(v) > maxW && v.length > 3) {
      v = v.slice(0, -2);
    }
    doc.text(v, dx, yy + 3.2);
  };

  drawField("ADI SOYADI", (s.full_name || "").toLocaleUpperCase("tr-TR"), photoY + 3, 8);
  drawField("SINIFI", s.class_name || "-", photoY + 12, 7.5);
  drawField("OKUL NO", s.student_no || "-", photoY + 21, 7.5);

  const kpW = 18;
  const kpH = 12;
  try {
    doc.addImage(kantinData, "PNG", x + CARD_W - kpW - 2, y + CARD_H - kpH - 1.5, kpW, kpH);
  } catch { /* ignore */ }
}

// ---------- Letter drawing ----------
async function drawLetter(
  doc: jsPDF,
  s: LetterStudent,
  schoolName: string,
  kantinData: string,
  qrData: string,
  supportPhone?: string,
) {
  let y = MARGIN;

  // Header band
  try {
    doc.addImage(kantinData, "PNG", MARGIN, y, 36, 24);
  } catch { /* ignore */ }

  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 58, 95);
  doc.text(schoolName, PAGE_W - MARGIN, y + 8, { align: "right" });
  doc.setFont(FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 120, 140);
  doc.text("KantinPay Veli Hoşgeldin Kılavuzu", PAGE_W - MARGIN, y + 14, { align: "right" });

  y += 30;
  doc.setDrawColor(220);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // Greeting
  doc.setFont(FONT, "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 25, 45);
  doc.text("Hoş Geldiniz, Sayın Veli", MARGIN, y);
  y += 8;

  doc.setFont(FONT, "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 65, 80);
  const intro =
    `${s.full_name} için KantinPay öğrenci kartı ekteki şekilde teslim edilmiştir. ` +
    `Bu kart ile öğrenciniz okul kantininde nakit taşımadan güvenle alışveriş yapabilir. ` +
    `Aşağıdaki adımları izleyerek veli panelinize giriş yapabilir; bakiye yükleme, harcama takibi ` +
    `ve yasaklı ürün belirleme özelliklerini kullanabilirsiniz.`;
  const introLines = doc.splitTextToSize(intro, PAGE_W - 2 * MARGIN);
  doc.text(introLines, MARGIN, y);
  y += introLines.length * 4.6 + 4;

  // Student info box
  doc.setFillColor(245, 248, 252);
  doc.setDrawColor(220, 230, 240);
  doc.roundedRect(MARGIN, y, PAGE_W - 2 * MARGIN, 22, 2, 2, "FD");
  const infoY = y + 6;
  const colW = (PAGE_W - 2 * MARGIN) / 3;
  const drawInfo = (label: string, value: string, cx: number) => {
    doc.setFont(FONT, "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 130, 145);
    doc.text(label.toLocaleUpperCase("tr-TR"), cx, infoY);
    doc.setFont(FONT, "bold");
    doc.setFontSize(10);
    doc.setTextColor(25, 30, 45);
    doc.text(value || "—", cx, infoY + 6);
  };
  drawInfo("Öğrenci", s.full_name, MARGIN + 4);
  drawInfo("Sınıf / No", `${s.class_name ?? "—"}${s.student_no ? ` • #${s.student_no}` : ""}`, MARGIN + 4 + colW);
  drawInfo("Veli Telefonu", formatPhone(s.parent_phone), MARGIN + 4 + colW * 2);
  y += 28;

  // Quick start title
  doc.setFont(FONT, "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 25, 45);
  doc.text("3 Adımda Başlayın", MARGIN, y);
  y += 6;

  // Steps (left) + QR (right)
  const qrSize = 38;
  const qrX = PAGE_W - MARGIN - qrSize;
  const qrY = y;
  const stepsMaxW = qrX - MARGIN - 6;

  const steps = [
    {
      t: "PIN'inizi alın",
      d: "Veli telefonunuza KantinPay'den gelen 6 haneli giriş PIN'ini SMS olarak alacaksınız. PIN'i bir kenara not edin.",
    },
    {
      t: "Veli paneline girin",
      d: `Tarayıcınızdan ${PARENT_LOGIN_URL} adresine girin veya yandaki QR kodu telefonunuzla okutun.`,
    },
    {
      t: "Giriş yapın",
      d: "Veli telefonunuz ve PIN ile giriş yapın. İlk girişte PIN'i kendinize ait yeni bir 6 hane ile değiştirin.",
    },
  ];

  let sy = y;
  steps.forEach((step, i) => {
    // Number badge
    doc.setFillColor(30, 58, 95);
    doc.circle(MARGIN + 4, sy + 3, 3.5, "F");
    doc.setFont(FONT, "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(String(i + 1), MARGIN + 4, sy + 3, { align: "center", baseline: "middle" });

    doc.setFont(FONT, "bold");
    doc.setFontSize(10);
    doc.setTextColor(25, 30, 45);
    doc.text(step.t, MARGIN + 11, sy + 4);

    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(80, 90, 105);
    const lines = doc.splitTextToSize(step.d, stepsMaxW - 11);
    doc.text(lines, MARGIN + 11, sy + 9);
    sy += 9 + lines.length * 4 + 3;
  });

  // QR
  try {
    doc.addImage(qrData, "PNG", qrX, qrY, qrSize, qrSize);
    doc.setFont(FONT, "normal");
    doc.setFontSize(7);
    doc.setTextColor(110, 120, 140);
    doc.text("Veli paneli", qrX + qrSize / 2, qrY + qrSize + 4, { align: "center" });
  } catch { /* ignore */ }

  y = Math.max(sy, qrY + qrSize + 8) + 4;

  // Features
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 25, 45);
  doc.text("Veli Panelinden Yapabilecekleriniz", MARGIN, y);
  y += 5;

  const features = [
    "Karta bakiye yükleme ve günlük harcama limiti belirleme",
    "Anlık harcama bildirimleri ve detaylı satış geçmişi",
    "Yasaklı ürün listesi (örn. çikolata, gazlı içecek)",
    "Birden fazla öğrenciyi tek hesaptan yönetme",
    "Kart kayıp/çalıntı durumunda anında bloke etme",
  ];
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 70, 85);
  features.forEach((f) => {
    doc.setTextColor(30, 58, 95);
    doc.text("•", MARGIN + 1, y + 3);
    doc.setTextColor(60, 70, 85);
    const lines = doc.splitTextToSize(f, PAGE_W - 2 * MARGIN - 6);
    doc.text(lines, MARGIN + 5, y + 3);
    y += 4.6 * lines.length + 1.2;
  });

  y += 3;

  // Security note
  doc.setFillColor(255, 248, 232);
  doc.setDrawColor(240, 215, 160);
  doc.roundedRect(MARGIN, y, PAGE_W - 2 * MARGIN, 18, 2, 2, "FD");
  doc.setFont(FONT, "bold");
  doc.setFontSize(9);
  doc.setTextColor(150, 100, 20);
  doc.text("Güvenlik", MARGIN + 4, y + 5.5);
  doc.setFont(FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 80, 30);
  const sec =
    "PIN'inizi kimseyle paylaşmayın. Kart kaybolur veya çalınırsa veli panelinden anında bloke edin. " +
    "KantinPay sizden PIN'inizi telefon veya SMS ile asla istemez.";
  const secLines = doc.splitTextToSize(sec, PAGE_W - 2 * MARGIN - 8);
  doc.text(secLines, MARGIN + 4, y + 10);
}

function drawFooter(doc: jsPDF, supportPhone?: string) {
  const y = PAGE_H - 10;
  doc.setDrawColor(225);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y - 4, PAGE_W - MARGIN, y - 4);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(140, 145, 160);
  doc.text("kantinpay.com", MARGIN, y);
  if (supportPhone) {
    doc.text(`Destek: ${supportPhone}`, PAGE_W / 2, y, { align: "center" });
  }
  doc.text("KantinPay © Okul Kantin Ödeme Sistemi", PAGE_W - MARGIN, y, { align: "right" });
}

function drawTearLine(doc: jsPDF, y: number) {
  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.2, 1.2], 0);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setLineDashPattern([], 0);
  doc.setFont(FONT, "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(150, 155, 170);
  doc.text("✂  bu çizgiden katlayın / kesin", PAGE_W / 2, y - 1.2, { align: "center" });
}

export async function generateParentLettersPdf(opts: LetterPdfOptions): Promise<void> {
  const { schoolName, students, withCard = false, supportPhone } = opts;
  if (!students.length) return;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  registerFonts(doc);

  const [kantinData, mebData] = await Promise.all([
    loadImage(kantinLogo),
    loadImage(mebLogo),
  ]);

  // Preload photos for cards (if needed)
  const photos = withCard
    ? await Promise.all(students.map((s) => (s.photo_url ? fetchAsDataUrl(s.photo_url) : Promise.resolve(null))))
    : students.map(() => null);

  // QR code (same for all — points to parent login)
  const qrData = await QRCode.toDataURL(PARENT_LOGIN_URL, {
    margin: 1,
    width: 256,
    color: { dark: "#0F1B3D", light: "#FFFFFF" },
  });

  for (let i = 0; i < students.length; i++) {
    if (i > 0) doc.addPage();
    const s = students[i];

    await drawLetter(doc, s, schoolName, kantinData, qrData, supportPhone);

    if (withCard) {
      // Tear line and card at bottom of page
      const cardY = PAGE_H - 20 - CARD_H;
      drawTearLine(doc, cardY - 4);
      const cardX = (PAGE_W - CARD_W) / 2;
      drawCard(doc, cardX, cardY, s, schoolName, mebData, kantinData, photos[i]);
    }

    drawFooter(doc, supportPhone);
  }

  const safeSchool = schoolName.replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "_");
  const safeStudent = students.length === 1
    ? "-" + (students[0].full_name || "ogrenci").replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "_")
    : "";
  const suffix = withCard ? "mektup-kart" : "mektup";
  doc.save(`veli-${suffix}-${safeSchool || "okul"}${safeStudent}.pdf`);
}
