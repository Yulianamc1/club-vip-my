import { createFinanceStore } from "./storage.js";
import {
  createEncryptedBackup,
  downloadBackup,
  readEncryptedBackup,
} from "./backup.js";
import {
  TAX_REGIMES,
  SAT_REFERENCE_URLS,
  calculateTaxSummary,
  getRegime,
  taxFieldsForRegime,
  taxProfileForDate,
} from "./tax.js";
import { buildReport, exportPdf, exportWord } from "./reports.js";

let context = globalThis.MYVIP_FINANCE_CONTEXT || {};
const root = document.getElementById("financeApp");
const THEMES = [
  { id: "purple", name: "Morado", accent: "#6d3bd1", accent2: "#9b6ee8", soft: "#f0eafd", softer: "#faf8ff", ink: "#3c1d76" },
  { id: "pink", name: "Rosa", accent: "#c43f83", accent2: "#ec75ad", soft: "#fde9f3", softer: "#fff8fb", ink: "#74224d" },
  { id: "blue", name: "Azul", accent: "#286bc7", accent2: "#68a1ea", soft: "#e9f3ff", softer: "#f8fbff", ink: "#17437d" },
  { id: "green", name: "Verde", accent: "#1d7d63", accent2: "#59aa91", soft: "#e7f6f1", softer: "#f7fcfa", ink: "#124f40" },
  { id: "terracotta", name: "Terracota", accent: "#b6563f", accent2: "#da8a72", soft: "#faece7", softer: "#fff9f7", ink: "#713528" },
  { id: "neutral", name: "Neutro", accent: "#58536c", accent2: "#88829e", soft: "#efedf4", softer: "#faf9fc", ink: "#363244" },
];
const NAV_ITEMS = [
  ["summary", "Inicio"],
  ["income", "Ingresos"],
  ["services", "Trabajos y servicios"],
  ["expenses", "Gastos"],
  ["invoices", "Facturas"],
  ["taxes", "SAT y régimen"],
  ["closing", "Cierre mensual"],
];
const SALE_CATEGORIES = ["Producto", "Servicio", "Producto digital", "Cita", "Pedido personalizado", "Suscripción", "Curso o clase", "Otro ingreso"];
const EXPENSE_CATEGORIES = ["Materiales", "Publicidad", "Envíos", "Comisiones", "Renta y servicios", "Equipo o mantenimiento", "Plataformas", "Honorarios", "Impuestos", "Otro gasto"];
const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Tarjeta", "Depósito", "Mercado Pago", "PayPal", "Plataforma digital", "Otro"];
const SERVICE_CATEGORIES = new Set(["Servicio", "Cita", "Pedido personalizado", "Curso o clase"]);

let store;
let settings;
let movements = [];
let catalog = [];
let selectedRestore;
const state = {
  tab: "summary",
  month: new Date().toISOString().slice(0, 7),
  movementType: "all",
  movementStatus: "all",
  movementSearch: "",
  reportFrom: `${new Date().getFullYear()}-01-01`,
  reportTo: new Date().toISOString().slice(0, 10),
};

function uid(prefix = "item") {
  return `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return nowIso().slice(0, 10);
}

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

function money(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: settings?.currency || "MXN",
    maximumFractionDigits: 2,
  }).format(number(value));
}

function readableDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function monthName(value) {
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" })
    .format(new Date(`${value}-15T12:00:00`));
}

function monthBounds(month = state.month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = new Date(year, monthNumber, 0).toISOString().slice(0, 10);
  return { from, to };
}

function addMonths(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function paymentAmountWithin(item, from, to) {
  if (item.type !== "income") return 0;
  if (Array.isArray(item.payments) && item.payments.length) {
    return item.payments
      .filter((payment) => payment.date >= from && payment.date <= to)
      .reduce((sum, payment) => sum + number(payment.amount), 0);
  }
  return item.date >= from && item.date <= to ? number(item.paidAmount) : 0;
}

function summaryFor(from, to) {
  const alive = movements.filter((item) => !item.deletedAt);
  const income = alive.reduce((sum, item) => sum + paymentAmountWithin(item, from, to), 0);
  const expenses = alive
    .filter((item) => item.type === "expense" && item.date >= from && item.date <= to)
    .reduce((sum, item) => sum + number(item.amount), 0);
  const cost = alive
    .filter((item) => item.type === "income")
    .reduce((sum, item) => {
      const collected = paymentAmountWithin(item, from, to);
      const ratio = number(item.amount) > 0 ? Math.min(1, collected / number(item.amount)) : 0;
      return sum + number(item.costAmount) * ratio;
    }, 0);
  const sold = alive
    .filter((item) => item.type === "income" && item.date >= from && item.date <= to)
    .reduce((sum, item) => sum + number(item.amount), 0);
  const pending = alive
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + Math.max(0, number(item.amount) - number(item.paidAmount)), 0);
  return { income, expenses, cost, profit: income - expenses - cost, sold, pending };
}

function statusFor(item) {
  if (item.type === "expense") return "paid";
  if (number(item.paidAmount) <= 0) return "pending";
  if (number(item.paidAmount) < number(item.amount)) return "partial";
  return "paid";
}

function statusLabel(status) {
  return { paid: "Pagado", partial: "Pago parcial", pending: "Pendiente" }[status] || status;
}

function applyTheme(theme = settings) {
  const preset = THEMES.find((item) => item.id === theme?.themeId) || THEMES[0];
  const customAccent = theme?.accent || preset.accent;
  const style = document.documentElement.style;
  style.setProperty("--accent", customAccent);
  style.setProperty("--accent-2", theme?.accent2 || preset.accent2);
  style.setProperty("--accent-soft", theme?.accentSoft || preset.soft);
  style.setProperty("--accent-softer", theme?.accentSofter || preset.softer);
  style.setProperty("--accent-ink", theme?.accentInk || preset.ink);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", customAccent);
}

function toast(message, type = "default") {
  let region = document.querySelector(".toast-region");
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 4200);
}

function backupAgeText() {
  if (!settings?.lastBackupAt) return "Aún no has descargado un respaldo";
  const days = Math.floor((Date.now() - new Date(settings.lastBackupAt).getTime()) / 86400000);
  if (days <= 0) return "Respaldo creado hoy";
  if (days === 1) return "Último respaldo: ayer";
  return `Último respaldo: hace ${days} días`;
}

function shouldWarnBackup() {
  if (!settings?.lastBackupAt) return movements.length > 0;
  return Date.now() - new Date(settings.lastBackupAt).getTime() > 15 * 86400000;
}

function currentProfile() {
  return taxProfileForDate(settings, today());
}

function monthClosure(month = state.month) {
  return settings?.monthClosures?.[month] || { status: "open" };
}

function monthIsClosed(month = state.month) {
  return monthClosure(month).status === "closed";
}

function movementMonth(item) {
  return String(item?.date || "").slice(0, 7);
}

function belongsToSelectedMonth(item) {
  return movementMonth(item) === state.month && !item.deletedAt;
}

function isServiceMovement(item) {
  if (item?.type !== "income") return false;
  const saved = catalog.find((entry) => entry.id === item.catalogId);
  return saved?.kind === "service" || SERVICE_CATEGORIES.has(item.category);
}

function invoiceStatusLabel(item) {
  const status = item?.tax?.invoiceStatus || "none";
  if (status === "pending") return "Pendiente";
  if (status === "global") return "Factura global";
  if (status === "issued") return item.type === "income" ? "Emitida" : "Recibida";
  if (status === "received") return "Recibida";
  return "Sin factura / no aplica";
}

async function loadData() {
  [movements, catalog] = await Promise.all([
    store.getAll("movements"),
    store.getAll("catalog"),
  ]);
  movements.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  catalog.sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
}

async function saveSettings(next) {
  settings = { ...settings, ...next, id: "current", updatedAt: nowIso() };
  await store.put("settings", settings);
  applyTheme(settings);
}

function shellHtml() {
  return `<div class="finance-shell">
    <header class="finance-topbar">
      <div class="topbar-inner">
        <div class="finance-brand">
          <span class="brand-mark" aria-hidden="true">MY</span>
          <div class="brand-copy"><h1>Mis Finanzas</h1><p>${escapeHtml(settings.businessName || "Mi negocio")} · espacio privado</p></div>
        </div>
        <div class="top-actions">
          ${context.demo ? '<span class="demo-pill">Vista demostración</span>' : ""}
          <span class="privacy-pill"><span aria-hidden="true">●</span> Solo en este dispositivo</span>
          <button class="button outline" data-action="back-platform"><span class="button-icon" aria-hidden="true">←</span><span>Plataforma</span></button>
          <button class="button outline" data-action="theme"><span class="button-icon" aria-hidden="true">●</span><span>Color</span></button>
          <button class="button primary" data-action="backup"><span class="button-icon" aria-hidden="true">↓</span><span>Respaldo</span></button>
        </div>
      </div>
      <div class="finance-nav-wrap"><nav class="finance-nav" aria-label="Secciones de Finanzas">${NAV_ITEMS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`).join("")}</nav></div>
    </header>
    <main class="finance-main">
      <section class="privacy-banner ${shouldWarnBackup() ? "needs-backup" : ""}">
        <span class="banner-icon" aria-hidden="true">${shouldWarnBackup() ? "!" : "✓"}</span>
        <div><h2>${shouldWarnBackup() ? "Protege tu información con un respaldo" : "Tus datos permanecen privados"}</h2><p>Se guardan automáticamente en este dispositivo. Para usarlos en otro celular, tablet o computadora, descarga tu respaldo y restáuralo allá. <b>${escapeHtml(backupAgeText())}.</b></p></div>
        <div class="banner-actions"><button class="button soft small" data-action="restore">Restaurar mis datos</button><button class="button primary small" data-action="download-backup">Descargar respaldo</button></div>
      </section>
      <div id="financeContent"></div>
    </main>
  </div>`;
}

function heading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
}

function metric(icon, label, value, help, className = "") {
  return `<article class="card metric-card"><span class="metric-icon" aria-hidden="true">${icon}</span><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value ${className}">${escapeHtml(value)}</div><div class="metric-help">${escapeHtml(help)}</div></article>`;
}

function emptyState(title, text, action = "", actionLabel = "") {
  return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">◇</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action ? `<button class="button primary" data-action="${action}">${escapeHtml(actionLabel)}</button>` : ""}</div>`;
}

