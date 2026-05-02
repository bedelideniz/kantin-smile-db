// Generates printable student ID cards as a vector PDF.
// Card dimensions per ISO/IEC 7810 ID-1: 85.6 x 53.98 mm.
import jsPDF from "jspdf";
import mebLogo from "@/assets/meb-logo.png";
import kantinLogo from "@/assets/kantinpay-logo.png";

export interface CardStudent {
  id: string;
  full_name: string;
  class_name: string | null;
  student_no: string | null;
  photo_url: string | null;
}

export interface CardPdfOptions {
  schoolName: string;
  students: CardStudent[];
  /** Cards per A4 page (portrait). Default: 2 cols x 5 rows = 10 */
  cols?: number;
  rows?: number;
}

const CARD_W = 85.6; // mm
const CARD_H = 53.98; // mm
const PAGE_W = 210; // A4 mm
const PAGE_H = 297;

async function fetchAsDataUrl(url: string): Promise<{ data: string; format: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const fmt = blob.type.includes("png") ? "PNG" : "JPEG";
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve({ data: r.result as string, format: fmt });
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
) {
  // Card border + background
  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, CARD_W, CARD_H, 2.5, 2.5, "FD");

  // Top accent bar
  doc.setFillColor(30, 58, 95); // navy
  doc.roundedRect(x, y, CARD_W, 12, 2.5, 2.5, "F");
  // square off bottom of bar
  doc.rect(x, y + 8, CARD_W, 4, "F");

  // MEB logo top-left (on navy bar)
  try {
    doc.addImage(mebData, "PNG", x + 1.5, y + 1.5, 9, 9);
  } catch { /* ignore */ }

  // School name centered on top bar
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  const maxNameW = CARD_W - 22;
  let nameSize = 9;
  doc.setFontSize(nameSize);
  while (doc.getTextWidth(schoolName) > maxNameW && nameSize > 6) {
    nameSize -= 0.5;
    doc.setFontSize(nameSize);
  }
  // Truncate if still too long
  let displayName = schoolName;
  while (doc.getTextWidth(displayName) > maxNameW && displayName.length > 4) {
    displayName = displayName.slice(0, -2);
  }
  if (displayName !== schoolName) displayName = displayName.slice(0, -1) + "…";
  doc.text(displayName, x + CARD_W / 2, y + 7.5, { align: "center", baseline: "middle" });

  // "ÖĞRENCİ KİMLİK KARTI" subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(220, 230, 245);
  doc.text("ÖĞRENCİ KİMLİK KARTI", x + CARD_W / 2, y + 11, { align: "center", baseline: "middle" });

  // Photo box (bottom-left)
  const photoX = x + 3;
  const photoY = y + 15;
  const photoW = 22;
  const photoH = 28;
  doc.setDrawColor(200);
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(photoX, photoY, photoW, photoH, 1.5, 1.5, "FD");
  if (photoData) {
    try {
      doc.addImage(photoData, "JPEG", photoX + 0.4, photoY + 0.4, photoW - 0.8, photoH - 0.8);
    } catch { /* ignore */ }
  } else {
    doc.setTextColor(160);
    doc.setFontSize(6);
    doc.text("FOTO", photoX + photoW / 2, photoY + photoH / 2, { align: "center", baseline: "middle" });
  }

  // Student details (right of photo)
  const dx = photoX + photoW + 3;
  const labelColor: [number, number, number] = [120, 120, 120];
  const valueColor: [number, number, number] = [25, 30, 45];

  const drawField = (label: string, value: string, yy: number, valueSize = 8) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(...labelColor);
    doc.text(label, dx, yy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(valueSize);
    doc.setTextColor(...valueColor);
    const maxW = x + CARD_W - dx - 3;
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

  // KantinPay logo bottom-right corner
  try {
    doc.addImage(kantinData, "PNG", x + CARD_W - 14, y + CARD_H - 6, 12, 4.5);
  } catch { /* ignore */ }
}

export async function generateStudentCardsPdf(opts: CardPdfOptions): Promise<void> {
  const { schoolName, students } = opts;
  const cols = opts.cols ?? 2;
  const rows = opts.rows ?? 5;
  const perPage = cols * rows;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // Compute layout
  const totalW = cols * CARD_W;
  const totalH = rows * CARD_H;
  const gapX = (PAGE_W - totalW) / (cols + 1);
  const gapY = (PAGE_H - totalH) / (rows + 1);

  // Pre-load static logos
  const [mebData, kantinData] = await Promise.all([
    loadLocalImage(mebLogo),
    loadLocalImage(kantinLogo),
  ]);

  // Pre-load student photos in parallel (cap concurrency simply)
  const photos = await Promise.all(
    students.map((s) => (s.photo_url ? fetchAsDataUrl(s.photo_url).then((r) => r?.data ?? null) : Promise.resolve(null))),
  );

  for (let i = 0; i < students.length; i++) {
    const idxOnPage = i % perPage;
    if (i > 0 && idxOnPage === 0) doc.addPage();
    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x = gapX + col * (CARD_W + gapX);
    const y = gapY + row * (CARD_H + gapY);
    drawCard(doc, x, y, students[i], schoolName, mebData, kantinData, photos[i]);
  }

  const safeName = schoolName.replace(/[^\p{L}\p{N}\-_ ]/gu, "").replace(/\s+/g, "_");
  doc.save(`ogrenci-kartlari-${safeName || "okul"}.pdf`);
}
