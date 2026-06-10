// Generates printable student ID cards as a vector PDF.
// Card dimensions per ISO/IEC 7810 ID-1: 85.6 x 53.98 mm.
import jsPDF from "jspdf";
import QRCode from "qrcode";
import mebLogo from "@/assets/meb-logo.png";
import kantinLogo from "@/assets/kantinpay-logo.png";
import dmSansRegular from "@/assets/fonts/dmsans-regular.b64";
import dmSansBold from "@/assets/fonts/dmsans-bold.b64";

export interface CardStudent {
  id: string;
  full_name: string;
  class_name: string | null;
  student_no: string | null;
  photo_url: string | null;
  qr_token: string;
}

export interface CardPdfOptions {
  schoolName: string;
  students: CardStudent[];
  cols?: number;
  rows?: number;
}

const CARD_W = 85.6;
const CARD_H = 53.98;
const PAGE_W = 210;
const PAGE_H = 297;

const FONT_FAMILY = "DMSans";

function registerFonts(doc: jsPDF) {
  doc.addFileToVFS("DMSans-Regular.ttf", dmSansRegular);
  doc.addFont("DMSans-Regular.ttf", FONT_FAMILY, "normal");
  doc.addFileToVFS("DMSans-Bold.ttf", dmSansBold);
  doc.addFont("DMSans-Bold.ttf", FONT_FAMILY, "bold");
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

function loadLocalImage(src: string): Promise<string> {
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

function drawCard(
  doc: jsPDF,
  x: number,
  y: number,
  s: CardStudent,
  schoolName: string,
  mebData: string,
  kantinData: string,
  photoData: string | null,
  qrData: string | null,
) {
  // Card background
  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, CARD_W, CARD_H, 2.5, 2.5, "FD");

  // Top header (white background)
  const barH = 14;
  doc.setDrawColor(30, 58, 95);
  doc.setLineWidth(0.4);
  doc.line(x + 2, y + barH, x + CARD_W - 2, y + barH);

  // MEB logo (left) and KantinPay logo (right) in the header
  const logoSize = 13;
  const logoY = y + (barH - logoSize) / 2;
  const kpHeaderW = 18;
  const kpHeaderH = 11;
  const kpHeaderY = y + (barH - kpHeaderH) / 2;
  try {
    doc.addImage(mebData, "PNG", x + 2, logoY, logoSize, logoSize);
    doc.addImage(kantinData, "PNG", x + CARD_W - kpHeaderW - 2, kpHeaderY, kpHeaderW, kpHeaderH);
  } catch { /* ignore */ }

  // Adjust right padding for school name to avoid kantin logo
  void kpHeaderW;

  // School name centered
  doc.setTextColor(30, 58, 95);
  doc.setFont(FONT_FAMILY, "bold");
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

  doc.setFont(FONT_FAMILY, "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(110, 120, 140);
  doc.text("ÖĞRENCİ KİMLİK KARTI", x + CARD_W / 2, y + 10.5, { align: "center", baseline: "middle" });

  // Photo box
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
    doc.setFont(FONT_FAMILY, "normal");
    doc.setFontSize(6);
    doc.text("FOTO", photoX + photoW / 2, photoY + photoH / 2, { align: "center", baseline: "middle" });
  }

  // Student details
  const dx = photoX + photoW + 3;
  const labelColor: [number, number, number] = [120, 120, 120];
  const valueColor: [number, number, number] = [25, 30, 45];

  // QR code (right side) — used by cashier scanner to identify student
  const qrSize = 18;
  const qrX = x + CARD_W - qrSize - 2;
  const qrY = y + barH + 2;
  if (qrData) {
    try {
      doc.addImage(qrData, "PNG", qrX, qrY, qrSize, qrSize);
    } catch { /* ignore */ }
    doc.setFont(FONT_FAMILY, "normal");
    doc.setFontSize(4.6);
    doc.setTextColor(120, 120, 120);
    doc.text("KASİYERDE OKUT", qrX + qrSize / 2, qrY + qrSize + 1.6, { align: "center" });
  }

  const drawField = (label: string, value: string, yy: number, valueSize = 8) => {
    doc.setFont(FONT_FAMILY, "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(...labelColor);
    doc.text(label, dx, yy);
    doc.setFont(FONT_FAMILY, "bold");
    doc.setFontSize(valueSize);
    doc.setTextColor(...valueColor);
    const maxW = qrX - dx - 2; // leave room for the QR
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

  // KantinPay logo bottom-left (small, next to photo)
  const kpW = 14;
  const kpH = 9;
  try {
    doc.addImage(
      kantinData,
      "PNG",
      dx,
      y + CARD_H - kpH - 1.5,
      kpW,
      kpH,
    );
  } catch { /* ignore */ }
}

async function buildQr(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    return await QRCode.toDataURL(token, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
      color: { dark: "#1E3A5F", light: "#FFFFFF" },
    });
  } catch {
    return null;
  }
}

export async function generateStudentCardsPdf(opts: CardPdfOptions): Promise<void> {
  const { schoolName, students } = opts;
  const cols = opts.cols ?? 2;
  const rows = opts.rows ?? 5;
  const perPage = cols * rows;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  registerFonts(doc);

  const totalW = cols * CARD_W;
  const totalH = rows * CARD_H;
  const gapX = (PAGE_W - totalW) / (cols + 1);
  const gapY = (PAGE_H - totalH) / (rows + 1);

  const [mebData, kantinData] = await Promise.all([
    loadLocalImage(mebLogo),
    loadLocalImage(kantinLogo),
  ]);

  const [photos, qrs] = await Promise.all([
    Promise.all(students.map((s) => (s.photo_url ? fetchAsDataUrl(s.photo_url) : Promise.resolve(null)))),
    Promise.all(students.map((s) => buildQr(s.qr_token))),
  ]);

  for (let i = 0; i < students.length; i++) {
    const idxOnPage = i % perPage;
    if (i > 0 && idxOnPage === 0) doc.addPage();
    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x = gapX + col * (CARD_W + gapX);
    const y = gapY + row * (CARD_H + gapY);
    drawCard(doc, x, y, students[i], schoolName, mebData, kantinData, photos[i], qrs[i]);
  }

  const safeName = schoolName.replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "_");
  doc.save(`ogrenci-kartlari-${safeName || "okul"}.pdf`);
}
