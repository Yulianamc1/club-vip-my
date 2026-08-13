export const TAX_REGIMES = {
  individual: [
    {
      id: "resico_pf",
      label: "Régimen Simplificado de Confianza (RESICO)",
      shortLabel: "RESICO · Persona física",
      description: "Para actividades empresariales, servicios profesionales o arrendamiento que cumplan los requisitos del SAT.",
      frequency: "Mensual",
      cashBasis: true,
      autoEstimate: "resico",
    },
    {
      id: "business_professional_pf",
      label: "Actividades Empresariales y Servicios Profesionales",
      shortLabel: "Actividad empresarial / profesional",
      description: "Para negocios, oficios y honorarios fuera de RESICO.",
      frequency: "Mensual",
      cashBasis: true,
      autoEstimate: "manual",
    },
    {
      id: "platforms_pf",
      label: "Ingresos mediante Plataformas Tecnológicas",
      shortLabel: "Plataformas tecnológicas",
      description: "Para ventas o servicios cobrados mediante plataformas digitales; permite registrar retenciones de la plataforma.",
      frequency: "Mensual",
      cashBasis: true,
      autoEstimate: "withholdings",
    },
    {
      id: "rent_pf",
      label: "Arrendamiento de bienes inmuebles",
      shortLabel: "Arrendamiento",
      description: "Para ingresos por renta o uso temporal de inmuebles.",
      frequency: "Mensual o trimestral según el caso",
      cashBasis: true,
      autoEstimate: "manual",
    },
    {
      id: "rif_pf",
      label: "Régimen de Incorporación Fiscal (RIF)",
      shortLabel: "RIF · Continuidad",
      description: "Solo para quienes permanecen válidamente en este régimen de transición.",
      frequency: "Bimestral",
      cashBasis: true,
      autoEstimate: "manual",
    },
    {
      id: "other_pf",
      label: "Otro régimen o aún no estoy segura",
      shortLabel: "Otro régimen · Persona física",
      description: "Conserva el organizador fiscal y permite configurar un porcentaje de apartado con tu contadora.",
      frequency: "Según constancia fiscal",
      cashBasis: true,
      autoEstimate: "manual",
    },
  ],
  corporate: [
    {
      id: "resico_pm",
      label: "Régimen Simplificado de Confianza (RESICO)",
      shortLabel: "RESICO · Persona moral",
      description: "Para empresas que cumplan los requisitos y límites vigentes del SAT.",
      frequency: "Mensual",
      cashBasis: true,
      autoEstimate: "manual",
    },
    {
      id: "general_pm",
      label: "Régimen General de Ley",
      shortLabel: "Régimen General · Persona moral",
      description: "Para sociedades y empresas que tributan en el régimen general.",
      frequency: "Mensual",
      cashBasis: false,
      autoEstimate: "manual",
    },
    {
      id: "nonprofit_pm",
      label: "Personas Morales con Fines no Lucrativos",
      shortLabel: "Sin fines de lucro",
      description: "Organiza ingresos, egresos, comprobantes y retenciones sin estimar automáticamente el ISR.",
      frequency: "Según obligaciones",
      cashBasis: false,
      autoEstimate: "none",
    },
    {
      id: "agape_pm",
      label: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
      shortLabel: "Actividades primarias",
      description: "Para personas morales dedicadas a actividades primarias bajo las reglas aplicables.",
      frequency: "Según obligaciones",
      cashBasis: false,
      autoEstimate: "manual",
    },
    {
      id: "other_pm",
      label: "Otro régimen o aún no estoy segura",
      shortLabel: "Otro régimen · Persona moral",
      description: "Conserva el control de facturas, IVA y retenciones hasta configurar el régimen correcto.",
      frequency: "Según constancia fiscal",
      cashBasis: false,
      autoEstimate: "manual",
    },
  ],
};

export const SAT_REFERENCE_URLS = {
  regimes: "https://www.cloudb.sat.gob.mx/datos_fiscales/regimen",
  resicoPf: "https://www.sat.gob.mx/portal/public/personas-fisicas/pf-simplificado-de-confianza",
  businessPf: "https://www.sat.gob.mx/portal/public/personas-fisicas/pf-actividades-empresariales-y-profesionales",
  platforms: "https://wwwmatnp.sat.gob.mx/declaracion/87655/presenta-tu-declaracion-de-pagos-",
  declarations: "https://www.sat.gob.mx/portal/public/tramites/declaraciones-pf",
};

export function getRegime(personType, regimeId) {
  const list = TAX_REGIMES[personType] || [];
  return list.find((item) => item.id === regimeId) || list.at(-1) || TAX_REGIMES.individual.at(-1);
}