function topRanking(from, to) {
  const map = new Map();
  for (const item of movements.filter((movement) => movement.type === "income" && !movement.deletedAt)) {
    const collected = paymentAmountWithin(item, from, to);
    if (collected <= 0) continue;
    const ratio = number(item.amount) > 0 ? Math.min(1, collected / number(item.amount)) : 0;
    const profit = collected - number(item.costAmount) * ratio;
    const name = item.catalogName || item.concept || "Sin nombre";
    map.set(name, number(map.get(name)) + profit);
  }
  return [...map.entries()].map(([name, profit]) => ({ name, profit })).sort((a, b) => b.profit - a.profit).slice(0, 6);
}

function trendData() {
  return Array.from({ length: 6 }, (_, index) => {
    const month = addMonths(state.month, index - 5);
    const { from, to } = monthBounds(month);
    const summary = summaryFor(from, to);
    return { month, income: summary.income, expense: summary.expenses + summary.cost };
  });
}

function renderSummary() {
  const { from, to } = monthBounds();
  const summary = summaryFor(from, to);
  const trend = trendData();
  const maximum = Math.max(1, ...trend.flatMap((item) => [item.income, item.expense]));
  const ranking = topRanking(from, to);
  const recent = movements.filter((item) => !item.deletedAt).slice(0, 6);
  return `${heading("Tu negocio en números", `Resumen de ${monthName(state.month)}`, "Lo esencial para saber cuánto vendiste, gastaste y ganaste.", `<div class="field"><label for="monthPicker">Cambiar mes</label><input id="monthPicker" data-change="month" type="month" value="${state.month}"></div>`)}
    <section class="grid metrics-grid">
      ${metric("$", "Cobrado", money(summary.income), "Dinero realmente recibido", "positive")}
      ${metric("−", "Gastos", money(summary.expenses), "Pagos del negocio", "negative")}
      ${metric("↘", "Costos de venta", money(summary.cost), "Costo de lo vendido", "negative")}
      ${metric("=", "Ganancia estimada", money(summary.profit), "Cobrado menos gastos y costos", summary.profit >= 0 ? "positive" : "negative")}
      ${metric("!", "Por cobrar", money(summary.pending), "Pendiente acumulado", summary.pending > 0 ? "warning" : "")}
    </section>
    ${monthIsClosed() ? `<section class="closed-month-banner"><div><b>Este mes está cerrado</b><span>Puedes consultar y descargar sus resultados. Reábrelo desde Cierre mensual si necesitas corregir algo.</span></div><button class="button soft" data-tab="closing">Ver cierre</button></section>` : ""}
    <section class="quick-panel"><div class="quick-panel-head"><div><p class="quick-eyebrow">REGISTRA AQUÍ</p><h3>Ingresa lo que entra y sale de tu negocio</h3><p>Cada registro actualiza automáticamente tus ingresos, gastos, ganancias, pendientes, facturas, SAT y reporte mensual.</p></div><button class="button quick-example-button" data-action="show-registration-example">Ver un ejemplo</button></div><div class="quick-grid">
      <button class="quick-action" data-action="new-income"><span aria-hidden="true">＋</span><b>Registrar ingreso o venta</b><small>Dinero recibido o pendiente por un producto.</small></button>
      <button class="quick-action" data-action="new-service"><span aria-hidden="true">◇</span><b>Registrar trabajo o servicio</b><small>Trabajo realizado, cita, anticipo o saldo.</small></button>
      <button class="quick-action" data-action="new-expense"><span aria-hidden="true">−</span><b>Registrar gasto</b><small>Materiales, publicidad, comisiones u otra salida.</small></button>
      <button class="quick-action" data-tab="invoices"><span aria-hidden="true">▤</span><b>Revisar facturas</b><small>Comprobantes propios pendientes, emitidos o recibidos.</small></button>
    </div></section>
    <div style="height:14px"></div>
    <section class="grid two-grid">
      <article class="card chart-card"><div class="section-title"><div><h3>Ingresos y salidas</h3><p>Comparación de los últimos seis meses</p></div><div class="chart-legend"><span><i class="legend-dot"></i>Cobrado</span><span><i class="legend-dot expense"></i>Gastos + costos</span></div></div><div class="bar-chart" role="img" aria-label="Comparación mensual de ingresos y gastos">${trend.map((item) => `<div class="bar-group"><div class="bar-stack"><span class="bar income" style="height:${Math.max(2, item.income / maximum * 100)}%" title="Cobrado ${money(item.income)}"></span><span class="bar expense" style="height:${Math.max(2, item.expense / maximum * 100)}%" title="Salidas ${money(item.expense)}"></span></div><span class="bar-label">${new Intl.DateTimeFormat("es-MX", { month: "short" }).format(new Date(`${item.month}-15T12:00:00`))}</span></div>`).join("")}</div></article>
      <article class="card"><div class="section-title"><div><h3>Lo más rentable</h3><p>Ganancia estimada del mes</p></div></div>${ranking.length ? `<div class="rank-list">${ranking.map((item) => `<div class="rank-row"><span class="rank-name">${escapeHtml(item.name)}</span><span class="rank-track"><span class="rank-fill" style="width:${Math.max(3, item.profit / Math.max(1, ranking[0].profit) * 100)}%"></span></span><span class="rank-value">${money(item.profit)}</span></div>`).join("")}</div>` : emptyState("Aún no hay ventas cobradas", "Cuando registres una venta, aquí verás qué te deja mayor ganancia.")}</article>
    </section>
    <div style="height:14px"></div>
    <section class="card table-card"><div style="padding:18px 18px 0" class="section-title"><div><h3>Movimientos recientes</h3><p>Lo último que registraste</p></div><button class="button small outline" data-tab="income">Ver ingresos</button></div>${recent.length ? recordsTable(recent) : `<div style="padding:0 18px 18px">${emptyState("Tu historial está vacío", "Registra tu primera venta o gasto para comenzar.", "new-income", "Registrar mi primera venta")}</div>`}</section>`;
}

function recordRow(item) {
  const status = statusFor(item);
  const value = item.type === "income" ? item.amount : item.amount;
  return `<tr><td>${escapeHtml(readableDate(item.date))}</td><td><span class="status ${item.type === "income" ? "paid" : "pending"}">${item.type === "income" ? "Venta" : "Gasto"}</span></td><td><b>${escapeHtml(item.concept)}</b><br><small>${escapeHtml(item.category || "Sin categoría")}</small></td><td>${escapeHtml(item.party || "—")}</td><td><span class="status ${status}">${statusLabel(status)}</span></td><td class="amount ${item.type}">${item.type === "income" ? "+" : "−"}${money(value)}</td><td><div class="row-actions">${item.type === "income" && status !== "paid" ? `<button class="button small soft" data-action="add-payment" data-id="${item.id}">Cobrar</button>` : ""}<button class="button small outline" data-action="edit-movement" data-id="${item.id}">Editar</button></div></td></tr>`;
}

function mobileRecord(item) {
  const status = statusFor(item);
  return `<article class="mobile-record"><div class="mobile-record-top"><div><h3>${escapeHtml(item.concept)}</h3><p>${item.type === "income" ? "Venta" : "Gasto"} · ${escapeHtml(readableDate(item.date))}</p></div><b class="amount ${item.type}">${item.type === "income" ? "+" : "−"}${money(item.amount)}</b></div><div class="mobile-record-bottom"><span class="status ${status}">${statusLabel(status)}</span><div class="row-actions">${item.type === "income" && status !== "paid" ? `<button class="button small soft" data-action="add-payment" data-id="${item.id}">Cobrar</button>` : ""}<button class="button small outline" data-action="edit-movement" data-id="${item.id}">Editar</button></div></div></article>`;
}

