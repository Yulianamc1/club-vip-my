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
import { solveGoal } from "./goal-engine.js";

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
  ["movements", "Movimientos"],
  ["catalog", "Productos y servicios"],
  ["pending", "Por cobrar"],
  ["taxes", "Perfil Fiscal / SAT"],
  ["goals", "🎯 Mi Meta"],
  ["reports", "Reportes"],
];
const SALE_CATEGORIES = ["Producto", "Servicio", "Producto digital", "Cita", "Pedido personalizado", "Suscripción", "Curso o clase", "Otro ingreso"];
const EXPENSE_CATEGORIES = ["Materiales", "Publicidad", "Envíos", "Comisiones", "Renta y servicios", "Equipo o mantenimiento", "Plataformas", "Honorarios", "Impuestos", "Otro gasto"];
const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Tarjeta", "Depósito", "Mercado Pago", "PayPal", "Plataforma digital", "Otro"];


const MYBUSINESS_QUEUE_KEY = "vip_my_business_finance_queue";
const LEGACY_MYBUSINESS_QUEUE_KEYS = ["vip_my_business_finance_queue_v167"]
const MYGOAL_ROUTE_QUEUE_KEY = "vip_my_goal_route_queue";
const LEGACY_MYGOAL_ROUTE_QUEUE_KEYS = ["vip_my_goal_route_queue_v195"];
const GOAL_PREFIX = "finance_goal:";

async function syncFromMyBusiness() {
  let queue = [], sourceKey = MYBUSINESS_QUEUE_KEY;
  try {
    let raw = localStorage.getItem(MYBUSINESS_QUEUE_KEY);
    if (!raw) {
      for (const key of LEGACY_MYBUSINESS_QUEUE_KEYS) {
        raw = localStorage.getItem(key);
        if (raw) { sourceKey = key; break; }
      }
    }
    queue = JSON.parse(raw || "[]");
    if (!Array.isArray(queue)) queue = [];
    if (sourceKey !== MYBUSINESS_QUEUE_KEY && queue.length) {
      localStorage.setItem(MYBUSINESS_QUEUE_KEY, JSON.stringify(queue));
      try { localStorage.removeItem(sourceKey); } catch {}
    }
  } catch { queue = []; }
  const legacyMemberId = context.codigo ? `vip-member:${String(context.codigo).trim().toUpperCase()}` : "";
  const mine = queue.filter((event) => event?.userId === context.userId || (legacyMemberId && event?.userId === legacyMemberId));
  if (!mine.length) return 0;
  const processed = new Set();
  for (const event of mine) {
    try {
      const data = event.data || {};
      if (event.type === "upsert_product" && data.id && data.name) {
        const id = `mybiz_prod_${data.id}`;
        const existing = await store.get("catalog", id);
        await store.put("catalog", {
          ...(existing || {}),
          id,
          kind: data.kind === "service" ? "service" : "product",
          name: data.name,
          category: data.category || existing?.category || "Mi Negocio MY",
          price: number(data.price),
          cost: number(data.cost),
          createdAt: existing?.createdAt || data.updatedAt || nowIso(),
          updatedAt: data.updatedAt || nowIso(),
          source: "my_business",
          sourceId: data.id,
        });
      }
      if (event.type === "upsert_order" && data.id) {
        const id = `mybiz_order_${data.id}`;
        const existing = await store.get("movements", id);
        const date = data.date || today();
        const profile = taxProfileForDate(settings, date);
        const payments = Array.isArray(data.payments) ? data.payments.map((p, i) => ({
          id: p.id || `${id}_pay_${i + 1}`,
          date: p.date || date,
          amount: number(p.amount),
          method: p.method || "Otro",
          createdAt: p.createdAt || data.updatedAt || nowIso(),
        })) : [];
        const names = Array.isArray(data.items) ? data.items.map((x) => x.concept).filter(Boolean) : [];
        await store.put("movements", {
          id,
          type: "income",
          date,
          concept: `Pedido ${data.number || "MY"}${names.length ? ` · ${names.slice(0, 3).join(", ")}` : ""}`,
          category: "Pedido personalizado",
          party: data.clientName || "",
          amount: number(data.total),
          paidAmount: number(data.paid),
          costAmount: number(data.cost),
          paymentMethod: payments.at(-1)?.method || existing?.paymentMethod || "Otro",
          catalogId: "",
          catalogName: "",
          notes: `Sincronizado desde Mi Negocio MY. Estado: ${data.status || "pending"}.${data.delivery ? ` Entrega: ${data.delivery}.` : ""}`,
          payments,
          taxProfile: existing?.taxProfile || profile,
          tax: existing?.tax || { includesVat:false, vatRate:0, vatBase:0, vatAmount:0, invoiceStatus:"none", withheldIsr:0, withheldVat:0 },
          createdAt: existing?.createdAt || data.updatedAt || nowIso(),
          updatedAt: data.updatedAt || nowIso(),
          source: "my_business",
          sourceId: data.id,
        });
      }
      processed.add(event.id);
    } catch (error) {
      console.warn("[MY] Evento de Mi Negocio no sincronizado", error);
    }
  }
  if (processed.size) {
    const remaining = queue.filter((event) => !processed.has(event.id));
    try { localStorage.setItem(MYBUSINESS_QUEUE_KEY, JSON.stringify(remaining)); } catch {}
  }
  return processed.size;
}

let store;
let settings;
let movements = [];
let catalog = [];
let goals = [];
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

