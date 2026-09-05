import { calculateTaxSummary } from "./tax.js";

const MODULE_BASE = new URL(".", import.meta.url);

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function currency(value, code = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: code || "MXN",
    maximumFractionDigits: 2,
  }).format(number(value));
}

function paidWithin(item, from, to) {
  if (item.type !== "income") return 0;
  if (Array.isArray(item.payments) && item.payments.length) {
    return item.payments
      .filter((payment) => payment.date >= from && payment.date <= to)
      .reduce((sum, payment) => sum + number(payment.amount), 0);
  }
  return item.date >= from && item.date <= to ? number(item.paidAmount) : 0;
}

export function buildReport({ movements, catalog, settings, from, to }) {
  const all = movements.filter((item) => !item.deletedAt);
  const included = all
    .filter((item) => item.type === "expense"
      ? item.date >= from && item.date <= to
      : item.date >= from && item.date <= to || paidWithin(item, from, to) > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  const sales = all.filter((item) => item.type === "income");
  const expenses = all.filter(
    (item) => item.type === "expense" && item.date >= from && item.date <= to,
  );
  const income = sales.reduce((sum, item) => sum + paidWithin(item, from, to), 0);
  const expense = expenses.reduce((sum, item) => sum + number(item.amount), 0);
  const salesCost = sales.reduce((sum, item) => {
    const paid = paidWithin(item, from, to);
    const ratio = number(item.amount) > 0 ? Math.min(1, paid / number(item.amount)) : 0;
    return sum + number(item.costAmount) * ratio;
  }, 0);
  const profit = income - expense - salesCost;
  const pending = sales.reduce(
    (sum, item) => sum + Math.max(0, number(item.amount) - number(item.paidAmount)),
    0,
  );
  const ranking = new Map();
  for (const item of sales) {
    const paid = paidWithin(item, from, to);
    if (paid <= 0) continue;
    const ratio = number(item.amount) > 0 ? Math.min(1, paid / number(item.amount)) : 0;
    const key = item.catalogName || item.concept || "Sin categoría";
    const current = ranking.get(key) || { name: key, sales: 0, profit: 0 };
    current.sales += paid;
    current.profit += paid - number(item.costAmount) * ratio;
    ranking.set(key, current);
  }
  return {
    settings,
    catalog,
    from,
    to,
    movements: included,
    summary: { income, expense, salesCost, profit, pending, count: included.length },
    tax: calculateTaxSummary(movements, settings, from, to),
    ranking: [...ranking.values()].sort((a, b) => b.profit - a.profit).slice(0, 8),
  };
}

function reportTableRows(report) {
  const code = report.settings.currency || "MXN";
  return report.movements.map((item) => {
    const kind = item.type === "income" ? "Venta" : "Gasto";
    const status = item.type === "income"
      ? number(item.paidAmount) >= number(item.amount) ? "Pagado" : number(item.paidAmount) > 0 ? "Parcial" : "Pendiente"
      : "Pagado";
    return `<tr><td>${escapeHtml(formatDate(item.date))}</td><td>${kind}</td><td>${escapeHtml(item.concept)}</td><td>${escapeHtml(item.category || "—")}</td><td>${escapeHtml(item.party || "—")}</td><td>${status}</td><td class="num">${escapeHtml(currency(item.amount, code))}</td></tr>`;
  }).join("");
}

function reportHtml(report) {
  const { settings, summary, tax } = report;
  const code = settings.currency || "MXN";
  const accent = /^#[0-9a-f]{6}$/i.test(settings.accent || "") ? settings.accent : "#6d3bd1";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reporte financiero</title><style>
  body{font-family:Arial,sans-serif;color:#24212b;margin:34px;line-height:1.4}h1{color:${accent};margin:0 0 5px}.sub{color:#6d6877;margin-bottom:24px}.cards{display:table;width:100%;border-spacing:8px}.card{display:table-cell;background:#f5f2fb;border-left:5px solid ${accent};padding:12px}.card b{display:block;font-size:18px;margin-top:4px}h2{color:${accent};margin-top:28px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:${accent};color:#fff;text-align:left;padding:8px}td{border-bottom:1px solid #ded9e8;padding:8px}.num{text-align:right}.privacy{margin-top:25px;padding:12px;background:#f5f2fb;color:#575063;font-size:11px}.rank{margin:6px 0}.rank b{display:inline-block;min-width:180px}.notice{background:#fff4e5;border:1px solid #efcf9f;padding:11px;font-size:10px;color:#674515}</style></head><body>
  <h1>${escapeHtml(settings.businessName || "Mi negocio")}</h1>
  <div class="sub">Reporte financiero · ${escapeHtml(formatDate(report.from))} al ${escapeHtml(formatDate(report.to))}</div>
  <div class="cards"><div class="card">Ingresos cobrados<b>${escapeHtml(currency(summary.income, code))}</b></div><div class="card">Gastos y costos<b>${escapeHtml(currency(summary.expense + summary.salesCost, code))}</b></div><div class="card">Ganancia estimada<b>${escapeHtml(currency(summary.profit, code))}</b></div><div class="card">Pendiente de cobro<b>${escapeHtml(currency(summary.pending, code))}</b></div></div>
  <h2>Organizador fiscal</h2><div class="cards"><div class="card">Ingresos sin IVA<b>${escapeHtml(currency(tax.incomeBeforeVat, code))}</b></div><div class="card">IVA por revisar<b>${escapeHtml(currency(tax.netVat, code))}</b></div><div class="card">ISR estimado<b>${escapeHtml(currency(tax.netIsr, code))}</b></div><div class="card">Apartado sugerido<b>${escapeHtml(currency(tax.totalReserve, code))}</b></div></div><p class="notice">Estimación organizativa. No sustituye la declaración del SAT ni la revisión de una persona profesional en contabilidad.</p>
  <h2>Productos o servicios con mayor ganancia</h2>
  ${report.ranking.length ? report.ranking.map((item, index) => `<div class="rank"><b>${index + 1}. ${escapeHtml(item.name)}</b> ${escapeHtml(currency(item.profit, code))}</div>`).join("") : "<p>No hay ventas cobradas en este periodo.</p>"}
  <h2>Detalle de movimientos</h2>
  <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Categoría</th><th>Cliente/Proveedor</th><th>Estado</th><th>Total</th></tr></thead><tbody>${reportTableRows(report) || '<tr><td colspan="7">No hay movimientos en este periodo.</td></tr>'}</tbody></table>
  <div class="privacy">Documento generado en el dispositivo de la usuaria. Los datos financieros pertenecen a su identidad privada MY y pueden sincronizarse de forma segura para continuidad entre dispositivos; no son visibles para otras integrantes.</div>
  </body></html>`;
}

function safeBusinessName(value) {
  return String(value || "Mi-negocio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "Mi-negocio";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportWord(report) {
  const blob = new Blob(["\ufeff", reportHtml(report)], {
    type: "application/msword;charset=utf-8",
  });
  downloadBlob(blob, `Reporte-Finanzas-${safeBusinessName(report.settings.businessName)}-${report.to}.doc`);
}

let pdfLibPromise;
function loadPdfLib() {
  if (globalThis.PDFLib) return Promise.resolve(globalThis.PDFLib);
  if (pdfLibPromise) return pdfLibPromise;
  const sources = [
    "https://raw.githubusercontent.com/Yulianamc1/club-vip-my/05e06bc00cb1c17925f94fa416d44e51d85ec1c2/finanzas-clientes/vendor/pdf-lib.min.js",
    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  ];
  pdfLibPromise = new Promise((resolve, reject) => {
    const trySource = (index) => {
      if (index >= sources.length) return reject(new Error("PDF_LIBRARY_ERROR"));
      const script = document.createElement("script");
      script.src = sources[index];
      script.onload = () => globalThis.PDFLib ? resolve(globalThis.PDFLib) : trySource(index + 1);
      script.onerror = () => trySource(index + 1);
      document.head.appendChild(script);
    };
    trySource(0);
  });
  return pdfLibPromise;
}

function hexColor(value, rgb) {
  const clean = String(value || "#6d3bd1").replace("#", "");
  const safe = /^[0-9a-f]{6}$/i.test(clean) ? clean : "6d3bd1";
  return rgb(parseInt(safe.slice(0, 2), 16) / 255, parseInt(safe.slice(2, 4), 16) / 255, parseInt(safe.slice(4, 6), 16) / 255);
}

function cleanPdfText(value) {
  return String(value ?? "").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7EÀ-ÿ]/g, "");
}

function wrapText(text, font, size, maxWidth) {
  const words = cleanPdfText(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function exportPdf(report) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hexColor(report.settings.accent, rgb);
  const dark = rgb(.14, .13, .18);
  const muted = rgb(.42, .4, .47);
  const pale = rgb(.96, .95, .98);
  const code = report.settings.currency || "MXN";
  let page;
  let y;
  function newPage() { page = pdf.addPage([612, 792]); y = 748; page.drawRectangle({ x: 0, y: 772, width: 612, height: 20, color: accent }); }
  function ensure(height = 35) { if (y - height < 45) newPage(); }
  function drawText(value, x, size = 10, options = {}) {
    const font = options.bold ? bold : regular;
    for (const line of wrapText(value, font, size, options.width || 500)) {
      ensure(size + 5);
      page.drawText(line, { x, y, size, font, color: options.color || dark });
      y -= options.leading || size + 4;
    }
  }
  newPage();
  drawText(report.settings.businessName || "Mi negocio", 42, 24, { bold: true, color: accent });
  drawText(`Reporte financiero · ${formatDate(report.from)} al ${formatDate(report.to)}`, 42, 10, { color: muted });
  y -= 10;
  const metrics = [
    ["Ingresos cobrados", report.summary.income],
    ["Gastos y costos", report.summary.expense + report.summary.salesCost],
    ["Ganancia estimada", report.summary.profit],
    ["Pendiente de cobro", report.summary.pending],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 42 + index % 2 * 265;
    if (index === 2) y -= 74;
    const boxY = y - 52;
    page.drawRectangle({ x, y: boxY, width: 248, height: 58, color: pale, borderColor: accent, borderWidth: 1 });
    page.drawText(label, { x: x + 12, y: boxY + 37, size: 9, font: regular, color: muted });
    page.drawText(cleanPdfText(currency(value, code)), { x: x + 12, y: boxY + 16, size: 15, font: bold, color: dark });
  });
  y -= 82;
  drawText("Organizador fiscal", 42, 15, { bold: true, color: accent });
  drawText(`Ingresos sin IVA: ${currency(report.tax.incomeBeforeVat, code)} · IVA por revisar: ${currency(report.tax.netVat, code)} · ISR estimado: ${currency(report.tax.netIsr, code)} · Apartado sugerido: ${currency(report.tax.totalReserve, code)}`, 42, 9, { width: 520, color: dark });
  drawText("Estimación organizativa; no sustituye la declaración del SAT ni la revisión contable profesional.", 42, 8, { width: 520, color: muted });
  y -= 10;
  drawText("Mayor ganancia por producto o servicio", 42, 15, { bold: true, color: accent });
  if (!report.ranking.length) drawText("No hay ventas cobradas en este periodo.", 42, 10, { color: muted });
  const maxProfit = Math.max(1, ...report.ranking.map((item) => Math.max(0, item.profit)));
  for (const item of report.ranking.slice(0, 6)) {
    ensure(34);
    page.drawText(cleanPdfText(item.name).slice(0, 42), { x: 42, y, size: 9, font: regular, color: dark });
    page.drawText(cleanPdfText(currency(item.profit, code)), { x: 430, y, size: 9, font: bold, color: dark });
    y -= 12;
    page.drawRectangle({ x: 42, y, width: 450, height: 6, color: pale });
    page.drawRectangle({ x: 42, y, width: 450 * Math.max(0, item.profit) / maxProfit, height: 6, color: accent });
    y -= 17;
  }
  y -= 8;
  drawText("Detalle de movimientos", 42, 15, { bold: true, color: accent });
  for (const item of report.movements) {
    ensure(42);
    page.drawText(item.type === "income" ? "VENTA" : "GASTO", { x: 42, y, size: 8, font: bold, color: accent });
    page.drawText(cleanPdfText(formatDate(item.date)), { x: 95, y, size: 8, font: regular, color: muted });
    page.drawText(cleanPdfText(currency(item.amount, code)), { x: 455, y, size: 9, font: bold, color: dark });
    y -= 13;
    drawText(`${item.concept}${item.party ? ` · ${item.party}` : ""}`, 42, 9, { width: 500, leading: 12 });
    page.drawLine({ start: { x: 42, y: y + 3 }, end: { x: 570, y: y + 3 }, thickness: .5, color: pale });
    y -= 8;
  }
  ensure(30);
  y -= 8;
  drawText("Generado de forma privada en el dispositivo de la usuaria. MY no recibe estos datos financieros.", 42, 8, { width: 520, color: muted });
  const bytes = await pdf.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `Reporte-Finanzas-${safeBusinessName(report.settings.businessName)}-${report.to}.pdf`);
}
