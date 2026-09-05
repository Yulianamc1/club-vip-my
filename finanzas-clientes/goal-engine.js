export const GOAL_ENGINE_VERSION = "2026-09-03-v196";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function inclusiveDays(from, to) {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

export function itemUnitValue(item, goalType) {
  const price = Math.max(0, num(item.price));
  const cost = Math.max(0, num(item.cost));
  return goalType === "profit" ? Math.max(0, price - cost) : price;
}

export function itemPeriodCapacity(item, days) {
  const periodDays = Math.max(0, Math.floor(num(days)));
  if (!periodDays) return 0;
  let capacity = Number.POSITIVE_INFINITY;

  const inventory = item.inventoryAvailable;
  if (inventory !== "" && inventory !== null && inventory !== undefined && Number.isFinite(Number(inventory))) {
    capacity = Math.min(capacity, Math.max(0, Math.floor(num(inventory))));
  }

  const daily = item.dailyCapacity;
  if (daily !== "" && daily !== null && daily !== undefined && Number.isFinite(Number(daily))) {
    capacity = Math.min(capacity, Math.max(0, Math.floor(num(daily))) * periodDays);
  }

  if (item.kind === "service") {
    const minutes = Math.max(0, num(item.serviceMinutes));
    const hours = Math.max(0, num(item.hoursAvailableDaily));
    if (minutes > 0 && hours > 0) {
      const perDay = Math.floor((hours * 60) / minutes);
      capacity = Math.min(capacity, Math.max(0, perDay) * periodDays);
    }
  }

  return Number.isFinite(capacity) ? capacity : Number.MAX_SAFE_INTEGER;
}

export function movementProgress(movements, goal) {
  const from = goal.from;
  const to = goal.to;
  const active = (movements || []).filter((m) => !m?.deletedAt);
  if (goal.type === "sales") {
    return active
      .filter((m) => m.type === "income" && m.date >= from && m.date <= to)
      .reduce((sum, m) => sum + Math.max(0, num(m.amount)), 0);
  }

  let collected = 0;
  let costs = 0;
  for (const m of active.filter((x) => x.type === "income")) {
    let paid = 0;
    if (Array.isArray(m.payments) && m.payments.length) {
      paid = m.payments
        .filter((p) => p.date >= from && p.date <= to)
        .reduce((sum, p) => sum + Math.max(0, num(p.amount)), 0);
    } else if (m.date >= from && m.date <= to) {
      paid = Math.max(0, num(m.paidAmount));
    }
    collected += paid;
    const total = Math.max(0, num(m.amount));
    const ratio = total > 0 ? Math.min(1, paid / total) : 0;
    costs += Math.max(0, num(m.costAmount)) * ratio;
  }
  const expenses = active
    .filter((m) => m.type === "expense" && m.date >= from && m.date <= to)
    .reduce((sum, m) => sum + Math.max(0, num(m.amount)), 0);
  return collected - costs - expenses;
}

export function solveGoal({ goal, items, movements = [] }) {
  const days = inclusiveDays(goal.from, goal.to);
  const target = Math.max(0, num(goal.target));
  const achieved = movementProgress(movements, goal);
  const remaining = Math.max(0, target - achieved);
  const conversionRate = clamp(num(goal.conversionRate || 25), 1, 100) / 100;

  const prepared = (items || [])
    .map((item) => {
      const unitValue = itemUnitValue(item, goal.type);
      const capacity = itemPeriodCapacity(item, days);
      return { ...item, unitValue, capacity };
    })
    .filter((item) => item.unitValue > 0 && item.capacity > 0)
    .sort((a, b) => b.unitValue - a.unitValue || String(a.name).localeCompare(String(b.name), "es"));

  let need = remaining;
  const plan = [];
  for (const item of prepared) {
    if (need <= 0) break;
    const units = Math.min(item.capacity, Math.ceil(need / item.unitValue));
    if (units <= 0) continue;
    const contribution = units * item.unitValue;
    plan.push({
      id: item.id,
      name: item.name,
      kind: item.kind,
      units,
      unitValue: item.unitValue,
      contribution,
      capacity: item.capacity,
    });
    need = Math.max(0, need - contribution);
  }

  const projected = plan.reduce((sum, x) => sum + x.contribution, 0);
  const units = plan.reduce((sum, x) => sum + x.units, 0);
  const dailyUnits = days > 0 ? Math.ceil(units / days) : units;
  const contacts = units > 0 ? Math.ceil(units / conversionRate) : 0;
  const dailyContacts = days > 0 ? Math.ceil(contacts / days) : contacts;
  const progressPct = target > 0 ? clamp((achieved / target) * 100, 0, 100) : 0;

  return {
    version: GOAL_ENGINE_VERSION,
    days,
    target,
    achieved,
    remaining,
    progressPct,
    projected,
    shortfall: Math.max(0, remaining - projected),
    units,
    dailyUnits,
    contacts,
    dailyContacts,
    conversionRate: conversionRate * 100,
    feasible: remaining === 0 || projected >= remaining,
    plan,
  };
}