async function loadData() {
  let meta = [];
  [movements, catalog, meta] = await Promise.all([
    store.getAll("movements"),
    store.getAll("catalog"),
    store.getAll("meta"),
  ]);
  movements.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  catalog.sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  goals = meta.filter((item) => item?.kind === "finance_goal" && String(item.id || "").startsWith(GOAL_PREFIX) && !item.deletedAt)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
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
          <span class="privacy-pill"><span aria-hidden="true">●</span> Privado por cuenta</span>
          <button class="button outline" data-action="theme"><span class="button-icon" aria-hidden="true">●</span><span>Color</span></button>
          <button class="button primary" data-action="backup"><span class="button-icon" aria-hidden="true">↓</span><span>Respaldo</span></button>
        </div>
      </div>
      <div class="finance-nav-wrap"><nav class="finance-nav" aria-label="Secciones de Finanzas">${NAV_ITEMS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`).join("")}</nav></div>
    </header>
    <main class="finance-main">
      <section class="privacy-banner ${shouldWarnBackup() ? "needs-backup" : ""}">
        <span class="banner-icon" aria-hidden="true">${shouldWarnBackup() ? "!" : "✓"}</span>
        <div><h2>${shouldWarnBackup() ? "Protege tu información con un respaldo" : "Tus datos permanecen privados"}</h2><p>Se guardan en tu espacio privado y se sincronizan de forma segura cuando hay conexión. El respaldo descargable sigue disponible como protección adicional. <b>${escapeHtml(backupAgeText())}.</b></p></div>
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
  return `${heading("Tu negocio en números", `Resumen de ${monthName(state.month)}`, "Lo esencial para saber cuánto vendiste, cuánto egresó y cuál fue tu utilidad.", `<div class="field"><label for="monthPicker">Cambiar mes</label><input id="monthPicker" data-change="month" type="month" value="${state.month}"></div>`)}
    <section class="grid metrics-grid">
      ${metric("$", "Cobrado", money(summary.income), "Dinero realmente recibido", "positive")}
      ${metric("−", "Egresos", money(summary.expenses), "Pagos del negocio", "negative")}
      ${metric("↘", "Costos de venta", money(summary.cost), "Costo de lo vendido", "negative")}
      ${metric("=", "Utilidad estimada", money(summary.profit), "Cobrado menos egresos y costos", summary.profit >= 0 ? "positive" : "negative")}
      ${metric("!", "Por cobrar", money(summary.pending), "Pendiente acumulado", summary.pending > 0 ? "warning" : "")}
    </section>
    <section class="quick-panel"><h3>¿Qué necesitas registrar?</h3><p>Elige una acción y guarda el movimiento en pocos pasos.</p><div class="quick-grid">
      <button class="quick-action" data-action="new-income"><span aria-hidden="true">＋</span><b>Registrar venta</b></button>
      <button class="quick-action" data-action="new-expense"><span aria-hidden="true">−</span><b>Registrar egreso</b></button>
      <button class="quick-action" data-action="new-catalog"><span aria-hidden="true">◇</span><b>Agregar producto o servicio</b></button>
      <button class="quick-action" data-tab="pending"><span aria-hidden="true">!</span><b>Ver pagos pendientes</b></button>
    </div></section>
    <div style="height:14px"></div>
    <section class="grid two-grid">
      <article class="card chart-card"><div class="section-title"><div><h3>Ingresos y salidas</h3><p>Comparación de los últimos seis meses</p></div><div class="chart-legend"><span><i class="legend-dot"></i>Cobrado</span><span><i class="legend-dot expense"></i>Egresos + costos</span></div></div><div class="bar-chart" role="img" aria-label="Comparación mensual de ingresos y gastos">${trend.map((item) => `<div class="bar-group"><div class="bar-stack"><span class="bar income" style="height:${Math.max(2, item.income / maximum * 100)}%" title="Cobrado ${money(item.income)}"></span><span class="bar expense" style="height:${Math.max(2, item.expense / maximum * 100)}%" title="Salidas ${money(item.expense)}"></span></div><span class="bar-label">${new Intl.DateTimeFormat("es-MX", { month: "short" }).format(new Date(`${item.month}-15T12:00:00`))}</span></div>`).join("")}</div></article>
      <article class="card"><div class="section-title"><div><h3>Lo más rentable</h3><p>Utilidad estimada del mes</p></div></div>${ranking.length ? `<div class="rank-list">${ranking.map((item) => `<div class="rank-row"><span class="rank-name">${escapeHtml(item.name)}</span><span class="rank-track"><span class="rank-fill" style="width:${Math.max(3, item.profit / Math.max(1, ranking[0].profit) * 100)}%"></span></span><span class="rank-value">${money(item.profit)}</span></div>`).join("")}</div>` : emptyState("Aún no hay ventas cobradas", "Cuando registres una venta, aquí verás qué te deja mayor utilidad.")}</article>
    </section>
    <div style="height:14px"></div>
    <section class="card table-card"><div style="padding:18px 18px 0" class="section-title"><div><h3>Movimientos recientes</h3><p>Lo último que registraste</p></div><button class="button small outline" data-tab="movements">Ver todos</button></div>${recent.length ? recordsTable(recent) : `<div style="padding:0 18px 18px">${emptyState("Tu historial está vacío", "Registra tu primera venta o egreso para comenzar.", "new-income", "Registrar mi primera venta")}</div>`}</section>`;
}

function recordRow(item) {
  const status = statusFor(item);
  const value = item.type === "income" ? item.amount : item.amount;
  return `<tr><td>${escapeHtml(readableDate(item.date))}</td><td><span class="status ${item.type === "income" ? "paid" : "pending"}">${item.type === "income" ? "Venta" : "Egreso"}</span></td><td><b>${escapeHtml(item.concept)}</b><br><small>${escapeHtml(item.category || "Sin categoría")}</small></td><td>${escapeHtml(item.party || "—")}</td><td><span class="status ${status}">${statusLabel(status)}</span></td><td class="amount ${item.type}">${item.type === "income" ? "+" : "−"}${money(value)}</td><td><div class="row-actions">${item.type === "income" && status !== "paid" ? `<button class="button small soft" data-action="add-payment" data-id="${item.id}">Cobrar</button>` : ""}<button class="button small outline" data-action="edit-movement" data-id="${item.id}">Editar</button></div></td></tr>`;
}

function mobileRecord(item) {
  const status = statusFor(item);
  return `<article class="mobile-record"><div class="mobile-record-top"><div><h3>${escapeHtml(item.concept)}</h3><p>${item.type === "income" ? "Venta" : "Egreso"} · ${escapeHtml(readableDate(item.date))}</p></div><b class="amount ${item.type}">${item.type === "income" ? "+" : "−"}${money(item.amount)}</b></div><div class="mobile-record-bottom"><span class="status ${status}">${statusLabel(status)}</span><div class="row-actions">${item.type === "income" && status !== "paid" ? `<button class="button small soft" data-action="add-payment" data-id="${item.id}">Cobrar</button>` : ""}<button class="button small outline" data-action="edit-movement" data-id="${item.id}">Editar</button></div></div></article>`;
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
  return `${heading("Historial organizado", "Ingresos y egresos", "Busca, filtra o corrige cualquier registro.", `<button class="button success" data-action="new-income">＋ Venta</button><button class="button danger" data-action="new-expense">− Egreso</button>`)}
    <section class="toolbar"><div class="field search-field"><label for="movementSearch">Buscar</label><input id="movementSearch" data-input="movement-search" value="${escapeHtml(state.movementSearch)}" placeholder="Producto, cliente, proveedor…"></div><div class="field"><label for="movementType">Tipo</label><select id="movementType" data-change="movement-type"><option value="all">Todos</option><option value="income" ${state.movementType === "income" ? "selected" : ""}>Ventas</option><option value="expense" ${state.movementType === "expense" ? "selected" : ""}>Egresos</option></select></div><div class="field"><label for="movementStatus">Estado</label><select id="movementStatus" data-change="movement-status"><option value="all">Todos</option><option value="paid" ${state.movementStatus === "paid" ? "selected" : ""}>Pagados</option><option value="partial" ${state.movementStatus === "partial" ? "selected" : ""}>Parciales</option><option value="pending" ${state.movementStatus === "pending" ? "selected" : ""}>Pendientes</option></select></div><button class="button outline" data-action="clear-filters">Limpiar</button></section>
    <section class="card table-card">${items.length ? recordsTable(items) : `<div style="padding:18px">${emptyState("No encontramos movimientos", "Prueba con otros filtros o registra un nuevo movimiento.", "new-income", "Registrar venta")}</div>`}</section>`;
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
  if (settings?.fiscalProfilePending || !(settings?.regimeHistory || []).length) {
    return `${heading("Perfil Fiscal", "Perfil Fiscal / SAT", "Puedes usar Ingresos, Egresos y Utilidad sin configurar esta parte todavía.", `<button class="button primary" data-action="change-regime">Configurar Perfil Fiscal</button>`)}<section class="card"><div class="section-title"><div><h3>Configuración pendiente</h3><p>Completa esta sección cuando tengas tu constancia o quieras organizar impuestos estimados.</p></div></div><div class="tax-note"><b>Importante:</b> MY no asigna un régimen por ti. Cuando lo configures, podrás conservar un historial por fecha sin borrar movimientos anteriores.</div></section>`;
  }
  const { from, to } = monthBounds();
  const tax = calculateTaxSummary(movements, settings, from, to);
  const profile = taxProfileForDate(settings, to);
  const regime = getRegime(profile.personType, profile.regimeId);
  const history = [...(settings.regimeHistory || [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return `${heading("Perfil Fiscal", "Perfil Fiscal / SAT", "Configura tu situación fiscal cuando estés lista. Conservamos el historial si cambias de régimen.", `<button class="button primary" data-action="change-regime">Cambiar o agregar régimen</button>`)}
    <section class="tax-hero"><div class="tax-hero-top"><div><h3>${escapeHtml(regime.shortLabel)}</h3><p>${escapeHtml(regime.description)} Periodicidad orientativa: ${escapeHtml(regime.frequency)}.</p></div><span class="tax-badge">${profile.personType === "individual" ? "Persona física" : "Persona moral"}</span></div><div class="tax-metrics"><div class="tax-metric"><span>Ingresos sin IVA</span><b>${money(tax.incomeBeforeVat)}</b></div><div class="tax-metric"><span>IVA por revisar</span><b>${money(tax.netVat)}</b></div><div class="tax-metric"><span>ISR estimado</span><b>${money(tax.netIsr)}</b></div><div class="tax-metric"><span>Apartado sugerido</span><b>${money(tax.totalReserve)}</b></div></div></section>
    <div class="tax-note"><b>Importante:</b> esta sección organiza tus datos y genera una estimación para apartar dinero; no sustituye la declaración del SAT ni la revisión de una contadora. Las obligaciones exactas dependen de tu constancia, actividad, deducciones, retenciones y situación particular.</div>
    <div style="height:14px"></div><section class="grid two-grid"><article class="card"><div class="section-title"><div><h3>Control del mes</h3><p>${escapeHtml(monthName(state.month))}</p></div></div><div class="rank-list"><div class="rank-row"><span class="rank-name">IVA trasladado</span><span class="rank-track"><span class="rank-fill" style="width:100%"></span></span><span class="rank-value">${money(tax.vatTransferred)}</span></div><div class="rank-row"><span class="rank-name">IVA acreditable</span><span class="rank-track"><span class="rank-fill" style="width:${Math.min(100, tax.vatCreditable / Math.max(1, tax.vatTransferred) * 100)}%"></span></span><span class="rank-value">${money(tax.vatCreditable)}</span></div><div class="rank-row"><span class="rank-name">ISR retenido</span><span class="rank-track"><span class="rank-fill" style="width:${Math.min(100, tax.withheldIsr / Math.max(1, tax.isrEstimate) * 100)}%"></span></span><span class="rank-value">${money(tax.withheldIsr)}</span></div><div class="rank-row"><span class="rank-name">Comprobantes pendientes</span><span class="rank-track"><span class="rank-fill" style="width:${Math.min(100, tax.invoicesMissing * 12)}%"></span></span><span class="rank-value">${tax.invoicesMissing}</span></div></div></article><article class="card"><div class="section-title"><div><h3>Historial de régimen</h3><p>Los movimientos conservan el régimen que les correspondía</p></div></div><div class="regime-history">${history.map((item) => { const itemRegime = getRegime(item.personType, item.regimeId); return `<div class="regime-row"><span class="regime-date">Desde<br>${escapeHtml(readableDate(item.effectiveFrom))}</span><div><b>${escapeHtml(itemRegime.shortLabel)}</b><span>${item.personType === "individual" ? "Persona física" : "Persona moral"} · ${escapeHtml(itemRegime.frequency)}</span></div>${item.id === profile.id ? '<span class="status paid">Actual</span>' : ""}</div>`; }).join("")}</div></article></section>
    <div style="height:14px"></div><section class="card"><div class="section-title"><div><h3>Fuentes oficiales y revisión</h3><p>Consulta siempre tu constancia y las reglas vigentes</p></div></div><div class="page-actions" style="justify-content:flex-start"><a class="button outline" target="_blank" rel="noopener" href="${SAT_REFERENCE_URLS.regimes}">Referencia oficial SAT</a><a class="button outline" target="_blank" rel="noopener" href="${regime.id === "resico_pf" ? SAT_REFERENCE_URLS.resicoPf : regime.id === "resico_pm" ? SAT_REFERENCE_URLS.resicoCorporate : SAT_REFERENCE_URLS.declarations}">Consultar obligación oficial</a></div></section>`;
}


function goalCatalogItems(goal) {
  const ids = new Set(Array.isArray(goal?.catalogIds) ? goal.catalogIds : []);
  const chosen = catalog.filter((item) => ids.has(item.id));
  return chosen.length ? chosen : catalog;
}

function goalResult(goal) {
  return solveGoal({ goal, items: goalCatalogItems(goal), movements });
}

function goalStatusText(result) {
  if (result.remaining <= 0) return "Meta alcanzada";
  if (!result.feasible) return `Con la capacidad registrada faltan ${money(result.shortfall)}`;
  return `Faltan ${money(result.remaining)}`;
}

function renderGoals() {
  const active = goals.filter((g) => g.status !== "closed");
  const cards = active.map((goal) => {
    const result = goalResult(goal);
    const label = goal.type === "profit" ? "utilidad" : "ventas";
    const plan = result.plan.length ? result.plan.map((x) => `<li><b>${x.units}</b> × ${escapeHtml(x.name)} <span>≈ ${money(x.contribution)}</span></li>`).join("") : "";
    return `<article class="card goal-card"><div class="goal-card-head"><div><span class="goal-kind">${goal.type === "profit" ? "UTILIDAD" : "VENTAS"}</span><h3>${money(goal.target)} de ${label}</h3><p>${escapeHtml(readableDate(goal.from))} → ${escapeHtml(readableDate(goal.to))}</p></div><div class="goal-progress-number">${result.progressPct.toFixed(0)}%</div></div><div class="goal-progress"><span style="width:${result.progressPct}%"></span></div><div class="goal-metrics"><div><span>Conseguido</span><b>${money(result.achieved)}</b></div><div><span>Falta</span><b>${money(result.remaining)}</b></div><div><span>Unidades</span><b>${result.units}</b></div><div><span>Por día</span><b>${result.dailyUnits}</b></div></div>${plan ? `<div class="goal-plan"><b>Combinación sugerida</b><ul>${plan}</ul></div>` : `<div class="goal-plan"><b>${result.remaining <= 0 ? "¡Meta alcanzada!" : "Agrega productos o servicios con precio y costo para calcular el plan."}</b></div>`}<div class="goal-note ${result.feasible ? "" : "warning"}">${escapeHtml(goalStatusText(result))}. Con una conversión de ${result.conversionRate.toFixed(0)}%, la referencia es contactar aproximadamente a <b>${result.contacts}</b> personas (${result.dailyContacts}/día).</div><div class="catalog-actions"><button class="button small soft" data-action="goal-to-route" data-id="${goal.id}">Enviar a Mi Ruta / Mi día</button><button class="button small outline" data-action="edit-goal" data-id="${goal.id}">Editar</button><button class="button small danger" data-action="delete-goal" data-id="${goal.id}">Eliminar</button></div></article>`;
  }).join("");
  return `${heading("De una cantidad a un plan", "🎯 Mi Meta", "Dime cuánto quieres vender o ganar y MY lo convierte en cantidades, capacidad y acciones.", `<button class="button primary" data-action="new-goal">＋ Crear meta</button>`)}<section class="goal-explainer"><b>Vender no es lo mismo que ganar.</b><span>Meta de ventas usa el precio de venta. Meta de utilidad usa precio menos costo y descuenta el resultado real ya acumulado del periodo.</span></section>${active.length ? `<section class="goal-grid">${cards}</section>` : emptyState("Aún no tienes una meta", "Crea una meta diaria, semanal, mensual o con fechas personalizadas y selecciona con qué productos o servicios quieres alcanzarla.", "new-goal", "Crear mi primera meta")}`;
}

function openGoalModal(id = "") {
  const goal = id ? goals.find((g) => g.id === id) : null;
  const from = goal?.from || today();
  const defaultTo = new Date(`${from}T12:00:00`); defaultTo.setDate(defaultTo.getDate() + 6);
  const to = goal?.to || defaultTo.toISOString().slice(0, 10);
  const selected = new Set(goal?.catalogIds || catalog.map((x) => x.id));
  const list = catalog.length ? `<div class="goal-choice-list">${catalog.map((item) => `<label class="goal-choice"><input type="checkbox" name="catalogIds" value="${item.id}" ${selected.has(item.id) ? "checked" : ""}><span><b>${escapeHtml(item.name)}</b><small>${item.kind === "service" ? "Servicio" : "Producto"} · Precio ${money(item.price)} · Costo ${money(item.cost)} · Utilidad ${money(number(item.price)-number(item.cost))}</small></span></label>`).join("")}</div>` : `<div class="backup-warning">Primero agrega al menos un producto o servicio con precio y costo. Mi Meta usa ese mismo catálogo; no crea otro.</div>`;
  openModal(goal ? "Editar Mi Meta" : "Crear Mi Meta", "La meta vive dentro de tu misma identidad financiera y se actualiza con tus movimientos.", `<form id="goalForm" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(goal?.id || "")}"><div class="field"><label for="goalType">¿Qué quieres conseguir?</label><select id="goalType" name="type"><option value="profit" ${goal?.type !== "sales" ? "selected" : ""}>Quiero ganar / utilidad</option><option value="sales" ${goal?.type === "sales" ? "selected" : ""}>Quiero vender / ingresos</option></select></div><div class="field"><label for="goalTarget">Cantidad objetivo</label><input id="goalTarget" name="target" type="number" min="0.01" step="0.01" required value="${escapeHtml(goal?.target ?? "")}" placeholder="Ej. 5000"></div><div class="field"><label for="goalFrom">Desde</label><input id="goalFrom" name="from" type="date" required value="${from}"></div><div class="field"><label for="goalTo">Hasta</label><input id="goalTo" name="to" type="date" required value="${to}"></div><div class="field full"><label for="goalConversion">¿De cada 100 personas a las que ofreces, cuántas suelen comprarte?</label><input id="goalConversion" name="conversionRate" type="number" min="1" max="100" step="1" value="${escapeHtml(goal?.conversionRate ?? 25)}"><small>Si todavía no lo sabes, 25% funciona solo como referencia inicial y puedes cambiarlo después.</small></div><div class="field full"><label>¿Con qué quieres conseguirlo?</label>${list}</div></form>`, `<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="save-goal" ${catalog.length ? "" : "disabled"}>Guardar meta</button>`);
}