function recordsTable(items) {
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Cliente / proveedor</th><th>Estado</th><th>Importe</th><th></th></tr></thead><tbody>${items.map(recordRow).join("")}</tbody></table></div><div class="mobile-records">${items.map(mobileRecord).join("")}</div>`;
}

function filteredMovements() {
  const search = state.movementSearch.trim().toLowerCase();
  return movements.filter((item) => {
    if (item.deletedAt) return false;
    if (state.movementType !== "all" && item.type !== state.movementType) return false;
    if (state.movementStatus !== "all" && statusFor(item) !== state.movementStatus) return false;
    if (search && !`${item.concept} ${item.party || ""} ${item.category || ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderMovements() {
  const items = filteredMovements();
  return `${heading("Historial organizado", "Ventas y gastos", "Busca, filtra o corrige cualquier registro.", `<button class="button success" data-action="new-income">＋ Venta</button><button class="button danger" data-action="new-expense">− Gasto</button>`)}
    <section class="toolbar"><div class="field search-field"><label for="movementSearch">Buscar</label><input id="movementSearch" data-input="movement-search" value="${escapeHtml(state.movementSearch)}" placeholder="Producto, cliente, proveedor…"></div><div class="field"><label for="movementType">Tipo</label><select id="movementType" data-change="movement-type"><option value="all">Todos</option><option value="income" ${state.movementType === "income" ? "selected" : ""}>Ventas</option><option value="expense" ${state.movementType === "expense" ? "selected" : ""}>Gastos</option></select></div><div class="field"><label for="movementStatus">Estado</label><select id="movementStatus" data-change="movement-status"><option value="all">Todos</option><option value="paid" ${state.movementStatus === "paid" ? "selected" : ""}>Pagados</option><option value="partial" ${state.movementStatus === "partial" ? "selected" : ""}>Parciales</option><option value="pending" ${state.movementStatus === "pending" ? "selected" : ""}>Pendientes</option></select></div><button class="button outline" data-action="clear-filters">Limpiar</button></section>
    <section class="card table-card">${items.length ? recordsTable(items) : `<div style="padding:18px">${emptyState("No encontramos movimientos", "Prueba con otros filtros o registra un nuevo movimiento.", "new-income", "Registrar venta")}</div>`}</section>`;
}

function monthRecordSection(items, emptyTitle, emptyText, action, actionLabel) {
  return `<section class="card table-card">${items.length ? recordsTable(items) : `<div style="padding:18px">${emptyState(emptyTitle, emptyText, action, actionLabel)}</div>`}</section>`;
}

function renderIncome() {
  const items = movements.filter((item) => belongsToSelectedMonth(item) && item.type === "income" && !isServiceMovement(item));
  const pending = items.reduce((sum, item) => sum + Math.max(0, number(item.amount) - number(item.paidAmount)), 0);
  const collected = items.reduce((sum, item) => sum + number(item.paidAmount), 0);
  return `${heading("Tus propias ventas", "Ingresos y ventas", "Registra aquí las ventas de tus productos físicos o digitales. Nada de esta sección pertenece a MY.", `<button class="button outline" data-action="show-registration-example">Ver ejemplo</button><button class="button success" data-action="new-income">＋ Registrar ingreso</button>`)}
    <section class="grid metrics-grid">${metric("$", "Cobrado", money(collected), "Dinero recibido en estas ventas", "positive")}${metric("!", "Por cobrar", money(pending), "Saldo pendiente de tus clientes", pending ? "warning" : "")}</section><div style="height:14px"></div>
    ${monthRecordSection(items, "Aún no registras ingresos este mes", "Agrega una venta de tu propio producto para comenzar.", "new-income", "Registrar ingreso")}`;
}

function renderServices() {
  const items = movements.filter((item) => belongsToSelectedMonth(item) && isServiceMovement(item));
  const saved = catalog.filter((item) => item.kind === "service");
  return `${heading("Tu trabajo", "Trabajos y servicios", "Controla tus propios pedidos personalizados, citas, anticipos, entregas o servicios.", `<button class="button outline" data-action="show-registration-example">Ver ejemplo</button><button class="button primary" data-action="new-service">＋ Registrar trabajo o servicio</button>`)}
    ${monthRecordSection(items, "Aún no registras trabajos o servicios", "Agrega un trabajo, cita, pedido personalizado o servicio de tu negocio.", "new-service", "Registrar trabajo o servicio")}
    <div style="height:14px"></div><section class="card service-catalog-card"><div class="section-title"><div><h3>Trabajos y servicios frecuentes</h3><p>Guárdalos una vez para registrar tus cobros más rápido.</p></div><button class="button small outline" data-action="new-catalog">＋ Agregar</button></div>${saved.length ? `<div class="catalog-compact">${saved.map((item) => `<button class="catalog-compact-item" data-action="sell-catalog" data-id="${item.id}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.category || "Servicio")}</small></span><strong>${money(item.price)}</strong></button>`).join("")}</div>` : `<p class="muted-copy">Todavía no guardas servicios frecuentes. Esto es opcional y solo organiza tu propio negocio.</p>`}</section>`;
}

function renderExpenses() {
  const items = movements.filter((item) => belongsToSelectedMonth(item) && item.type === "expense");
  const total = items.reduce((sum, item) => sum + number(item.amount), 0);
  return `${heading("Salidas de tu negocio", "Gastos", "Registra lo que tú pagas para trabajar: materiales, publicidad, herramientas, comisiones y otros gastos.", `<button class="button outline" data-action="show-registration-example">Ver ejemplo</button><button class="button danger" data-action="new-expense">− Registrar gasto</button>`)}
    <section class="grid metrics-grid">${metric("−", "Gastos del mes", money(total), `${items.length} ${items.length === 1 ? "registro" : "registros"}`, "negative")}</section><div style="height:14px"></div>
    ${monthRecordSection(items, "Aún no registras gastos este mes", "Agrega una salida propia de tu negocio para calcular mejor tu ganancia.", "new-expense", "Registrar gasto")}`;
}

function invoiceCards(items) {
  return `<div class="invoice-list">${items.map((item) => `<article class="invoice-item"><div><span class="status ${item.tax?.invoiceStatus === "pending" ? "pending" : item.tax?.invoiceStatus === "none" ? "" : "paid"}">${escapeHtml(invoiceStatusLabel(item))}</span><h3>${escapeHtml(item.concept)}</h3><p>${item.type === "income" ? "Venta o ingreso" : "Gasto"} · ${escapeHtml(readableDate(item.date))} · ${escapeHtml(item.party || "Sin nombre")}</p></div><div class="invoice-item-side"><b>${money(item.amount)}</b><button class="button small outline" data-action="edit-movement" data-id="${item.id}">Revisar</button></div></article>`).join("")}</div>`;
}

function renderInvoices() {
  const items = movements.filter(belongsToSelectedMonth);
  const pending = items.filter((item) => item.tax?.invoiceStatus === "pending").length;
  const ready = items.filter((item) => ["issued", "received", "global"].includes(item.tax?.invoiceStatus)).length;
  const none = items.filter((item) => !item.tax?.invoiceStatus || item.tax?.invoiceStatus === "none").length;
  return `${heading("Tus comprobantes", "Facturas", "Revisa las facturas de tus propias ventas y gastos. Esta sección no contiene documentos ni operaciones de MY.")}
    <section class="grid metrics-grid">${metric("!", "Pendientes", String(pending), "Comprobantes que falta revisar", pending ? "warning" : "")}${metric("✓", "Emitidas o recibidas", String(ready), "Marcadas por ti")}${metric("—", "Sin factura / no aplica", String(none), "Según lo que seleccionaste")}</section><div style="height:14px"></div>
    <section class="card table-card">${items.length ? invoiceCards(items) : `<div style="padding:18px">${emptyState("Todavía no hay movimientos", "Las facturas aparecerán aquí cuando registres tus propias ventas o gastos.", "new-income", "Registrar ingreso")}</div>`}</section>`;
}

function renderCatalog() {
  return `${heading("Tus precios y costos", "Productos y servicios", "Guarda lo que vendes para registrar ventas más rápido y conocer tu margen.", `<button class="button primary" data-action="new-catalog">＋ Agregar</button>`)}
    ${catalog.length ? `<section class="catalog-grid">${catalog.map((item) => { const profit = number(item.price) - number(item.cost); const margin = number(item.price) > 0 ? profit / number(item.price) * 100 : 0; return `<article class="card catalog-card"><span class="catalog-kind">${item.kind === "product" ? "Producto" : "Servicio"}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.category || "Sin categoría")}</p><div class="catalog-numbers"><div class="catalog-number"><span>Precio</span><b>${money(item.price)}</b></div><div class="catalog-number"><span>Costo</span><b>${money(item.cost)}</b></div><div class="catalog-number"><span>Margen</span><b>${margin.toFixed(1)}%</b></div></div><div class="catalog-actions"><button class="button small soft" data-action="sell-catalog" data-id="${item.id}">Registrar venta</button><button class="button small outline" data-action="edit-catalog" data-id="${item.id}">Editar</button></div></article>`; }).join("")}</section>` : emptyState("Agrega lo que vendes", "Puede ser un producto físico, digital, cita, asesoría o cualquier servicio. Después registrarás ventas con menos pasos.", "new-catalog", "Agregar producto o servicio")}`;
}

function renderPending() {
  const items = movements.filter((item) => item.type === "income" && !item.deletedAt && statusFor(item) !== "paid");
  const total = items.reduce((sum, item) => sum + Math.max(0, number(item.amount) - number(item.paidAmount)), 0);
  return `${heading("Seguimiento de cobros", "Dinero pendiente", "Aquí aparecen automáticamente las ventas sin pagar o con pago parcial.")}
    ${items.length ? `<div class="grid metrics-grid">${metric("!", "Total por cobrar", money(total), `${items.length} ${items.length === 1 ? "venta pendiente" : "ventas pendientes"}`, "warning")}${metric("✓", "Ya cobrado", money(items.reduce((sum, item) => sum + number(item.paidAmount), 0)), "De estas ventas", "positive")}</div><div style="height:14px"></div><section class="pending-grid">${items.map((item) => { const remaining = Math.max(0, number(item.amount) - number(item.paidAmount)); return `<article class="card pending-card"><h3>${escapeHtml(item.party || "Cliente sin nombre")}</h3><p>${escapeHtml(item.concept)} · ${escapeHtml(readableDate(item.date))}</p><div class="pending-amount">${money(remaining)}</div><div class="pending-meta"><span>Total: ${money(item.amount)}</span><span>Cobrado: ${money(item.paidAmount)}</span></div><div class="pending-actions"><button class="button success small" data-action="add-payment" data-id="${item.id}">Registrar pago</button><button class="button outline small" data-action="edit-movement" data-id="${item.id}">Editar</button></div></article>`; }).join("")}</section>` : emptyState("No tienes cobros pendientes", "Cuando una venta quede sin pagar o con pago parcial, aparecerá automáticamente en esta sección.")}`;
}

function renderTaxes() {
  const { from, to } = monthBounds();
  const tax = calculateTaxSummary(movements, settings, from, to);
  const profile = taxProfileForDate(settings, to);
  const regime = getRegime(profile.personType, profile.regimeId);
  const history = [...(settings.regimeHistory || [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return `${heading("Organizador fiscal", "SAT y régimen fiscal", "La vista se adapta a tu régimen y conserva el historial si cambias en el futuro.", `<button class="button primary" data-action="change-regime">Cambiar o agregar régimen</button>`)}
    <section class="tax-hero"><div class="tax-hero-top"><div><h3>${escapeHtml(regime.shortLabel)}</h3><p>${escapeHtml(regime.description)} Periodicidad orientativa: ${escapeHtml(regime.frequency)}.</p></div><span class="tax-badge">${profile.personType === "individual" ? "Persona física" : "Persona moral"}</span></div><div class="tax-metrics"><div class="tax-metric"><span>Ingresos sin IVA</span><b>${money(tax.incomeBeforeVat)}</b></div><div class="tax-metric"><span>IVA por revisar</span><b>${money(tax.netVat)}</b></div><div class="tax-metric"><span>ISR estimado</span><b>${money(tax.netIsr)}</b></div><div class="tax-metric"><span>Apartado sugerido</span><b>${money(tax.totalReserve)}</b></div></div></section>
    <div class="tax-note"><b>Importante:</b> esta sección organiza tus datos y genera una estimación para apartar dinero; no sustituye la declaración del SAT ni la revisión de una contadora. Las obligaciones exactas dependen de tu constancia, actividad, deducciones, retenciones y situación particular.</div>
    <div style="height:14px"></div><section class="grid two-grid"><article class="card"><div class="section-title"><div><h3>Control del mes</h3><p>${escapeHtml(monthName(state.month))}</p></div></div><div class="rank-list"><div class="rank-row"><span class="rank-name">IVA trasladado</span><span class="rank-track"><span class="rank-fill" style="width:100%"></span></span><span class="rank-value">${money(tax.vatTransferred)}</span></div><div class="rank-row"><span class="rank-name">IVA acreditable</span><span class="rank-track"><span class="rank-fill" style="width:${Math.min(100, tax.vatCreditable / Math.max(1, tax.vatTransferred) * 100)}%"></span></span><span class="rank-value">${money(tax.vatCreditable)}</span></div><div class="rank-row"><span class="rank-name">ISR retenido</span><span class="rank-track"><span class="rank-fill" style="width:${Math.min(100, tax.withheldIsr / Math.max(1, tax.isrEstimate) * 100)}%"></span></span><span class="rank-value">${money(tax.withheldIsr)}</span></div><div class="rank-row"><span class="rank-name">Comprobantes pendientes</span><span class="rank-track"><span class="rank-fill" style="width:${Math.min(100, tax.invoicesMissing * 12)}%"></span></span><span class="rank-value">${tax.invoicesMissing}</span></div></div></article><article class="card"><div class="section-title"><div><h3>Historial de régimen</h3><p>Los movimientos conservan el régimen que les correspondía</p></div></div><div class="regime-history">${history.map((item) => { const itemRegime = getRegime(item.personType, item.regimeId); return `<div class="regime-row"><span class="regime-date">Desde<br>${escapeHtml(readableDate(item.effectiveFrom))}</span><div><b>${escapeHtml(itemRegime.shortLabel)}</b><span>${item.personType === "individual" ? "Persona física" : "Persona moral"} · ${escapeHtml(itemRegime.frequency)}</span></div>${item.id === profile.id ? '<span class="status paid">Actual</span>' : ""}</div>`; }).join("")}</div></article></section>
    <div style="height:14px"></div><section class="card"><div class="section-title"><div><h3>Fuentes oficiales y revisión</h3><p>Consulta siempre tu constancia y las reglas vigentes</p></div></div><div class="page-actions" style="justify-content:flex-start"><a class="button outline" target="_blank" rel="noopener" href="${SAT_REFERENCE_URLS.regimes}">Ver regímenes en SAT</a><a class="button outline" target="_blank" rel="noopener" href="${regime.id === "resico_pf" ? SAT_REFERENCE_URLS.resicoPf : regime.id === "platforms_pf" ? SAT_REFERENCE_URLS.platforms : SAT_REFERENCE_URLS.declarations}">Consultar obligación oficial</a></div></section>`;
}

function renderReports() {
  const report = buildReport({ movements, catalog, settings, from: state.reportFrom, to: state.reportTo });
  return `${heading("Descarga tus resultados", "Reportes de tu negocio", "Elige un periodo y guarda un documento PDF o Word generado en este dispositivo.")}
    <section class="report-options"><article class="card"><div class="section-title"><div><h3>Periodo del reporte</h3><p>Puede ser semanal, mensual o personalizado</p></div></div><div class="form-grid"><div class="field"><label for="reportFrom">Desde</label><input id="reportFrom" data-change="report-from" type="date" value="${state.reportFrom}"></div><div class="field"><label for="reportTo">Hasta</label><input id="reportTo" data-change="report-to" type="date" value="${state.reportTo}"></div></div><div class="report-buttons"><button class="button primary" data-action="export-pdf">Descargar PDF</button><button class="button outline" data-action="export-word">Descargar Word</button></div><div class="privacy-explainer"><span aria-hidden="true">✓</span><span>Los documentos se generan en tu dispositivo. Tu información financiera no se envía a MY ni a Supabase.</span></div></article><article class="report-preview"><h3>${escapeHtml(settings.businessName || "Mi negocio")}</h3><p>${escapeHtml(readableDate(state.reportFrom))} al ${escapeHtml(readableDate(state.reportTo))}</p><div class="report-summary"><div><span>Ingresos</span><b>${money(report.summary.income)}</b></div><div><span>Gastos y costos</span><b>${money(report.summary.expense + report.summary.salesCost)}</b></div><div><span>Ganancia</span><b>${money(report.summary.profit)}</b></div><div><span>Por cobrar</span><b>${money(report.summary.pending)}</b></div></div><p style="font-size:11px;color:var(--muted);margin:13px 0 0">${report.summary.count} movimientos incluidos.</p></article></section>`;
}

function renderClosing() {
  const { from, to } = monthBounds();
  const summary = summaryFor(from, to);
  const closure = monthClosure();
  const closed = closure.status === "closed";
  return `${heading("Resultados de tu negocio", "Cierre mensual", "Revisa tus propios ingresos, gastos, ganancia, SAT y facturas antes de cerrar el mes.", `<button class="button outline" data-action="show-registration-example">¿Cómo funciona?</button>`)}
    <section class="closure-hero ${closed ? "is-closed" : ""}"><div><p class="eyebrow">${escapeHtml(monthName(state.month))}</p><h3>${closed ? "Mes cerrado" : "Mes abierto"}</h3><p>${closed ? `Cerrado el ${escapeHtml(readableDate(String(closure.closedAt || "").slice(0, 10)))}` : "Todavía puedes agregar o corregir tus registros."}</p></div><span class="closure-mark" aria-hidden="true">${closed ? "✓" : "○"}</span></section>
    <div style="height:14px"></div><section class="grid metrics-grid">${metric("$", "Ingresos cobrados", money(summary.income), "Dinero recibido en el mes", "positive")}${metric("−", "Gastos y costos", money(summary.expenses + summary.cost), "Salidas registradas", "negative")}${metric("=", "Ganancia estimada", money(summary.profit), "Ingresos menos gastos y costos", summary.profit >= 0 ? "positive" : "negative")}${metric("!", "Por cobrar", money(summary.pending), "Pendiente acumulado", summary.pending ? "warning" : "")}</section>
    <div style="height:14px"></div><section class="card"><div class="section-title"><div><h3>Descargar resultados del mes</h3><p>El PDF y Word se generan únicamente en tu dispositivo con tus propios registros.</p></div></div><div class="report-buttons"><button class="button primary" data-action="export-month-pdf">Descargar PDF</button><button class="button outline" data-action="export-month-word">Descargar Word</button></div></section>
    <div style="height:14px"></div><section class="card"><div class="section-title"><div><h3>Estado del mes</h3><p>${closed ? "Reábrelo solamente si necesitas corregir o agregar información." : "Antes de cerrar, verifica ventas, gastos, facturas y SAT."}</p></div><span class="status ${closed ? "paid" : "pending"}">${closed ? "Cerrado" : "Abierto"}</span></div><div class="page-actions closure-actions">${closed ? `<button class="button outline" data-action="reopen-month">Reabrir mes</button>` : `<button class="button primary" data-action="close-month">Cerrar este mes</button>`}</div></section>`;
}

function openRegistrationExample() {
  const type = settings.businessType || "both";
  const examples = [];
  if (type !== "services") examples.push({ icon: "□", title: "Ejemplo de producto", text: "Producto vendido por $350 · costo $140 · cobrado $350. Así se calcula la ganancia aproximada.", action: "example-income", label: "Registrar un producto" });
  if (type !== "products") examples.push({ icon: "◇", title: "Ejemplo de trabajo o servicio", text: "Servicio por $800 · anticipo recibido $400 · quedan $400 por cobrar. El pendiente aparece automáticamente.", action: "example-service", label: "Registrar un servicio" });
  examples.push({ icon: "−", title: "Ejemplo de gasto", text: "Material, herramienta, comisión o publicidad por $250. Elige si tiene factura y la forma de pago.", action: "example-expense", label: "Registrar un gasto" });
  openModal("Ejemplos para tu propio negocio", "Son ejemplos generales. Sustituye los nombres y cantidades por los de tu producto o servicio.", `<div class="example-grid">${examples.map((item) => `<article class="example-card"><span aria-hidden="true">${item.icon}</span><h3>${item.title}</h3><p>${item.text}</p><button class="button small outline" data-action="${item.action}">${item.label}</button></article>`).join("")}</div><div class="privacy-explainer" style="margin-top:14px"><span aria-hidden="true">✓</span><span>Estos ejemplos no se guardan. Tus registros reales pertenecen únicamente a tu cuenta y a tu negocio.</span></div>`, `<button class="button primary" data-action="close-modal">Entendido</button>`);
}

async function setMonthClosure(status) {
  const next = { ...(settings.monthClosures || {}) };
  next[state.month] = status === "closed" ? { status, closedAt: nowIso() } : { status: "open", reopenedAt: nowIso() };
  await saveSettings({ monthClosures: next });
  render();
  toast(status === "closed" ? "Mes cerrado correctamente" : "Mes reabierto", "success");
}

function render() {
  if (!document.querySelector(".finance-shell")) root.innerHTML = shellHtml();
  const nav = document.querySelector(".finance-nav");
  if (nav) nav.innerHTML = NAV_ITEMS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`).join("");
  const views = { summary: renderSummary, income: renderIncome, services: renderServices, expenses: renderExpenses, invoices: renderInvoices, taxes: renderTaxes, closing: renderClosing };
  document.getElementById("financeContent").innerHTML = (views[state.tab] || renderSummary)();
}

function regimeOptions(personType, selected) {
  return (TAX_REGIMES[personType] || []).map((regime) => `<label class="regime-option"><input type="radio" name="regimeId" value="${regime.id}" ${selected === regime.id ? "checked" : ""}><span><b>${escapeHtml(regime.label)}</b><span>${escapeHtml(regime.description)}</span></span></label>`).join("");
}

function renderWelcome() {
  root.className = "";
  root.innerHTML = `<section class="onboarding"><div class="onboarding-card"><span class="onboarding-logo" aria-hidden="true">MY</span><h1>¿Ya utilizaste Finanzas en otro dispositivo?</h1><p class="onboarding-lead">No encontramos información financiera guardada en este dispositivo. Si ya registraste ventas o gastos anteriormente, puedes recuperar todo tu dashboard con tu archivo de respaldo.</p><div class="choice-grid"><button class="choice-card primary" data-action="restore"><span aria-hidden="true">↥</span><h2>Restaurar mis datos</h2><p>Selecciona tu archivo <b>.myfinanzas</b> y escribe la contraseña que creaste.</p></button><button class="choice-card" data-action="start-setup"><span aria-hidden="true">＋</span><h2>Comenzar desde cero</h2><p>Elige esta opción si es la primera vez que utilizas Finanzas.</p></button></div><div class="privacy-explainer"><span aria-hidden="true">✓</span><span><b>Tu privacidad está protegida.</b> MY no puede ver tus ventas, gastos, ganancias ni clientes. Todo se guarda en este dispositivo.</span></div></div></section>`;
}

function renderSetup(step = 1, data = {}) {
  const draft = {
    businessName: data.businessName || context.displayName || "",
    businessType: data.businessType || "both",
    currency: data.currency || "MXN",
    personType: data.personType || "individual",
    regimeId: data.regimeId || "resico_pf",
    manualIsrReservePercent: data.manualIsrReservePercent || 10,
  };
  if (step === 1) {
    root.innerHTML = `<section class="onboarding"><div class="onboarding-card"><span class="onboarding-logo" aria-hidden="true">MY</span><div class="setup-step"><p class="eyebrow">Paso 1 de 2</p><h2>Cuéntanos sobre tu negocio</h2><p>Esto personaliza los campos y los reportes. Podrás modificarlo después.</p><form id="setupBusiness" class="form-grid"><div class="field full"><label for="setupBusinessName">Nombre del negocio</label><input id="setupBusinessName" name="businessName" required value="${escapeHtml(draft.businessName)}" placeholder="Ej. Tu negocio"></div><div class="field"><label for="setupBusinessType">¿Qué vendes?</label><select id="setupBusinessType" name="businessType"><option value="products" ${draft.businessType === "products" ? "selected" : ""}>Productos</option><option value="services" ${draft.businessType === "services" ? "selected" : ""}>Servicios</option><option value="both" ${draft.businessType === "both" ? "selected" : ""}>Productos y servicios</option></select></div><div class="field"><label for="setupCurrency">Moneda</label><select id="setupCurrency" name="currency"><option value="MXN" ${draft.currency === "MXN" ? "selected" : ""}>Peso mexicano (MXN)</option><option value="USD" ${draft.currency === "USD" ? "selected" : ""}>Dólar (USD)</option><option value="CAD" ${draft.currency === "CAD" ? "selected" : ""}>Dólar canadiense (CAD)</option><option value="EUR" ${draft.currency === "EUR" ? "selected" : ""}>Euro (EUR)</option></select></div></form><div class="setup-actions"><button class="button outline" data-action="back-welcome">Atrás</button><button class="button primary" data-action="setup-tax">Continuar</button></div></div></div></section>`;
    root.dataset.setupDraft = JSON.stringify(draft);
    return;
  }
  root.innerHTML = `<section class="onboarding"><div class="onboarding-card"><span class="onboarding-logo" aria-hidden="true">MY</span><div class="setup-step"><p class="eyebrow">Paso 2 de 2</p><h2>Configura tu régimen fiscal</h2><p>La sección SAT cambiará según esta elección. Si después cambias de régimen, podrás agregar la nueva fecha sin borrar el historial.</p><div class="form-grid"><div class="field full"><label for="setupPersonType">Tipo de persona</label><select id="setupPersonType" data-change="setup-person-type"><option value="individual" ${draft.personType === "individual" ? "selected" : ""}>Persona física</option><option value="corporate" ${draft.personType === "corporate" ? "selected" : ""}>Persona moral</option></select></div><div class="field full"><label>Régimen fiscal</label><div id="setupRegimeOptions" class="regime-options">${regimeOptions(draft.personType, draft.regimeId)}</div></div><div class="field full"><label for="setupReserve">Porcentaje personal para apartar ISR cuando no exista cálculo automático</label><input id="setupReserve" type="number" min="0" max="100" step="0.1" value="${draft.manualIsrReservePercent}"><small>Es una provisión personalizable, no el cálculo oficial. Confírmala con tu contadora.</small></div></div><div class="setup-actions"><button class="button outline" data-action="setup-back">Atrás</button><button class="button primary" data-action="finish-setup">Crear mi dashboard</button></div></div></div></section>`;
  root.dataset.setupDraft = JSON.stringify(draft);
}

function openModal(title, subtitle, body, footer = "") {
  document.querySelector(".modal-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><header class="modal-header"><div><h2 id="modalTitle">${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}</div><button class="icon-button" data-action="close-modal" aria-label="Cerrar">×</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ""}</section>`;
  document.body.append(backdrop);
  backdrop.querySelector("input:not([type=hidden]),select,button")?.focus();
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
  selectedRestore = undefined;
}

function openThemeModal() {
  const presets = THEMES.map((theme) => `<button class="theme-option ${settings.themeId === theme.id ? "active" : ""}" data-action="apply-theme" data-theme="${theme.id}"><span class="theme-swatch" style="background:linear-gradient(135deg,${theme.accent},${theme.accent2})"></span><span>${theme.name}</span></button>`).join("");
  openModal("Color de mis Finanzas", "Solo cambiará tu dashboard financiero en esta cuenta.", `<div class="theme-grid">${presets}</div><div class="field" style="margin-top:15px"><label for="customAccent">O elige tu propio color principal</label><input id="customAccent" type="color" value="${escapeHtml(settings.accent || THEMES[0].accent)}" style="height:54px;padding:5px"><small>No cambiará la tipografía, estructura ni otras secciones de la Plataforma VIP.</small></div>`, `<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="save-custom-theme">Guardar color</button>`);
}

function catalogOptions(selectedId = "") {
  return `<option value="">Sin producto o servicio guardado</option>${catalog.map((item) => `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}`;
}

function openMovementModal(type, id = "", catalogId = "", presetCategory = "") {
  const item = id ? movements.find((movement) => movement.id === id) : null;
  const targetMonth = item ? movementMonth(item) : state.month;
  if (monthIsClosed(targetMonth)) {
    toast("Este mes está cerrado. Reábrelo desde Cierre mensual para hacer cambios.", "error");
    return;
  }
  const kind = item?.type || type;
  const defaultDate = state.month === today().slice(0, 7) ? today() : `${state.month}-01`;
  const selectedCatalog = catalog.find((entry) => entry.id === (item?.catalogId || catalogId));
  const effectivePreset = presetCategory || (selectedCatalog?.kind === "service" ? "Servicio" : "");
  const profile = item?.taxProfile || taxProfileForDate(settings, item?.date || defaultDate);
  const taxOptions = taxFieldsForRegime(profile.personType, profile.regimeId);
  const amount = item?.amount ?? selectedCatalog?.price ?? "";
  const cost = item?.costAmount ?? selectedCatalog?.cost ?? "";
  const paid = item?.paidAmount ?? (kind === "income" ? amount : amount);
  const totalIncludesVat = item?.tax?.includesVat !== false;
  const vatRate = item?.tax?.vatRate ?? 16;
  const categories = kind === "income" ? SALE_CATEGORIES : EXPENSE_CATEGORIES;
  const body = `<form id="movementForm" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(item?.id || "")}"><input type="hidden" name="type" value="${kind}"><div class="field"><label for="movementDate">Fecha</label><input id="movementDate" name="date" type="date" required value="${escapeHtml(item?.date || defaultDate)}"></div>${kind === "income" ? `<div class="field"><label for="movementPaidDate">Fecha del cobro</label><input id="movementPaidDate" name="paidDate" type="date" value="${escapeHtml(item?.payments?.[0]?.date || item?.date || defaultDate)}"></div><div class="field full"><label for="movementCatalog">Producto o servicio guardado</label><select id="movementCatalog" name="catalogId" data-change="movement-catalog">${catalogOptions(item?.catalogId || catalogId)}</select></div>` : ""}<div class="field full"><label for="movementConcept">${kind === "income" ? "¿Qué vendiste?" : "¿Qué pagaste?"}</label><input id="movementConcept" name="concept" required value="${escapeHtml(item?.concept || selectedCatalog?.name || "")}" placeholder="Describe el movimiento"></div><div class="field"><label for="movementCategory">Categoría</label><select id="movementCategory" name="category">${categories.map((category) => `<option ${item?.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></div><div class="field"><label for="movementParty">${kind === "income" ? "Cliente (opcional)" : "Proveedor (opcional)"}</label><input id="movementParty" name="party" value="${escapeHtml(item?.party || "")}"></div><div class="field"><label for="movementAmount">${kind === "income" ? "Total de la venta" : "Total del gasto"}</label><input id="movementAmount" name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(amount)}"></div>${kind === "income" ? `<div class="field"><label for="movementPaid">Cobrado hasta ahora</label><input id="movementPaid" name="paidAmount" type="number" min="0" step="0.01" value="${escapeHtml(paid)}"></div><div class="field"><label for="movementCost">Costo total de lo vendido</label><input id="movementCost" name="costAmount" type="number" min="0" step="0.01" value="${escapeHtml(cost)}"><small>Ayuda a calcular la ganancia real.</small></div>` : ""}<div class="field"><label for="movementMethod">Forma de pago</label><select id="movementMethod" name="paymentMethod">${PAYMENT_METHODS.map((method) => `<option ${item?.paymentMethod === method ? "selected" : ""}>${escapeHtml(method)}</option>`).join("")}</select></div><div class="form-section"><h4>Datos fiscales · ${escapeHtml(getRegime(profile.personType, profile.regimeId).shortLabel)}</h4><p>Se guardará el régimen correspondiente a la fecha del movimiento, aunque lo cambies después.</p></div><div class="field check full"><label><input name="includesVat" type="checkbox" ${totalIncludesVat ? "checked" : ""}> El importe capturado incluye IVA</label></div><div class="field"><label for="movementVatRate">Tasa de IVA</label><select id="movementVatRate" name="vatRate"><option value="16" ${vatRate === 16 ? "selected" : ""}>16%</option><option value="8" ${vatRate === 8 ? "selected" : ""}>8%</option><option value="0" ${vatRate === 0 ? "selected" : ""}>0%</option><option value="exempt" ${vatRate === "exempt" ? "selected" : ""}>Exento</option></select></div><div class="field"><label for="movementInvoice">Comprobante</label><select id="movementInvoice" name="invoiceStatus"><option value="none" ${item?.tax?.invoiceStatus === "none" ? "selected" : ""}>No aplica / sin factura</option><option value="pending" ${item?.tax?.invoiceStatus === "pending" ? "selected" : ""}>Pendiente</option><option value="issued" ${["issued", "received"].includes(item?.tax?.invoiceStatus) ? "selected" : ""}>${kind === "income" ? "Factura emitida" : "Factura recibida"}</option><option value="global" ${item?.tax?.invoiceStatus === "global" ? "selected" : ""}>Factura global</option></select></div>${taxOptions.showWithholdings && kind === "income" ? `<div class="field"><label for="movementWithheldIsr">ISR retenido</label><input id="movementWithheldIsr" name="withheldIsr" type="number" min="0" step="0.01" value="${escapeHtml(item?.tax?.withheldIsr || 0)}"></div><div class="field"><label for="movementWithheldVat">IVA retenido</label><input id="movementWithheldVat" name="withheldVat" type="number" min="0" step="0.01" value="${escapeHtml(item?.tax?.withheldVat || 0)}"></div>` : ""}${taxOptions.showPlatformFields && kind === "income" ? `<div class="field"><label for="movementPlatformFee">Comisión de plataforma</label><input id="movementPlatformFee" name="platformFee" type="number" min="0" step="0.01" value="${escapeHtml(item?.tax?.platformFee || 0)}"></div>` : ""}${kind === "expense" ? `<div class="field check"><label><input name="deductible" type="checkbox" ${item?.tax?.deductible !== false ? "checked" : ""}> Considerar como gasto del negocio para revisión</label></div><div class="field check"><label><input name="vatCreditable" type="checkbox" ${item?.tax?.vatCreditable !== false ? "checked" : ""}> Considerar el IVA para revisión</label></div>` : ""}<div class="field full"><label for="movementNotes">Notas (opcional)</label><textarea id="movementNotes" name="notes">${escapeHtml(item?.notes || "")}</textarea></div></form>`;
  const title = item ? "Editar movimiento" : kind === "expense" ? "Registrar gasto" : effectivePreset === "Servicio" ? "Registrar trabajo o servicio" : "Registrar ingreso o venta";
  openModal(title, "Esta información pertenece únicamente a tu negocio y se guarda en este dispositivo.", body, `${item ? '<button class="button danger" data-action="delete-movement" data-id="' + item.id + '">Eliminar</button>' : ""}<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="save-movement">Guardar mi registro</button>`);
  if (!item && effectivePreset) {
    const category = document.getElementById("movementCategory");
    if (category) category.value = effectivePreset;
  }
}

function calculateTaxParts(total, includesVat, rate) {
  const numericRate = rate === "exempt" ? 0 : number(rate);
  if (numericRate <= 0) return { subtotal: total, vat: 0 };
  if (includesVat) {
    const subtotal = total / (1 + numericRate / 100);
    return { subtotal, vat: total - subtotal };
  }
  return { subtotal: total, vat: total * numericRate / 100 };
}

async function saveMovementFromForm() {
  const form = document.getElementById("movementForm");
  if (!form?.reportValidity()) return;
  const data = new FormData(form);
  const id = String(data.get("id") || "");
  const current = id ? movements.find((item) => item.id === id) : null;
  const type = String(data.get("type"));
  const date = String(data.get("date"));
  if (monthIsClosed(date.slice(0, 7))) {
    toast("Ese mes está cerrado. Reábrelo antes de guardar cambios.", "error");
    return;
  }
  const amount = number(data.get("amount"));
  const paidAmount = type === "income" ? Math.min(amount, Math.max(0, number(data.get("paidAmount")))) : amount;
  const includesVat = data.get("includesVat") === "on";
  const vatRate = data.get("vatRate") === "exempt" ? "exempt" : number(data.get("vatRate"));
  const taxParts = calculateTaxParts(amount, includesVat, vatRate);
  const catalogItem = catalog.find((item) => item.id === data.get("catalogId"));
  const profile = taxProfileForDate(settings, date);
  const paidDate = String(data.get("paidDate") || date);
  let payments = [];
  if (type === "income" && paidAmount > 0) {
    const previousPaid = number(current?.paidAmount);
    if (current && Math.abs(paidAmount - previousPaid) < .005) {
      payments = [...(current.payments || [])];
    } else if (current && paidAmount > previousPaid) {
      payments = [...(current.payments || []), { id: uid("pay"), date: paidDate, amount: paidAmount - previousPaid, method: String(data.get("paymentMethod")), createdAt: nowIso() }];
    } else {
      payments = [{ id: uid("pay"), date: paidDate, amount: paidAmount, method: String(data.get("paymentMethod")), createdAt: nowIso() }];
    }
  }
  const record = {
    id: id || uid("mov"),
    type,
    date,
    concept: String(data.get("concept") || "").trim(),
    category: String(data.get("category") || ""),
    party: String(data.get("party") || "").trim(),
    amount,
    paidAmount,
    costAmount: type === "income" ? number(data.get("costAmount")) : 0,
    paymentMethod: String(data.get("paymentMethod") || ""),
    catalogId: type === "income" ? String(data.get("catalogId") || "") : "",
    catalogName: type === "income" ? (catalogItem?.name || String(data.get("concept") || "").trim()) : "",
    notes: String(data.get("notes") || "").trim(),
    payments,
    taxProfile: { ...profile },
    tax: {
      includesVat,
      vatRate,
      subtotal: taxParts.subtotal,
      vat: taxParts.vat,
      invoiceStatus: String(data.get("invoiceStatus") || "none"),
      withheldIsr: number(data.get("withheldIsr")),
      withheldVat: number(data.get("withheldVat")),
      platformFee: number(data.get("platformFee")),
      deductible: type === "expense" ? data.get("deductible") === "on" : undefined,
      vatCreditable: type === "expense" ? data.get("vatCreditable") === "on" : undefined,
    },
    createdAt: current?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await store.put("movements", record);
  await loadData();
  closeModal();
  render();
  toast(current ? "Movimiento actualizado" : "Movimiento guardado", "success");
}

function openCatalogModal(id = "") {
  const item = id ? catalog.find((entry) => entry.id === id) : null;
  openModal(item ? "Editar producto o servicio" : "Agregar producto o servicio", "Solo tú podrás ver esta información.", `<form id="catalogForm" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(item?.id || "")}"><div class="field"><label for="catalogKind">Tipo</label><select id="catalogKind" name="kind"><option value="product" ${item?.kind === "product" ? "selected" : ""}>Producto</option><option value="service" ${item?.kind === "service" ? "selected" : ""}>Servicio</option></select></div><div class="field"><label for="catalogCategory">Categoría</label><input id="catalogCategory" name="category" value="${escapeHtml(item?.category || "")}" placeholder="Ej. Productos, diseño o consultoría"></div><div class="field full"><label for="catalogName">Nombre</label><input id="catalogName" name="name" required value="${escapeHtml(item?.name || "")}" placeholder="Ej. Producto principal o servicio inicial"></div><div class="field"><label for="catalogPrice">Precio de venta</label><input id="catalogPrice" name="price" type="number" min="0" step="0.01" required value="${escapeHtml(item?.price ?? "")}"></div><div class="field"><label for="catalogCost">Costo aproximado</label><input id="catalogCost" name="cost" type="number" min="0" step="0.01" value="${escapeHtml(item?.cost ?? "")}"><small>Incluye materiales y otros costos directos.</small></div></form>`, `${item ? `<button class="button danger" data-action="delete-catalog" data-id="${item.id}">Eliminar</button>` : ""}<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="save-catalog">Guardar</button>`);
}

async function saveCatalogFromForm() {
  const form = document.getElementById("catalogForm");
  if (!form?.reportValidity()) return;
  const data = new FormData(form);
  const id = String(data.get("id") || "");
  const current = id ? catalog.find((item) => item.id === id) : null;
  const item = { id: id || uid("cat"), kind: String(data.get("kind")), category: String(data.get("category") || "").trim(), name: String(data.get("name") || "").trim(), price: number(data.get("price")), cost: number(data.get("cost")), createdAt: current?.createdAt || nowIso(), updatedAt: nowIso() };
  await store.put("catalog", item);
  await loadData();
  closeModal();
  render();
  toast(current ? "Producto o servicio actualizado" : "Producto o servicio agregado", "success");
}

function openPaymentModal(id) {
  const item = movements.find((movement) => movement.id === id);
  if (!item) return;
  const remaining = Math.max(0, number(item.amount) - number(item.paidAmount));
  openModal("Registrar un pago", `${item.party || "Cliente"} · ${item.concept}`, `<form id="paymentForm" class="form-grid"><input type="hidden" name="id" value="${item.id}"><div class="field full"><div class="backup-summary"><div><b>${money(item.amount)}</b><span>Total</span></div><div><b>${money(item.paidAmount)}</b><span>Ya cobrado</span></div><div><b>${money(remaining)}</b><span>Pendiente</span></div></div></div><div class="field"><label for="paymentDate">Fecha del pago</label><input id="paymentDate" name="date" type="date" required value="${today()}"></div><div class="field"><label for="paymentAmount">Cantidad recibida</label><input id="paymentAmount" name="amount" type="number" min="0.01" max="${remaining}" step="0.01" required value="${remaining}"></div><div class="field full"><label for="paymentMethod">Forma de pago</label><select id="paymentMethod" name="method">${PAYMENT_METHODS.map((method) => `<option>${escapeHtml(method)}</option>`).join("")}</select></div></form>`, `<button class="button outline" data-action="close-modal">Cancelar</button><button class="button success" data-action="save-payment">Guardar pago</button>`);
}

async function savePaymentFromForm() {
  const form = document.getElementById("paymentForm");
  if (!form?.reportValidity()) return;
  const data = new FormData(form);
  const item = movements.find((movement) => movement.id === data.get("id"));
  if (!item) return;
  const amount = Math.min(number(data.get("amount")), Math.max(0, number(item.amount) - number(item.paidAmount)));
  const payments = [...(item.payments || []), { id: uid("pay"), date: String(data.get("date")), amount, method: String(data.get("method")), createdAt: nowIso() }];
  const updated = { ...item, payments, paidAmount: Math.min(number(item.amount), number(item.paidAmount) + amount), updatedAt: nowIso() };
  await store.put("movements", updated);
  await loadData();
  closeModal();
  render();
  toast("Pago registrado correctamente", "success");
}

function openRegimeModal() {
  const profile = currentProfile();
  openModal("Cambiar o agregar régimen", "El cambio aplicará desde la fecha que indiques. Los registros anteriores conservarán su régimen.", `<form id="regimeForm" class="form-grid"><div class="field"><label for="regimeEffective">Fecha de inicio</label><input id="regimeEffective" name="effectiveFrom" type="date" required value="${today()}"></div><div class="field"><label for="regimePersonType">Tipo de persona</label><select id="regimePersonType" name="personType" data-change="regime-person-type"><option value="individual" ${profile.personType === "individual" ? "selected" : ""}>Persona física</option><option value="corporate" ${profile.personType === "corporate" ? "selected" : ""}>Persona moral</option></select></div><div class="field full"><label>Nuevo régimen</label><div id="regimeModalOptions" class="regime-options">${regimeOptions(profile.personType, profile.regimeId)}</div></div><div class="field full"><label for="regimeReserve">Porcentaje personal para apartar ISR cuando no exista cálculo automático</label><input id="regimeReserve" name="reserve" type="number" min="0" max="100" step="0.1" value="${profile.manualIsrReservePercent || 10}"><small>Confirma este porcentaje con tu contadora. No sustituye el cálculo oficial.</small></div></form>`, `<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="save-regime">Guardar cambio</button>`);
}

async function saveRegimeFromForm() {
  const form = document.getElementById("regimeForm");
  if (!form?.reportValidity()) return;
  const data = new FormData(form);
  const effectiveFrom = String(data.get("effectiveFrom"));
  const personType = String(data.get("personType"));
  const regimeId = form.querySelector('input[name="regimeId"]:checked')?.value;
  if (!regimeId) return toast("Selecciona un régimen fiscal", "error");
  const nextProfile = { id: uid("regime"), effectiveFrom, personType, regimeId, manualIsrReservePercent: number(data.get("reserve")), createdAt: nowIso() };
  const history = (settings.regimeHistory || []).filter((item) => item.effectiveFrom !== effectiveFrom);
  history.push(nextProfile);
  history.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  await saveSettings({ personType, regimeId, manualIsrReservePercent: nextProfile.manualIsrReservePercent, regimeHistory: history });
  closeModal();
  render();
  toast("Régimen guardado sin borrar tu historial", "success");
}

function openBackupModal() {
  openModal("Respalda tus Finanzas", "Descarga un archivo protegido para recuperar tus datos en otro dispositivo.", `<div class="backup-warning"><b>Guarda bien tu contraseña.</b> MY no puede verla ni recuperar el archivo por ti.</div><form id="backupForm" class="form-grid" style="margin-top:14px"><div class="field full"><label for="backupPassword">Crea una contraseña para este respaldo</label><input id="backupPassword" name="password" type="password" minlength="6" required autocomplete="new-password"><small>Mínimo 6 caracteres.</small></div><div class="field full"><label for="backupConfirm">Repite la contraseña</label><input id="backupConfirm" name="confirm" type="password" minlength="6" required autocomplete="new-password"></div></form>`, `<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="create-backup">Descargar respaldo</button>`);
}

async function createBackupFromForm() {
  const form = document.getElementById("backupForm");
  if (!form?.reportValidity()) return;
  const data = new FormData(form);
  const password = String(data.get("password"));
  if (password !== String(data.get("confirm"))) return toast("Las contraseñas no coinciden", "error");
  const button = document.querySelector('[data-action="create-backup"]');
  button.disabled = true;
  button.textContent = "Protegiendo…";
  try {
    const snapshot = await store.snapshot();
    const container = await createEncryptedBackup({ snapshot, password, fingerprint: store.fingerprint });
    downloadBackup(container, settings.businessName);
    await saveSettings({ lastBackupAt: nowIso() });
    closeModal();
    render();
    toast("Respaldo protegido y descargado", "success");
  } catch (error) {
    toast(error.message === "CRYPTO_UNAVAILABLE" ? "Abre la plataforma desde una conexión segura para crear el respaldo" : "No pudimos crear el respaldo", "error");
    button.disabled = false;
    button.textContent = "Descargar respaldo";
  }
}

function chooseRestoreFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".myfinanzas,application/json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) openRestorePassword(file);
  }, { once: true });
  input.click();
}

