// Saha pazarlama personel sözleşmesi — A4 PDF (otomatik dolduruluyor).
import jsPDF from "jspdf";
import dmSansRegular from "@/assets/fonts/dmsans-regular.b64";
import dmSansBold from "@/assets/fonts/dmsans-bold.b64";

const PAGE_W = 210;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FONT = "DMSans";

export interface ContractData {
  full_name: string;
  signup_bonus: number | string;
  commission_share_rate: number | string; // 0..1
  tc_no?: string;
  address?: string;
  iban?: string;
}

function registerFonts(doc: jsPDF) {
  doc.addFileToVFS("DMSans-Regular.ttf", dmSansRegular);
  doc.addFont("DMSans-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("DMSans-Bold.ttf", dmSansBold);
  doc.addFont("DMSans-Bold.ttf", FONT, "bold");
}

const tl = (v: number | string) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(v ?? 0));

// Türkçe sayıları yazıyla yazmak için basit fonksiyon (binler basamağına kadar yeterli).
function numberToTurkishWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "sıfır";
  const ones = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
  const tens = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
  const hundreds = (h: number) =>
    h === 0 ? "" : h === 1 ? "yüz" : ones[h] + "yüz";
  const under1000 = (x: number) => {
    const h = Math.floor(x / 100);
    const t = Math.floor((x % 100) / 10);
    const o = x % 10;
    return [hundreds(h), tens[t], ones[o]].filter(Boolean).join(" ");
  };
  if (n < 1000) return under1000(n);
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000);
    const rest = n % 1000;
    const thPart = th === 1 ? "bin" : `${under1000(th)} bin`;
    return [thPart, rest ? under1000(rest) : ""].filter(Boolean).join(" ");
  }
  return String(n);
}

const todayParts = () => {
  const d = new Date();
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: String(d.getMonth() + 1).padStart(2, "0"),
    year: String(d.getFullYear()),
  };
};