async function saveGoalFromForm() {
  const form = document.getElementById("goalForm");
  if (!form?.reportValidity()) return;
  const data = new FormData(form);
  const from = String(data.get("from"));
  const to = String(data.get("to"));
  if (to < from) return toast("La fecha final no puede ser anterior a la inicial", "error");
  const catalogIds = data.getAll("catalogIds").map(String);
  if (!catalogIds.length) return toast("Selecciona al menos un producto o servicio", "error");
  const id = String(data.get("id") || "");
  const current = id ? goals.find((g) => g.id === id) : null;
  const goal = { ...(current || {}), id: id || `${GOAL_PREFIX}${uid("goal")}`, kind: "finance_goal", type: String(data.get("type")) === "sales" ? "sales" : "profit", target: number(data.get("target")), from, to, conversionRate: number(data.get("conversionRate") || 25), catalogIds, status: "active", createdAt: current?.createdAt || nowIso(), updatedAt: nowIso() };
  await store.put("meta", goal);
  await loadData();
  closeModal();
  state.tab = "goals";
  render();
  toast(current ? "Meta actualizada" : "Meta creada", "success");
}

async function sendGoalToRoute(id) {
  const goal = goals.find((g) => g.id === id);
  if (!goal) return;
  const result = goalResult(goal);
  const payload = {
    id: `goal_route_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    userId: context.userId,
    goalId: goal.id,
    createdAt: nowIso(),
    type: goal.type,
    target: goal.target,
    from: goal.from,
    to: goal.to,
    remaining: result.remaining,
    units: result.units,
    dailyUnits: result.dailyUnits,
    contacts: result.contacts,
    dailyContacts: result.dailyContacts,
    plan: result.plan.map((x) => ({ id: x.id, name: x.name, units: x.units, contribution: x.contribution })),
  };
  let queue = [];
  try {
    let raw = localStorage.getItem(MYGOAL_ROUTE_QUEUE_KEY), legacyKey = "";
    if (!raw) { for (const k of LEGACY_MYGOAL_ROUTE_QUEUE_KEYS) { raw = localStorage.getItem(k); if (raw) { legacyKey = k; break; } } }
    queue = JSON.parse(raw || "[]"); if (!Array.isArray(queue)) queue = [];
    if (legacyKey && queue.length) { localStorage.setItem(MYGOAL_ROUTE_QUEUE_KEY, JSON.stringify(queue)); try { localStorage.removeItem(legacyKey); } catch {} }
  } catch { queue = []; }
  queue = queue.filter((x) => x && x.userId === context.userId).slice(-9);
  queue.push(payload);
  try { localStorage.setItem(MYGOAL_ROUTE_QUEUE_KEY, JSON.stringify(queue)); } catch { return toast("El navegador no permitió preparar el plan para Mi Ruta", "error"); }
  try { window.dispatchEvent(new CustomEvent("my-finance-goal-plan", { detail: payload })); } catch {}
  toast("Plan preparado para Mi Ruta / Mi día en MY", "success");
}

function renderReports() {
  const report = buildReport({ movements, catalog, settings, from: state.reportFrom, to: state.reportTo });
  return `${heading("Descarga tus resultados", "Reportes de tu negocio", "Elige un periodo y guarda un documento PDF o Word generado en este dispositivo.")}
    <section class="report-options"><article class="card"><div class="section-title"><div><h3>Periodo del reporte</h3><p>Puede ser semanal, mensual o personalizado</p></div></div><div class="form-grid"><div class="field"><label for="reportFrom">Desde</label><input id="reportFrom" data-change="report-from" type="date" value="${state.reportFrom}"></div><div class="field"><label for="reportTo">Hasta</label><input id="reportTo" data-change="report-to" type="date" value="${state.reportTo}"></div></div><div class="report-buttons"><button class="button primary" data-action="export-pdf">Descargar PDF</button><button class="button outline" data-action="export-word">Descargar Word</button></div><div class="privacy-explainer"><span aria-hidden="true">✓</span><span>Los documentos se generan en tu dispositivo. Tus datos financieros se sincronizan de forma privada con tu identidad MY para conservar continuidad entre dispositivos; otras integrantes no pueden verlos.</span></div></article><article class="report-preview"><h3>${escapeHtml(settings.businessName || "Mi negocio")}</h3><p>${escapeHtml(readableDate(state.reportFrom))} al ${escapeHtml(readableDate(state.reportTo))}</p><div class="report-summary"><div><span>Ingresos</span><b>${money(report.summary.income)}</b></div><div><span>Egresos y costos</span><b>${money(report.summary.expense + report.summary.salesCost)}</b></div><div><span>Utilidad</span><b>${money(report.summary.profit)}</b></div><div><span>Por cobrar</span><b>${money(report.summary.pending)}</b></div></div><p style="font-size:11px;color:var(--muted);margin:13px 0 0">${report.summary.count} movimientos incluidos.</p></article></section>`;
}

function render() {
  if (!document.querySelector(".finance-shell")) root.innerHTML = shellHtml();
  const nav = document.querySelector(".finance-nav");
  if (nav) nav.innerHTML = NAV_ITEMS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`).join("");
  const views = { summary: renderSummary, movements: renderMovements, catalog: renderCatalog, pending: renderPending, taxes: renderTaxes, goals: renderGoals, reports: renderReports };
  document.getElementById("financeContent").innerHTML = (views[state.tab] || renderSummary)();
}

