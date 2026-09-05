import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { WebhookSignatureValidator } from "npm:mercadopago@3.6.0";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
function env(name: string) { return (Deno.env.get(name) || "").trim(); }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function retryable(status: number) { return status === 429 || [500, 502, 503, 504].includes(status); }
function retryDelay(res: Response, attempt: number) {
  const raw = Number(res.headers.get("retry-after") || "0");
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw * 1000, 6000);
  return Math.min(350 * (2 ** attempt), 3000);
}

async function rpc(name: string, body: Record<string, unknown>) {
  const url = env("SUPABASE_URL"), service = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) throw new Error("SUPABASE_SERVER_CONFIG_MISSING");
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`RPC_${name}_${res.status}`);
  return data;
}

async function mpGet(path: string) {
  const token = env("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN_MISSING");
  let last = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.mercadopago.com${path}`, { headers: { authorization: `Bearer ${token}` } });
    last = res.status;
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (res.ok) return data;
    if (!retryable(res.status) || attempt === 2) throw new Error(`MP_GET_${res.status}_${path}`);
    await sleep(retryDelay(res, attempt));
  }
  throw new Error(`MP_GET_${last}_${path}`);
}

// PUT status=cancelled is state-setting/idempotent; retry only transient failures.
async function mpCancelSubscription(preapprovalId: string) {
  const token = env("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN_MISSING");
  const path = `/preapproval/${encodeURIComponent(preapprovalId)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.mercadopago.com${path}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (res.ok) return true;
    if (!retryable(res.status) || attempt === 2) throw new Error(`MP_CANCEL_${res.status}`);
    await sleep(retryDelay(res, attempt));
  }
  return false;
}

function assertCollector(obj: any) {
  const expected = env("MERCADOPAGO_EXPECTED_COLLECTOR_ID");
  if (!expected) throw new Error("MERCADOPAGO_EXPECTED_COLLECTOR_ID_MISSING");
  const actual = String(obj?.collector_id || "").trim();
  if (!actual || actual !== expected) throw new Error("MERCADOPAGO_COLLECTOR_MISMATCH");
}