function openRestorePassword(file) {
  selectedRestore = { file };
  openModal("Restaurar mis datos", file.name, `<div class="backup-warning">El respaldo debe pertenecer a la misma cuenta que inició sesión.</div><form id="restorePasswordForm" class="form-grid" style="margin-top:14px"><div class="field full"><label for="restorePassword">Contraseña del respaldo</label><input id="restorePassword" name="password" type="password" required autocomplete="current-password"></div></form>`, `<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="open-backup">Abrir respaldo</button>`);
}

async function decryptRestore() {
  const form = document.getElementById("restorePasswordForm");
  if (!form?.reportValidity() || !selectedRestore?.file) return;
  const button = document.querySelector('[data-action="open-backup"]');
  button.disabled = true;
  button.textContent = "Comprobando…";
  try {
    const payload = await readEncryptedBackup(selectedRestore.file, new FormData(form).get("password"));
    if (payload.accountFingerprint !== store.fingerprint) throw new Error("WRONG_ACCOUNT");
    selectedRestore.payload = payload;
    const snapshot = payload.snapshot;
    const backupSettings = snapshot.settings?.find((item) => item.id === "current") || {};
    openModal("Respaldo encontrado", `Creado el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short" }).format(new Date(payload.createdAt))}`, `<div class="backup-summary"><div><b>${snapshot.movements?.length || 0}</b><span>Movimientos</span></div><div><b>${snapshot.catalog?.length || 0}</b><span>Productos y servicios</span></div><div><b>${escapeHtml(backupSettings.businessName || "Mi negocio")}</b><span>Negocio</span></div></div><div class="backup-warning"><b>Reemplazar</b> elimina lo financiero de este dispositivo y coloca el respaldo. <b>Combinar</b> conserva lo actual y agrega lo que falte sin duplicar identificadores.</div>`, `<button class="button outline" data-action="restore-merge">Combinar</button><button class="button primary" data-action="restore-replace">Reemplazar y restaurar</button>`);
  } catch (error) {
    const messages = { WRONG_PASSWORD: "La contraseña no es correcta", INVALID_BACKUP: "Este archivo no es un respaldo válido", WRONG_ACCOUNT: "Este respaldo pertenece a otra cuenta" };
    toast(messages[error.message] || "No pudimos abrir el respaldo", "error");
    button.disabled = false;
    button.textContent = "Abrir respaldo";
  }
}