function regimeOptions(personType, selected) {
  return (TAX_REGIMES[personType] || []).map((regime) => `<label class="regime-option"><input type="radio" name="regimeId" value="${regime.id}" ${selected === regime.id ? "checked" : ""}><span><b>${escapeHtml(regime.label)}</b><span>${escapeHtml(regime.description)}</span></span></label>`).join("");
}

function renderWelcome() {
  root.className = "";
  root.innerHTML = `<section class="onboarding"><div class="onboarding-card"><span class="onboarding-logo" aria-hidden="true">MY</span><h1>¿Ya utilizaste Finanzas en otro dispositivo?</h1><p class="onboarding-lead">No encontramos información financiera local todavía. Primero intentaremos recuperar tu sincronización privada; si además tienes un respaldo cifrado, también puedes restaurarlo manualmente.</p><div class="choice-grid"><button class="choice-card primary" data-action="restore"><span aria-hidden="true">↥</span><h2>Restaurar mis datos</h2><p>Selecciona tu archivo <b>.myfinanzas</b> y escribe la contraseña que creaste.</p></button><button class="choice-card" data-action="start-setup"><span aria-hidden="true">＋</span><h2>Comenzar desde cero</h2><p>Elige esta opción si es la primera vez que utilizas Finanzas.</p></button></div><div class="privacy-explainer"><span aria-hidden="true">✓</span><span><b>Tu privacidad está protegida.</b> Tus ventas, egresos, utilidad y clientes pertenecen a tu identidad financiera privada. La sincronización usa tu cuenta validada y el respaldo sigue bajo tu control.</span></div></div></section>`;
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
    root.innerHTML = `<section class="onboarding"><div class="onboarding-card"><span class="onboarding-logo" aria-hidden="true">MY</span><div class="setup-step"><p class="eyebrow">Paso 1 de 2</p><h2>Cuéntanos sobre tu negocio</h2><p>Esto personaliza los campos y los reportes. Podrás modificarlo después.</p><form id="setupBusiness" class="form-grid"><div class="field full"><label for="setupBusinessName">Nombre del negocio</label><input id="setupBusinessName" name="businessName" required value="${escapeHtml(draft.businessName)}" placeholder="Ej. Creaciones Luna"></div><div class="field"><label for="setupBusinessType">¿Qué vendes?</label><select id="setupBusinessType" name="businessType"><option value="products">Productos</option><option value="services">Servicios</option><option value="both" ${draft.businessType === "both" ? "selected" : ""}>Productos y servicios</option></select></div><div class="field"><label for="setupCurrency">Moneda</label><select id="setupCurrency" name="currency"><option value="MXN">Peso mexicano (MXN)</option><option value="USD">Dólar (USD)</option><option value="CAD">Dólar canadiense (CAD)</option><option value="EUR">Euro (EUR)</option></select></div></form><div class="setup-actions"><button class="button outline" data-action="back-welcome">Atrás</button><button class="button primary" data-action="setup-tax">Continuar</button></div></div></div></section>`;
    root.dataset.setupDraft = JSON.stringify(draft);
    return;
  }
  root.innerHTML = `<section class="onboarding"><div class="onboarding-card"><span class="onboarding-logo" aria-hidden="true">MY</span><div class="setup-step"><p class="eyebrow">Paso 2 de 2</p><h2>Perfil Fiscal (opcional)</h2><p>Puedes configurarlo ahora o usar primero Ingresos, Egresos y Utilidad. Si después cambias de régimen, podrás agregar la nueva fecha sin borrar el historial.</p><div class="form-grid"><div class="field full"><label for="setupPersonType">Tipo de persona</label><select id="setupPersonType" data-change="setup-person-type"><option value="individual" ${draft.personType === "individual" ? "selected" : ""}>Persona física</option><option value="corporate" ${draft.personType === "corporate" ? "selected" : ""}>Persona moral</option></select></div><div class="field full"><label>Régimen fiscal</label><div id="setupRegimeOptions" class="regime-options">${regimeOptions(draft.personType, draft.regimeId)}</div></div><div class="field full"><label for="setupReserve">Porcentaje personal para apartar ISR cuando no exista cálculo automático</label><input id="setupReserve" type="number" min="0" max="100" step="0.1" value="${draft.manualIsrReservePercent}"><small>Es una provisión personalizable, no el cálculo oficial. Confírmala con tu contadora.</small></div></div><div class="setup-actions"><button class="button outline" data-action="setup-back">Atrás</button><button class="button soft" data-action="finish-setup-basic">Configurar después</button><button class="button primary" data-action="finish-setup">Guardar Perfil Fiscal</button></div></div></div></section>`;
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