async function syncPayment(payment: any, invoice?: any) {
  assertCollector(payment);
  const enriched = { ...payment };
  if (invoice?.preapproval_id && !enriched.preapproval_id) enriched.preapproval_id = String(invoice.preapproval_id);
  if (invoice?.external_reference && !enriched.external_reference) enriched.external_reference = String(invoice.external_reference);
  const applied = await rpc("vip_mp_pago_aplicar", { p_pago: enriched });
  let refunds: any[] = [];
  try {
    const list = await mpGet(`/v1/payments/${encodeURIComponent(String(enriched.id))}/refunds`);
    refunds = Array.isArray(list) ? list : [];
  } catch (_) { console.warn("MP_REFUNDS_LOOKUP_FAILED", String(enriched.id || "")); }
  const refundSync = await rpc("vip_mp_reembolsos_sincronizar", { p_payment_id: String(enriched.id), p_refunds: refunds });
  return { applied, refundSync };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (env("MERCADOPAGO_INTEGRATION_ENABLED").toLowerCase() !== "true") return json({ ok: false, error: "integracion_no_activada" }, 503);
  const secret = env("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret || !env("MERCADOPAGO_ACCESS_TOKEN") || !env("MERCADOPAGO_EXPECTED_COLLECTOR_ID")) return json({ ok: false, error: "credenciales_no_configuradas" }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }
  const url = new URL(req.url);
  const dataId = String(url.searchParams.get("data.id") || url.searchParams.get("data_id") || body?.data?.id || "");
  const xSignature = req.headers.get("x-signature") || "";
  const xRequestId = req.headers.get("x-request-id") || "";
  if (!dataId || !xSignature || !xRequestId) return json({ ok: false, error: "firma_incompleta" }, 401);
  try { WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret }); }
  catch { return json({ ok: false, error: "firma_invalida" }, 401); }

  const tipo = String(body?.type || ""), accion = String(body?.action || ""), eventId = String(body?.id || "");
  const eventKey = eventId ? `mp-event-${eventId}` : `mp-${tipo}-${dataId}-${accion}-${xRequestId}`;
  try {
    const registered = await rpc("vip_mp_evento_registrar", {
      p_event_key: eventKey, p_event_id: eventId, p_tipo: tipo, p_accion: accion,
      p_data_id: dataId, p_request_id: xRequestId, p_live_mode: Boolean(body?.live_mode),
      p_firma_valida: true, p_payload: body,
    });
    if (registered?.procesar === false) return json({ ok: true, duplicate: true, estado: registered?.estado_anterior || registered?.estado || "" });

    if (tipo === "payment") {
      const payment = await mpGet(`/v1/payments/${encodeURIComponent(dataId)}`);
      const synced = await syncPayment(payment);
      const ok = synced?.applied?.ok && synced?.refundSync?.ok;
      await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: ok ? "procesado" : "error", p_error: ok ? "" : String(synced?.applied?.error || synced?.refundSync?.error || "pago_no_sincronizado") });
      return json({ ok: true });
    }

    if (tipo === "subscription_authorized_payment") {
      const invoice = await mpGet(`/authorized_payments/${encodeURIComponent(dataId)}`);
      const paymentId = String(invoice?.payment?.id || "");
      if (!paymentId) {
        await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: "procesado", p_error: "" });
        return json({ ok: true, pending: true });
      }
      const payment = await mpGet(`/v1/payments/${encodeURIComponent(paymentId)}`);
      const synced = await syncPayment(payment, invoice);
      const ok = synced?.applied?.ok && synced?.refundSync?.ok;
      await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: ok ? "procesado" : "error", p_error: ok ? "" : String(synced?.applied?.error || synced?.refundSync?.error || "factura_no_sincronizada") });
      return json({ ok: true });
    }

    if (tipo === "subscription_preapproval") {
      const subscription = await mpGet(`/preapproval/${encodeURIComponent(dataId)}`);
      assertCollector(subscription);
      const trial = await rpc("vip_mp_trial_suscripcion_aplicar", { p_datos: subscription });
      if (trial?.manejado === true) {
        if (trial?.ok !== true && trial?.cancelar_mp === true && subscription?.id) {
          try { await mpCancelSubscription(String(subscription.id)); }
          catch { console.error("MP_TRIAL_SAFE_CANCEL_FAILED"); }
        }
        await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: trial?.ok === true ? "procesado" : "error", p_error: trial?.ok === true ? "" : String(trial?.error || "trial_no_activado") });
        return json({ ok: true, trial: true });
      }
      const updated = await rpc("vip_mp_suscripcion_actualizar", { p_datos: subscription });
      await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: updated?.ok ? "procesado" : "error", p_error: updated?.ok ? "" : String(updated?.error || "suscripcion_no_actualizada") });
      return json({ ok: true });
    }

    if (tipo === "topic_chargebacks_wh" || tipo === "chargebacks") {
      const chargeback = await mpGet(`/v1/chargebacks/${encodeURIComponent(dataId)}`);
      const paymentId = String(Array.isArray(chargeback?.payments) ? (chargeback.payments[0] || "") : (chargeback?.payments || body?.data?.payment_id || ""));
      let payment: any = null;
      if (paymentId) {
        try { payment = await mpGet(`/v1/payments/${encodeURIComponent(paymentId)}`); assertCollector(payment); }
        catch { console.warn("MP_CHARGEBACK_PAYMENT_LOOKUP_FAILED", paymentId); }
      }
      const updated = await rpc("vip_mp_contracargo_sincronizar", { p_datos: { ...chargeback, _payment_status: String(payment?.status || ""), _payment_status_detail: String(payment?.status_detail || "") } });
      await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: updated?.ok ? "procesado" : "error", p_error: updated?.ok ? "" : String(updated?.error || "contracargo_no_sincronizado") });
      return json({ ok: true });
    }

    await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: "ignorado", p_error: `Tópico no procesado: ${tipo}` });
    return json({ ok: true, ignored: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    console.error("vip-mp-webhook", code);
    try { await rpc("vip_mp_evento_finalizar", { p_event_key: eventKey, p_estado: "error", p_error: code }); } catch {}
    if (code === "MERCADOPAGO_COLLECTOR_MISMATCH" || code === "MERCADOPAGO_EXPECTED_COLLECTOR_ID_MISSING") return json({ ok: false, error: "configuracion_cuenta_mercado_pago_no_valida" }, 503);
    return json({ ok: false, error: "error_interno_webhook" }, 500);
  }
});