async function restoreData(mode) {
  if (!selectedRestore?.payload) return;
  const snapshot = selectedRestore.payload.snapshot;
  if (mode === "replace") await store.replaceAll(snapshot);
  else await store.mergeAll(snapshot);
  settings = await store.get("settings", "current");
  await loadData();
  applyTheme(settings);
  closeModal();
  root.innerHTML = shellHtml();
  render();
  toast("¡Listo! Recuperamos tu información financiera", "success");
}

async function finishSetup() {
  const draft = JSON.parse(root.dataset.setupDraft || "{}");
  const personType = document.getElementById("setupPersonType")?.value || draft.personType;
  const regimeId = document.querySelector('input[name="regimeId"]:checked')?.value;
  if (!regimeId) return toast("Selecciona un régimen fiscal", "error");
  const created = nowIso();
  settings = {
    id: "current",
    businessName: draft.businessName,
    businessType: draft.businessType,
    currency: draft.currency,
    personType,
    regimeId,
    manualIsrReservePercent: number(document.getElementById("setupReserve")?.value || 10),
    regimeHistory: [{ id: uid("regime"), effectiveFrom: today(), personType, regimeId, manualIsrReservePercent: number(document.getElementById("setupReserve")?.value || 10), createdAt: created }],
    themeId: "purple",
    accent: THEMES[0].accent,
    accent2: THEMES[0].accent2,
    accentSoft: THEMES[0].soft,
    accentSofter: THEMES[0].softer,
    accentInk: THEMES[0].ink,
    createdAt: created,
    updatedAt: created,
  };
  await store.put("settings", settings);
  await loadData();
  applyTheme(settings);
  root.innerHTML = shellHtml();
  render();
  toast("Tu dashboard está listo", "success");
}