function openMovementModal(type, id = "", catalogId = "") {
  const item = id ? movements.find((movement) => movement.id === id) : null;
  const kind = item?.type || type;
  const selectedCatalog = catalog.find((entry) => entry.id === (item?.catalogId || catalogId));
  const profile = item?.taxProfile || taxProfileForDate(settings, item?.date || today());
  const taxOptions = taxFieldsForRegime(profile.personType, profile.regimeId);
  const amount = item?.amount ?? selectedCatalog?.price ?? "";
  const cost = item?.costAmount ?? selectedCatalog?.cost ?? "";
  const paid = item?.paidAmount ?? (kind === "income" ? amount : amount);
  const totalIncludesVat = item?.tax?.includesVat !== false;
  const vatRate = item?.tax?.vatRate ?? 16;
  const categories = kind === "income" ? SALE_CATEGORIES : EXPENSE_CATEGORIES;
  const body = `<form id="movementForm" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(item?.id || "")}"><input type="hidden" name="type" value="${kind}"><div class="field"><label for="movementDate">Fecha</label><input id="movementDate" name="date" type="date" required value="${escapeHtml(item?.date || today())}"></div>${kind === "income" ? `<div class="field"><label for="movementPaidDate">Fecha del cobro</label><input id="movementPaidDate" name="paidDate" type="date" value="${escapeHtml(item?.payments?.[0]?.date || item?.date || today())}"></div><div class="field full"><label for="movementCatalog">Producto o servicio guardado</label><select id="movementCatalog" name="catalogId" data-change="movement-catalog">${catalogOptions(item?.catalogId || catalogId)}</select></div>` : ""}<div class="field full"><label for="movementConcept">${kind === "income" ? "¿Qué vendiste?" : "¿Qué pagaste?"}</label><input id="movementConcept" name="concept" required value="${escapeHtml(item?.concept || selectedCatalog?.name || "")}" placeholder="Describe el movimiento"></div><div class="field"><label for="movementCategory">Categoría</label><select id="movementCategory" name="category">${categories.map((category) => `<option ${item?.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></div><div class="field"><label for="movementParty">${kind === "income" ? "Cliente (opcional)" : "Proveedor (opcional)"}</label><input id="movementParty" name="party" value="${escapeHtml(item?.party || "")}"></div><div class="field"><label for="movementAmount">${kind === "income" ? "Total de la venta" : "Total del gasto"}</label><input id="movementAmount" name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(amount)}"></div>${kind === "income" ? `<div class="field"><label for="movementPaid">Cobrado hasta ahora</label><input id="movementPaid" name="paidAmount" type="number" min="0" step="0.01" value="${escapeHtml(paid)}"></div><div class="field"><label for="movementCost">Costo total de lo vendido</label><input id="movementCost" name="costAmount" type="number" min="0" step="0.01" value="${escapeHtml(cost)}"><small>Ayuda a calcular la ganancia real.</small></div>` : ""}<div class="field"><label for="movementMethod">Forma de pago</label><select id="movementMethod" name="paymentMethod">${PAYMENT_METHODS.map((method) => `<option ${item?.paymentMethod === method ? "selected" : ""}>${escapeHtml(method)}</option>`).join("")}</select></div><div class="form-section"><h4>Datos fiscales · ${escapeHtml(getRegime(profile.personType, profile.regimeId).shortLabel)}</h4><p>Se guardará el régimen correspondiente a la fecha del movimiento, aunque lo cambies después.</p></div><div class="field check full"><label><input name="includesVat" type="checkbox" ${totalIncludesVat ? "checked" : ""}> El importe capturado incluye IVA</label></div><div class="field"><label for="movementVatRate">Tasa de IVA</label><select id="movementVatRate" name="vatRate"><option value="16" ${vatRate === 16 ? "selected" : ""}>16%</option><option value="8" ${vatRate === 8 ? "selected" : ""}>8%</option><option value="0" ${vatRate === 0 ? "selected" : ""}>0%</option><option value="exempt" ${vatRate === "exempt" ? "selected" : ""}>Exento</option></select></div><div class="field"><label for="movementInvoice">Comprobante</label><select id="movementInvoice" name="invoiceStatus"><option value="none" ${item?.tax?.invoiceStatus === "none" ? "selected" : ""}>No aplica / sin factura</option><option value="pending" ${item?.tax?.invoiceStatus === "pending" ? "selected" : ""}>Pendiente</option><option value="issued" ${["issued", "received"].includes(item?.tax?.invoiceStatus) ? "selected" : ""}>${kind === "income" ? "Factura emitida" : "Factura recibida"}</option><option value="global" ${item?.tax?.invoiceStatus === "global" ? "selected" : ""}>Factura global</option></select></div>${taxOptions.showWithholdings && kind === "income" ? `<div class="field"><label for="movementWithheldIsr">ISR retenido</label><input id="movementWithheldIsr" name="withheldIsr" type="number" min="0" step="0.01" value="${escapeHtml(item?.tax?.withheldIsr || 0)}"></div><div class="field"><label for="movementWithheldVat">IVA retenido</label><input id="movementWithheldVat" name="withheldVat" type="number" min="0" step="0.01" value="${escapeHtml(item?.tax?.withheldVat || 0)}"></div>` : ""}${taxOptions.showPlatformFields && kind === "income" ? `<div class="field"><label for="movementPlatformFee">Comisión de plataforma</label><input id="movementPlatformFee" name="platformFee" type="number" min="0" step="0.01" value="${escapeHtml(item?.tax?.platformFee || 0)}"></div>` : ""}${kind === "expense" ? `<div class="field check"><label><input name="deductible" type="checkbox" ${item?.tax?.deductible !== false ? "checked" : ""}> Considerar como gasto del negocio para revisión</label></div><div class="field check"><label><input name="vatCreditable" type="checkbox" ${item?.tax?.vatCreditable !== false ? "checked" : ""}> Considerar el IVA para revisión</label></div>` : ""}<div class="field full"><label for="movementNotes">Notas (opcional)</label><textarea id="movementNotes" name="notes">${escapeHtml(item?.notes || "")}</textarea></div></form>`;
  openModal(item ? "Editar movimiento" : kind === "income" ? "Registrar venta" : "Registrar egreso", "Los datos se guardan localmente y se sincronizan de forma privada con tu identidad financiera cuando hay conexión.", body, `${item ? '<button class="button danger" data-action="delete-movement" data-id="' + item.id + '">Eliminar</button>' : ""}<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="save-movement">Guardar</button>`);
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
  openModal(item ? "Editar producto o servicio" : "Agregar producto o servicio", "Estos datos alimentan Finanzas y Mi Meta sin crear un sistema paralelo.", `<form id="catalogForm" class="form-grid"><input type="hidden" name="id" value="${escapeHtml(item?.id || "")}"><div class="field"><label for="catalogKind">Tipo</label><select id="catalogKind" name="kind"><option value="product" ${item?.kind === "product" ? "selected" : ""}>Producto</option><option value="service" ${item?.kind === "service" ? "selected" : ""}>Servicio</option></select></div><div class="field"><label for="catalogCategory">Categoría</label><input id="catalogCategory" name="category" value="${escapeHtml(item?.category || "")}" placeholder="Ej. Sublimación"></div><div class="field full"><label for="catalogName">Nombre</label><input id="catalogName" name="name" required value="${escapeHtml(item?.name || "")}" placeholder="Ej. Taza personalizada"></div><div class="field"><label for="catalogPrice">Precio de venta</label><input id="catalogPrice" name="price" type="number" min="0" step="0.01" required value="${escapeHtml(item?.price ?? "")}"></div><div class="field"><label for="catalogCost">Costo aproximado</label><input id="catalogCost" name="cost" type="number" min="0" step="0.01" value="${escapeHtml(item?.cost ?? "")}"><small>Incluye materiales y otros costos directos.</small></div><div class="field"><label for="catalogDailyCapacity">Capacidad máxima por día (opcional)</label><input id="catalogDailyCapacity" name="dailyCapacity" type="number" min="0" step="1" value="${escapeHtml(item?.dailyCapacity ?? "")}" placeholder="Ej. 8"></div><div class="field"><label for="catalogInventory">Inventario disponible (opcional)</label><input id="catalogInventory" name="inventoryAvailable" type="number" min="0" step="1" value="${escapeHtml(item?.inventoryAvailable ?? "")}" placeholder="Ej. 25"></div><div class="field"><label for="catalogServiceMinutes">Minutos por servicio (opcional)</label><input id="catalogServiceMinutes" name="serviceMinutes" type="number" min="0" step="5" value="${escapeHtml(item?.serviceMinutes ?? "")}" placeholder="Ej. 60"></div><div class="field"><label for="catalogHoursDaily">Horas disponibles al día (opcional)</label><input id="catalogHoursDaily" name="hoursAvailableDaily" type="number" min="0" step="0.5" value="${escapeHtml(item?.hoursAvailableDaily ?? "")}" placeholder="Ej. 6"></div></form>`, `${item ? `<button class="button danger" data-action="delete-catalog" data-id="${item.id}">Eliminar</button>` : ""}<button class="button outline" data-action="close-modal">Cancelar</button><button class="button primary" data-action="save-catalog">Guardar</button>`);
}