export function generateMarketerContractPdf(data: ContractData): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFonts(doc);
  doc.setFont(FONT, "normal");

  const bonus = Number(data.signup_bonus ?? 0);
  const sharePct = Number(data.commission_share_rate ?? 0) * 100;
  const bonusStr = `${tl(bonus)} TL`;
  const bonusWords = numberToTurkishWords(bonus);
  const pctStr = sharePct % 1 === 0 ? `%${sharePct}` : `%${sharePct.toFixed(2)}`;
  const pctWords = sharePct % 1 === 0 ? `yüzde ${numberToTurkishWords(sharePct)}` : `yüzde ${sharePct.toFixed(2)}`;

  let y = MARGIN;

  // Başlık
  doc.setFont(FONT, "bold");
  doc.setFontSize(14);
  const title = "KANTİNPAY SAHA PAZARLAMA VE HİZMET SÖZLEŞMESİ";
  doc.text(title, PAGE_W / 2, y + 4, { align: "center" });
  y += 12;

  const writeHeading = (text: string) => {
    if (y > 270) { doc.addPage(); y = MARGIN; }
    doc.setFont(FONT, "bold");
    doc.setFontSize(10.5);
    doc.text(text, MARGIN, y);
    y += 5;
  };

  const writeParagraph = (text: string, opts?: { bold?: boolean; indent?: number }) => {
    doc.setFont(FONT, opts?.bold ? "bold" : "normal");
    doc.setFontSize(9.5);
    const indent = opts?.indent ?? 0;
    const lines = doc.splitTextToSize(text, CONTENT_W - indent);
    for (const ln of lines) {
      if (y > 280) { doc.addPage(); y = MARGIN; }
      doc.text(ln, MARGIN + indent, y);
      y += 4.6;
    }
    y += 1.5;
  };

  const writeField = (label: string, value: string) => {
    if (y > 275) { doc.addPage(); y = MARGIN; }
    doc.setFont(FONT, "bold");
    doc.setFontSize(9.5);
    doc.text(label, MARGIN, y);
    const labelW = doc.getTextWidth(label);
    doc.setFont(FONT, "normal");
    const valX = MARGIN + labelW + 2;
    const valMaxW = PAGE_W - MARGIN - valX;
    // alt çizgi
    doc.setDrawColor(140);
    doc.line(valX, y + 0.6, valX + valMaxW, y + 0.6);
    if (value) doc.text(value, valX + 1, y);
    y += 6;
  };

  // 1. TARAFLAR
  writeHeading("1. TARAFLAR");
  writeParagraph("1.1. ŞİRKET: KantinPay Yazılım ve Otomasyon Hizmetleri Tic. Ltd. Şti. (Bundan sonra \"Şirket\" olarak anılacaktır.)");
  writeParagraph("1.2. SAHA PAZARLAMA PERSONELİ / DANIŞMAN:", { bold: true });
  writeField("Adı Soyadı:", data.full_name || "");
  writeField("T.C. Kimlik No:", data.tc_no || "");
  writeField("İkametgah Adresi:", data.address || "");
  writeField("Kuveyt Türk IBAN No:", data.iban ? data.iban : "TR");
  writeParagraph("(Bundan sonra \"Personel\" olarak anılacaktır.)");

  // 2. KONU
  writeHeading("2. SÖZLEŞMENİN KONUSU");
  writeParagraph(
    "İşbu sözleşmenin konusu; Şirket bünyesinde \"Saha Pazarlama ve Destek Personeli\" olarak görev yapacak olan Personel'in çalışma şartlarının, gizlilik yükümlülüklerinin, aylık sabit gider ödemelerinin, prim ve hak ediş modellerinin karşılıklı olarak belirlenmesidir."
  );

  // 3. MALİ ŞARTLAR
  writeHeading("3. MALİ ŞARTLAR, MAAŞ VE PRİM HAKEDİŞLERİ");
  writeParagraph(
    "3.1. Sabit Saha Destek Ücreti: Personel'e sahada yapacağı pazarlama, okul ziyaretleri ve operasyonel faaliyetlerin giderlerini karşılamak üzere aylık net 8.000 TL (sekiz bin Türk Lirası) \"Saha Destek Ücreti\" ödenir. Personel'in bunun dışında herhangi bir ek sabit maaş, huzur hakkı veya taban ücret hakkı bulunmamaktadır."
  );
  writeParagraph(
    "3.2. Sosyal Güvenlik (SGK): Personel'in resmi sigorta (SGK) girişleri Şirket tarafından yapılacak olup, primleri yasal asgari ücret matrahı üzerinden hesaplanarak ilgili kuruma yatırılacaktır."
  );
  writeParagraph(
    `3.3. Okul Başı Sabit Başarı Primi: Personel'in KantinPay otomasyon sistemini kullanması için resmi olarak anlaşma sağladığı ve sözleşme imzalattığı her bir okul için ${bonusStr}${bonusWords ? ` (${bonusWords} Türk Lirası)` : ""} "Okul Başarı Primi" tahakkuk ettirilir.`
  );
  writeParagraph(
    "Ödeme Vadesi: Sözleşme süresi boyunca biriken tüm toplam okul başarı primleri, tek seferde 25 Ekim 2026 tarihinde Personel'in sözleşmede beyan ettiği Kuveyt Türk banka hesabına transfer edilecektir. Bu tarihten önce herhangi bir ara prim ödemesi talep edilemez.",
    { indent: 5 }
  );
  writeParagraph(
    `3.4. Reklam Kâr Payı Primi: Personel'in sisteme bizzat dahil ettiği ve anlaşma sağladığı okullara özel olarak alınacak yerel/bölgesel reklamlardan Şirket'in elde edeceği aylık net kârın ${pctStr}'i (${pctWords}) "Reklam Kâr Payı" olarak Personel'e ödenir.`
  );
  writeParagraph(
    "Ödeme Vadesi: Reklam kâr payı ödemeleri, reklamların yayında olduğu sürece her ayın 10'u ile 15'i arasında Personel'in Kuveyt Türk hesabına aktarılacaktır.",
    { indent: 5 }
  );

  // 4. KVKK
  writeHeading("4. VERİ GİZLİLİĞİ VE TİCARİ SIRLARIN KORUNMASI (KVKK)");
  writeParagraph(
    "4.1. Personel, sahada yürüttüğü faaliyetler esnasında vakıf olduğu Şirket'e ait yazılım kodları, müşteri (okul, kantinci, veli, öğrenci) bilgileri, fiyat politikaları, ticari stratejiler ve veri tabanı yapılarını \"Ticari Sır\" ve \"Kişisel Veri (KVKK)\" olarak kabul eder."
  );
  writeParagraph(
    "4.2. Personel, edindiği bu bilgileri Şirket'in yazılı izni olmaksızın üçüncü şahıslarla, rakip firmalarla paylaşamaz, kopyalayamaz, kendi menfaatine kullanamaz ve sistem dışına çıkaramaz."
  );
  writeParagraph(
    "4.3. Bu maddenin ihlali halinde Personel, Şirket'in uğrayacağı tüm doğrudan ve dolaylı maddi/manevi zararları tazmin etmekle yükümlü olduğunu ve hakkında Türk Ceza Kanunu kapsamında suç duyurusunda bulunulacağını gayrikabili rücu kabul eder."
  );

  // 5. REKABET
  writeHeading("5. REKABET YASAĞI");
  writeParagraph(
    "Personel, işbu sözleşme süresince ve sözleşme herhangi bir sebeple sona erdikten sonraki 1 (bir) yıl boyunca, Şirket ile doğrudan veya dolaylı olarak rekabet eden başka bir kantin otomasyonu, okul yazılımı veya benzeri bir projede çalışamaz, danışmanlık veremez veya bu tarz bir girişime ortak olamaz."
  );

  // 6. FESİH
  writeHeading("6. SÖZLEŞMENİN FESHİ");
  writeParagraph(
    "Personel'in Şirket hedeflerine uyum sağlamaması, sahada Şirket imajını zedeleyecek davranışlarda bulunması veya Gizlilik/Rekabet maddelerini ihlal etmesi durumunda Şirket, işbu sözleşmeyi tazminatsız olarak derhal feshetme hakkına sahiptir. Fesih tarihinde hak edilmiş ancak vadesi gelmemiş primler, Personel'in Şirkete herhangi bir zarar vermediği tespit edildikten sonra Madde 3'teki vadelerde ödenir."
  );

  // 7. YETKİLİ MAHKEME
  writeHeading("7. YETKİLİ MAHKEME");
  writeParagraph(
    "İşbu sözleşmeden doğabilecek her türlü ihtilafta İstanbul Mahkemeleri ve İcra Daireleri yetkilidir."
  );

  writeParagraph(
    "7 maddeden oluşan işbu sözleşme, tarafların karşılıklı rızası ile iki nüsha olarak imza altına alınmıştır."
  );

  // İmza bloğu
  if (y > 245) { doc.addPage(); y = MARGIN; }
  y += 8;
  const { day, month, year } = todayParts();
  doc.setFont(FONT, "normal");
  doc.setFontSize(9.5);
  const colW = CONTENT_W / 2;
  doc.text(`Tarih: ${day} / ${month} / ${year}`, MARGIN, y);
  doc.text(`Tarih: ${day} / ${month} / ${year}`, MARGIN + colW, y);
  y += 14;
  doc.setFont(FONT, "bold");
  doc.text("ŞİRKET (KantinPay)", MARGIN, y);
  doc.text("PERSONEL", MARGIN + colW, y);
  y += 4;
  doc.setFont(FONT, "normal");
  doc.text("Kaşe / İmza", MARGIN, y);
  doc.text(`${data.full_name}`, MARGIN + colW, y);
  y += 4;
  doc.text("İmza: ____________________", MARGIN + colW, y);

  return doc.output("blob");
}

export function downloadMarketerContract(data: ContractData) {
  const blob = generateMarketerContractPdf(data);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (data.full_name || "personel").replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s+/g, "_");
  a.download = `Sozlesme_${safeName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