async function seedDemo() {
  const date = new Date();
  const month = date.toISOString().slice(0, 7);
  const d = (day, offset = 0) => `${addMonths(month, offset)}-${String(day).padStart(2, "0")}`;
  const created = nowIso();
  const profile = { id: "regime_demo", effectiveFrom: `${date.getFullYear()}-01-01`, personType: "individual", regimeId: "resico_pf", manualIsrReservePercent: 10, createdAt: created };
  settings = { id: "current", businessName: "Mi negocio", businessType: "both", currency: "MXN", personType: "individual", regimeId: "resico_pf", manualIsrReservePercent: 10, regimeHistory: [profile], themeId: "purple", accent: THEMES[0].accent, accent2: THEMES[0].accent2, accentSoft: THEMES[0].soft, accentSofter: THEMES[0].softer, accentInk: THEMES[0].ink, createdAt: created, updatedAt: created };
  const products = [
    { id: "cat_demo_1", kind: "product", name: "Producto principal", category: "Productos", price: 180, cost: 72, createdAt: created, updatedAt: created },
    { id: "cat_demo_2", kind: "product", name: "Producto especial", category: "Productos", price: 280, cost: 125, createdAt: created, updatedAt: created },
    { id: "cat_demo_3", kind: "service", name: "Servicio personalizado", category: "Servicios", price: 350, cost: 40, createdAt: created, updatedAt: created },
  ];
  const sales = [
    ["mov_demo_1", d(3), "Producto principal", "Cliente 1", 360, 360, 144, "cat_demo_1"],
    ["mov_demo_2", d(7), "Producto especial", "Cliente 2", 560, 300, 250, "cat_demo_2"],
    ["mov_demo_3", d(11), "Servicio personalizado", "Cliente 3", 350, 350, 40, "cat_demo_3"],
  ].map(([id, dateValue, concept, party, amount, paidAmount, costAmount, catalogId]) => { const taxParts = calculateTaxParts(amount, true, 16); return { id, type: "income", date: dateValue, concept, category: "Producto", party, amount, paidAmount, costAmount, paymentMethod: "Transferencia", catalogId, catalogName: concept, notes: "", payments: paidAmount ? [{ id: `${id}_pay`, date: dateValue, amount: paidAmount, method: "Transferencia", createdAt: created }] : [], taxProfile: profile, tax: { includesVat: true, vatRate: 16, ...taxParts, invoiceStatus: "none", withheldIsr: 0, withheldVat: 0 }, createdAt: created, updatedAt: created }; });
  const expenses = [
    ["mov_demo_4", d(5), "Materiales o insumos", "Proveedor", 480, "Materiales"],
    ["mov_demo_5", d(9), "Publicidad del negocio", "Proveedor de publicidad", 300, "Publicidad"],
  ].map(([id, dateValue, concept, party, amount, category]) => { const taxParts = calculateTaxParts(amount, true, 16); return { id, type: "expense", date: dateValue, concept, category, party, amount, paidAmount: amount, costAmount: 0, paymentMethod: "Tarjeta", payments: [], taxProfile: profile, tax: { includesVat: true, vatRate: 16, ...taxParts, invoiceStatus: "pending", deductible: true, vatCreditable: true }, createdAt: created, updatedAt: created }; });
  const history = [];
  for (let offset = -5; offset < 0; offset += 1) {
    const base = 950 + (offset + 5) * 180;
    const dateValue = d(12, offset);
    const taxParts = calculateTaxParts(base, true, 16);
    history.push({ id: `mov_history_${offset}`, type: "income", date: dateValue, concept: "Ventas del mes", category: "Producto", party: "Varios clientes", amount: base, paidAmount: base, costAmount: base * .38, paymentMethod: "Transferencia", payments: [{ id: `pay_history_${offset}`, date: dateValue, amount: base, method: "Transferencia", createdAt: created }], taxProfile: profile, tax: { includesVat: true, vatRate: 16, ...taxParts, invoiceStatus: "global" }, createdAt: created, updatedAt: created });
  }
  await store.put("settings", settings);
  for (const item of products) await store.put("catalog", item);
  for (const item of [...sales, ...expenses, ...history]) await store.put("movements", item);
}