async function saveCatalogFromForm() {
  const form = document.getElementById("catalogForm");
  if (!form?.reportValidity()) return;
  const data = new FormData(form);
  const id = String(data.get("id") || "");
  const current = id ? catalog.find((item) => item.id === id) : null;
  const item = { ...(current || {}), id: id || uid("cat"), kind: String(data.get("kind")), category: String(data.get("category") || "").trim(), name: String(data.get("name") || "").trim(), price: number(data.get("price")), cost: number(data.get("cost")), dailyCapacity: data.get("dailyCapacity") === "" ? "" : number(data.get("dailyCapacity")), inventoryAvailable: data.get("inventoryAvailable") === "" ? "" : number(data.get("inventoryAvailable")), serviceMinutes: data.get("serviceMinutes") === "" ? "" : number(data.get("serviceMinutes")), hoursAvailableDaily: data.get("hoursAvailableDaily") === "" ? "" : number(data.get("hoursAvailableDaily")), createdAt: current?.createdAt || nowIso(), updatedAt: nowIso() };
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
  await saveSettings({ personType, regimeId, manualIsrReservePercent: nextProfile.manualIsrReservePercent, regimeHistory: history, fiscalProfilePending: false });
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


async function finishSetupBasic() {
  const draft = JSON.parse(root.dataset.setupDraft || "{}");
  const created = nowIso();
  settings = {
    id: "current",
    businessName: draft.businessName,
    businessType: draft.businessType,
    currency: draft.currency,
    personType: "individual",
    regimeId: "other_pf",
    manualIsrReservePercent: 0,
    regimeHistory: [],
    fiscalProfilePending: true,
    themeId: "purple",
    accent: THEMES[0].accent, accent2: THEMES[0].accent2, accentSoft: THEMES[0].soft, accentSofter: THEMES[0].softer, accentInk: THEMES[0].ink,
    createdAt: created, updatedAt: created,
  };
  await store.put("settings", settings);
  await loadData();
  applyTheme(settings);
  root.innerHTML = shellHtml();
  render();
  toast("Dashboard creado. Puedes completar tu Perfil Fiscal cuando quieras.", "success");
}

async function seedDemo() {
  const date = new Date();
  const month = date.toISOString().slice(0, 7);
  const d = (day, offset = 0) => `${addMonths(month, offset)}-${String(day).padStart(2, "0")}`;
  const created = nowIso();
  const profile = { id: "regime_demo", effectiveFrom: `${date.getFullYear()}-01-01`, personType: "individual", regimeId: "resico_pf", manualIsrReservePercent: 10, createdAt: created };
  settings = { id: "current", businessName: "Creaciones Luna", businessType: "both", currency: "MXN", personType: "individual", regimeId: "resico_pf", manualIsrReservePercent: 10, regimeHistory: [profile], themeId: "purple", accent: THEMES[0].accent, accent2: THEMES[0].accent2, accentSoft: THEMES[0].soft, accentSofter: THEMES[0].softer, accentInk: THEMES[0].ink, createdAt: created, updatedAt: created };
  const products = [
    { id: "cat_demo_1", kind: "product", name: "Taza personalizada", category: "Sublimación", price: 180, cost: 72, createdAt: created, updatedAt: created },
    { id: "cat_demo_2", kind: "product", name: "Playera estampada", category: "Textil", price: 280, cost: 125, createdAt: created, updatedAt: created },
    { id: "cat_demo_3", kind: "service", name: "Diseño personalizado", category: "Diseño", price: 350, cost: 40, createdAt: created, updatedAt: created },
  ];
  const sales = [
    ["mov_demo_1", d(3), "Taza personalizada", "Ana", 360, 360, 144, "cat_demo_1"],
    ["mov_demo_2", d(7), "Playera estampada", "Laura", 560, 300, 250, "cat_demo_2"],
    ["mov_demo_3", d(11), "Diseño personalizado", "Café Nube", 350, 350, 40, "cat_demo_3"],
  ].map(([id, dateValue, concept, party, amount, paidAmount, costAmount, catalogId]) => { const taxParts = calculateTaxParts(amount, true, 16); return { id, type: "income", date: dateValue, concept, category: "Producto", party, amount, paidAmount, costAmount, paymentMethod: "Transferencia", catalogId, catalogName: concept, notes: "", payments: paidAmount ? [{ id: `${id}_pay`, date: dateValue, amount: paidAmount, method: "Transferencia", createdAt: created }] : [], taxProfile: profile, tax: { includesVat: true, vatRate: 16, ...taxParts, invoiceStatus: "none", withheldIsr: 0, withheldVat: 0 }, createdAt: created, updatedAt: created }; });
  const expenses = [
    ["mov_demo_4", d(5), "Material para pedidos", "Proveedor local", 480, "Materiales"],
    ["mov_demo_5", d(9), "Publicidad de la semana", "Meta", 300, "Publicidad"],
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
  else if (action === "finish-setup-basic") await finishSetupBasic();
  else if (action === "new-income") openMovementModal("income");
  else if (action === "new-expense") openMovementModal("expense");
  else if (action === "edit-movement") openMovementModal("income", target.dataset.id);
  else if (action === "new-catalog") openCatalogModal();
  else if (action === "edit-catalog") openCatalogModal(target.dataset.id);
  else if (action === "sell-catalog") openMovementModal("income", "", target.dataset.id);
  else if (action === "save-movement") await saveMovementFromForm();
  else if (action === "save-catalog") await saveCatalogFromForm();
  else if (action === "add-payment") openPaymentModal(target.dataset.id);
  else if (action === "save-payment") await savePaymentFromForm();
  else if (action === "change-regime") openRegimeModal();
  else if (action === "new-goal") openGoalModal();
  else if (action === "edit-goal") openGoalModal(target.dataset.id);
  else if (action === "save-goal") await saveGoalFromForm();
  else if (action === "goal-to-route") await sendGoalToRoute(target.dataset.id);
  else if (action === "delete-goal") { if (confirm("¿Eliminar esta meta? Tus movimientos financieros no se modificarán.")) { await store.remove("meta", target.dataset.id); await loadData(); render(); toast("Meta eliminada"); } }
  else if (action === "save-regime") await saveRegimeFromForm();
  else if (action === "create-backup") await createBackupFromForm();
  else if (action === "open-backup") await decryptRestore();
  else if (action === "restore-replace") await restoreData("replace");
  else if (action === "restore-merge") await restoreData("merge");
  else if (action === "clear-filters") { state.movementType = "all"; state.movementStatus = "all"; state.movementSearch = ""; render(); }
  else if (action === "apply-theme") {
    const theme = THEMES.find((item) => item.id === target.dataset.theme);
    if (theme) { await saveSettings({ themeId: theme.id, accent: theme.accent, accent2: theme.accent2, accentSoft: theme.soft, accentSofter: theme.softer, accentInk: theme.ink }); closeModal(); root.innerHTML = shellHtml(); render(); toast("Color actualizado", "success"); }
  } else if (action === "save-custom-theme") {
    const accent = document.getElementById("customAccent")?.value;
    if (accent) { await saveSettings({ themeId: "custom", accent, accent2: accent, accentSoft: `color-mix(in srgb, ${accent} 12%, white)`, accentSofter: `color-mix(in srgb, ${accent} 4%, white)`, accentInk: accent }); closeModal(); root.innerHTML = shellHtml(); render(); toast("Color personalizado guardado", "success"); }
  } else if (action === "delete-movement") {
    if (confirm("¿Eliminar este movimiento? Esta acción elimina el movimiento de tu identidad financiera y se sincronizará en tus dispositivos cuando haya conexión.")) { await store.remove("movements", target.dataset.id); await loadData(); closeModal(); render(); toast("Movimiento eliminado"); }
  } else if (action === "delete-catalog") {
    if (confirm("¿Eliminar este producto o servicio del catálogo? Las ventas anteriores se conservarán.")) { await store.remove("catalog", target.dataset.id); await loadData(); closeModal(); render(); toast("Elemento eliminado"); }
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
    const syncedFromMyBusiness = await syncFromMyBusiness();
    await loadData();
    applyTheme(settings);
    root.className = "";
    root.innerHTML = shellHtml();
    render();
    if (syncedFromMyBusiness) toast(`${syncedFromMyBusiness} cambio${syncedFromMyBusiness === 1 ? "" : "s"} de Mi Negocio sincronizado${syncedFromMyBusiness === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    root.innerHTML = `<div class="finance-loading"><div class="loading-card"><span class="loading-mark">!</span><h1>No pudimos abrir Finanzas</h1><p>${error.message === "MISSING_USER_ID" ? "La Plataforma VIP debe identificar primero la cuenta que inició sesión." : "Actualiza la página o revisa que tu navegador permita guardar datos en este dispositivo."}</p></div></div>`;
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
    goals = [];
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
    goals = [];
    closeModal();
    root.className = "finance-loading";
    root.innerHTML = '<div class="loading-card"><span class="loading-mark">MY</span><h1>Finanzas protegidas</h1><p>Inicia sesión nuevamente para abrir este espacio.</p></div>';
  },
};
boot();