export function taxProfileForDate(settings, date) {
  const history = [...(settings.regimeHistory || [])].sort((a, b) =>
    String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)),
  );
  const applicable = history.filter((item) => item.effectiveFrom <= date).at(-1);
  return applicable || history[0] || {
    id: "default-profile",
    effectiveFrom: "2000-01-01",
    personType: settings.personType || "individual",
    regimeId: settings.regimeId || "other_pf",
    manualIsrReservePercent: Number(settings.manualIsrReservePercent || 10),
  };
}

export function resicoPhysicalRate(monthlyIncomeBeforeVat) {
  const income = Math.max(0, Number(monthlyIncomeBeforeVat) || 0);
  if (income <= 25000) return 1;
  if (income <= 50000) return 1.1;
  if (income <= 83333.33) return 1.5;
  if (income <= 208333.33) return 2;
  return 2.5;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function calculateTaxSummary(movements, settings, from, to) {
  const included = movements.filter((item) => !item.deletedAt);
  let incomeBeforeVat = 0;
  let deductibleExpenses = 0;
  let vatTransferred = 0;
  let vatCreditable = 0;
  let withheldIsr = 0;
  let withheldVat = 0;
  let invoicesMissing = 0;
  const monthlyResico = new Map();
  const manualBases = new Map();
  const regimes = new Map();

  for (const item of included) {
    const profile = item.taxProfile || taxProfileForDate(settings, item.date);
    const regime = getRegime(profile.personType, profile.regimeId);
    regimes.set(regime.id, regime.shortLabel);
    const tax = item.tax || {};
    if (item.type === "income") {
      const payments = Array.isArray(item.payments) && item.payments.length
        ? item.payments.filter((payment) => payment.date >= from && payment.date <= to)
        : item.date >= from && item.date <= to && number(item.paidAmount) > 0
          ? [{ date: item.date, amount: item.paidAmount }]
          : [];
      if (payments.length && tax.invoiceStatus === "pending") invoicesMissing += 1;
      for (const payment of payments) {
        const ratio = number(item.amount) > 0
          ? Math.min(1, Math.max(0, number(payment.amount) / number(item.amount)))
          : 0;
        const subtotal = number(tax.subtotal || item.amount) * ratio;
        const vat = number(tax.vat) * ratio;
        incomeBeforeVat += subtotal;
        vatTransferred += vat;
        withheldIsr += number(tax.withheldIsr) * ratio;
        withheldVat += number(tax.withheldVat) * ratio;
        const month = payment.date.slice(0, 7);
        if (regime.autoEstimate === "resico") {
          monthlyResico.set(month, number(monthlyResico.get(month)) + subtotal);
        } else if (regime.autoEstimate === "manual") {
          const key = `${profile.id || regime.id}:${Number(profile.manualIsrReservePercent || 10)}`;
          const current = manualBases.get(key) || {
            base: 0,
            percent: Number(profile.manualIsrReservePercent || 10),
            label: regime.shortLabel,
          };
          current.base += subtotal;
          manualBases.set(key, current);
        }
      }
    } else if (item.date >= from && item.date <= to) {
      if (tax.deductible !== false) deductibleExpenses += number(tax.subtotal || item.amount);
      if (tax.vatCreditable !== false) vatCreditable += number(tax.vat);
      if (tax.invoiceStatus === "pending") invoicesMissing += 1;
    }
  }

  let isrEstimate = 0;
  const estimateDetails = [];
  for (const [month, base] of monthlyResico.entries()) {
    const rate = resicoPhysicalRate(base);
    const amount = base * rate / 100;
    isrEstimate += amount;
    estimateDetails.push({ label: `RESICO ${month}`, base, rate, amount });
  }
  for (const item of manualBases.values()) {
    const base = Math.max(0, item.base - deductibleExpenses);
    const amount = base * item.percent / 100;
    isrEstimate += amount;
    estimateDetails.push({ label: `${item.label} · apartado personalizado`, base, rate: item.percent, amount });
  }

  const netIsr = Math.max(0, isrEstimate - withheldIsr);
  const netVat = vatTransferred - vatCreditable - withheldVat;
  const totalReserve = Math.max(0, netIsr) + Math.max(0, netVat);
  return {
    incomeBeforeVat,
    deductibleExpenses,
    vatTransferred,
    vatCreditable,
    withheldIsr,
    withheldVat,
    isrEstimate,
    netIsr,
    netVat,
    totalReserve,
    invoicesMissing,
    regimes: [...regimes.values()],
    estimateDetails,
  };
}

export function taxFieldsForRegime(personType, regimeId) {
  const regime = getRegime(personType, regimeId);
  return {
    showPlatformFields: regime.id === "platforms_pf",
    showWithholdings: ["platforms_pf", "business_professional_pf", "resico_pf", "rent_pf"].includes(regime.id),
    showInvoice: true,
    frequency: regime.frequency,
    cashBasis: regime.cashBasis,
  };
}