async function handleClick(event) {
  const target = event.target.closest("[data-action],[data-tab]");
  if (!target) return;
  if (target.dataset.tab) {
    state.tab = target.dataset.tab;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const action = target.dataset.action;
  if (action === "close-modal") closeModal();
  else if (action === "back-platform") location.assign(globalThis.MYVIP_FINANCE_PLATFORM_URL || "../index.html");
  else if (action === "theme") openThemeModal();
  else if (action === "backup" || action === "download-backup") openBackupModal();
  else if (action === "restore") chooseRestoreFile();
  else if (action === "start-setup") renderSetup(1);
  else if (action === "back-welcome") renderWelcome();
  else if (action === "setup-tax") {
    const form = document.getElementById("setupBusiness");
    if (!form?.reportValidity()) return;
    const draft = Object.fromEntries(new FormData(form));
    renderSetup(2, draft);
  } else if (action === "setup-back") renderSetup(1, JSON.parse(root.dataset.setupDraft || "{}"));
  else if (action === "finish-setup") await finishSetup();
  else if (action === "new-income") openMovementModal("income");
  else if (action === "new-service") openMovementModal("income", "", "", "Servicio");
  else if (action === "new-expense") openMovementModal("expense");
  else if (action === "show-registration-example") openRegistrationExample();
  else if (action === "example-income") { closeModal(); openMovementModal("income"); }
  else if (action === "example-service") { closeModal(); openMovementModal("income", "", "", "Servicio"); }
  else if (action === "example-expense") { closeModal(); openMovementModal("expense"); }
  else if (action === "edit-movement") openMovementModal("income", target.dataset.id);
  else if (action === "new-catalog") openCatalogModal();
  else if (action === "edit-catalog") openCatalogModal(target.dataset.id);
  else if (action === "sell-catalog") openMovementModal("income", "", target.dataset.id);
  else if (action === "save-movement") await saveMovementFromForm();
  else if (action === "save-catalog") await saveCatalogFromForm();
  else if (action === "add-payment") openPaymentModal(target.dataset.id);
  else if (action === "save-payment") await savePaymentFromForm();
  else if (action === "change-regime") openRegimeModal();
  else if (action === "save-regime") await saveRegimeFromForm();
  else if (action === "create-backup") await createBackupFromForm();
  else if (action === "open-backup") await decryptRestore();
  else if (action === "restore-replace") await restoreData("replace");
  else if (action === "restore-merge") await restoreData("merge");
  else if (action === "close-month") {
    if (confirm(`¿Cerrar ${monthName(state.month)}? Podrás reabrirlo después si necesitas corregir algo.`)) await setMonthClosure("closed");
  }
  else if (action === "reopen-month") await setMonthClosure("open");
  else if (action === "clear-filters") { state.movementType = "all"; state.movementStatus = "all"; state.movementSearch = ""; render(); }
  else if (action === "apply-theme") {
    const theme = THEMES.find((item) => item.id === target.dataset.theme);
    if (theme) { await saveSettings({ themeId: theme.id, accent: theme.accent, accent2: theme.accent2, accentSoft: theme.soft, accentSofter: theme.softer, accentInk: theme.ink }); closeModal(); root.innerHTML = shellHtml(); render(); toast("Color actualizado", "success"); }
  } else if (action === "save-custom-theme") {
    const accent = document.getElementById("customAccent")?.value;
    if (accent) { await saveSettings({ themeId: "custom", accent, accent2: accent, accentSoft: `color-mix(in srgb, ${accent} 12%, white)`, accentSofter: `color-mix(in srgb, ${accent} 4%, white)`, accentInk: accent }); closeModal(); root.innerHTML = shellHtml(); render(); toast("Color personalizado guardado", "success"); }
  } else if (action === "delete-movement") {
    if (confirm("¿Eliminar este movimiento? Esta acción solo afecta tus datos en este dispositivo.")) { await store.remove("movements", target.dataset.id); await loadData(); closeModal(); render(); toast("Movimiento eliminado"); }
  } else if (action === "delete-catalog") {
    if (confirm("¿Eliminar este producto o servicio del catálogo? Las ventas anteriores se conservarán.")) { await store.remove("catalog", target.dataset.id); await loadData(); closeModal(); render(); toast("Elemento eliminado"); }
  } else if (action === "export-month-pdf") {
    const { from, to } = monthBounds();
    target.disabled = true; target.textContent = "Generando…";
    try { await exportPdf(buildReport({ movements, catalog, settings, from, to })); toast("PDF mensual descargado", "success"); } catch { toast("No pudimos generar el PDF", "error"); }
    target.disabled = false; target.textContent = "Descargar PDF";
  } else if (action === "export-month-word") {
    const { from, to } = monthBounds();
    exportWord(buildReport({ movements, catalog, settings, from, to })); toast("Reporte mensual Word descargado", "success");
  } else if (action === "export-pdf") {
    target.disabled = true; target.textContent = "Generando…";
    try { await exportPdf(buildReport({ movements, catalog, settings, from: state.reportFrom, to: state.reportTo })); toast("PDF descargado", "success"); } catch { toast("No pudimos generar el PDF", "error"); }
    target.disabled = false; target.textContent = "Descargar PDF";
  } else if (action === "export-word") {
    exportWord(buildReport({ movements, catalog, settings, from: state.reportFrom, to: state.reportTo })); toast("Reporte Word descargado", "success");
  }
}

function handleChange(event) {
  const type = event.target.dataset.change;
  if (!type) return;
  if (type === "month") { state.month = event.target.value; render(); }
  else if (type === "movement-type") { state.movementType = event.target.value; render(); }
  else if (type === "movement-status") { state.movementStatus = event.target.value; render(); }
  else if (type === "report-from") { state.reportFrom = event.target.value; render(); }
  else if (type === "report-to") { state.reportTo = event.target.value; render(); }
  else if (type === "setup-person-type") {
    const draft = JSON.parse(root.dataset.setupDraft || "{}");
    draft.personType = event.target.value;
    draft.regimeId = TAX_REGIMES[draft.personType][0].id;
    root.dataset.setupDraft = JSON.stringify(draft);
    document.getElementById("setupRegimeOptions").innerHTML = regimeOptions(draft.personType, draft.regimeId);
  } else if (type === "regime-person-type") {
    document.getElementById("regimeModalOptions").innerHTML = regimeOptions(event.target.value, TAX_REGIMES[event.target.value][0].id);
  } else if (type === "movement-catalog") {
    const item = catalog.find((entry) => entry.id === event.target.value);
    if (item) {
      document.getElementById("movementConcept").value = item.name;
      document.getElementById("movementAmount").value = item.price;
      document.getElementById("movementPaid").value = item.price;
      document.getElementById("movementCost").value = item.cost;
    }
  }
}

function handleInput(event) {
  if (event.target.dataset.input === "movement-search") {
    state.movementSearch = event.target.value;
    clearTimeout(handleInput.timer);
    handleInput.timer = setTimeout(render, 180);
  }
}

async function boot() {
  try {
    if (!context.userId) throw new Error("MISSING_USER_ID");
    store = await createFinanceStore(context.userId);
    settings = await store.get("settings", "current");
    if (!settings && context.demo) {
      await seedDemo();
      settings = await store.get("settings", "current");
    }
    if (!settings) {
      applyTheme(THEMES[0]);
      renderWelcome();
      return;
    }
    await loadData();
    applyTheme(settings);
    root.className = "";
    root.innerHTML = shellHtml();
    render();
  } catch (error) {
    const missing = error.message === "MISSING_USER_ID";
    root.innerHTML = `<div class="finance-loading"><div class="loading-card"><span class="loading-mark">!</span><h1>${missing ? "Inicia sesión para abrir Finanzas" : "No pudimos abrir Finanzas"}</h1><p>${missing ? "Por seguridad, abre esta sección desde tu cuenta dentro de la Plataforma VIP." : "Actualiza la página o revisa que tu navegador permita guardar datos en este dispositivo."}</p>${missing ? '<a class="button primary finance-return" href="../index.html">Volver a la Plataforma VIP</a>' : ""}</div></div>`;
  }
}

document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("input", handleInput);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
globalThis.MYVIPFinanceClient = {
  async switchAccount(nextContext) {
    store?.close?.();
    context = { ...nextContext };
    settings = undefined;
    movements = [];
    catalog = [];
    state.tab = "summary";
    root.className = "finance-loading";
    root.innerHTML = '<div class="loading-card"><span class="loading-mark">MY</span><h1>Abriendo tus finanzas</h1><p>Estamos cargando el espacio privado de esta cuenta.</p><div class="loader"></div></div>';
    await boot();
  },
  lock() {
    store?.close?.();
    store = undefined;
    settings = undefined;
    movements = [];
    catalog = [];
    closeModal();
    root.className = "finance-loading";
    root.innerHTML = '<div class="loading-card"><span class="loading-mark">MY</span><h1>Finanzas protegidas</h1><p>Inicia sesión nuevamente para abrir este espacio.</p></div>';
  },
};
boot();
