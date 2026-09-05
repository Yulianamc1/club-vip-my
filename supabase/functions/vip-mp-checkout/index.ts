import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (data: unknown, status = 200, origin = "") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(origin ? {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "vary": "Origin",
      } : {}),
    },
  });

function env(name: string) { return (Deno.env.get(name) || "").trim(); }
function clientIp(req: Request) {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return String(direct || forwarded.split(",")[0] || "").trim().slice(0, 128);
}
function clip(value: unknown, max = 180) { return String(value ?? "").trim().slice(0, max); }
function safeAttribution(raw: unknown, promotionFallback = "") {
  const a = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    source: clip(a.source || a.utm_source, 120),
    campaign: clip(a.campaign || a.utm_campaign, 180),
    ad: clip(a.ad || a.utm_content, 180),
    product_origin: clip(a.product_origin, 180),
    promotion_origin: clip(a.promotion_origin || promotionFallback, 180),
    utm_medium: clip(a.utm_medium, 120),
    utm_term: clip(a.utm_term, 180),
    utm_content: clip(a.utm_content, 180),
    fbclid: clip(a.fbclid, 240),
  };
}
async function rpc(name: string, body: Record<string, unknown>) {
  const url = env("SUPABASE_URL");
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
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
function assertCollector(obj: any) {
  const expected = env("MERCADOPAGO_EXPECTED_COLLECTOR_ID");
  if (!expected) throw new Error("MERCADOPAGO_EXPECTED_COLLECTOR_ID_MISSING");
  const actual = String(obj?.collector_id || "").trim();
  if (!actual || actual !== expected) throw new Error("MERCADOPAGO_COLLECTOR_MISMATCH");
}
async function mpPost(path: string, accessToken: string, body: unknown, idempotencyKey: string) {
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) throw new Error(`MP_POST_${res.status}_${path}`);
  return data;
}
async function captureAttribution(externalReference: string, attribution: Record<string, string>) {
  if (!externalReference) return;
  try {
    await rpc("vip_growth_attribution_capture_external", {
      p_external_reference: externalReference,
      p_attribution: attribution,
    });
  } catch (error) {
    // La analítica jamás debe impedir un checkout válido.
    console.warn("growth_attribution_not_saved", error instanceof Error ? error.message : String(error));
  }
}

Deno.serve(async (req: Request) => {
  const allowedOrigin = env("MERCADOPAGO_ALLOWED_ORIGIN");
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    if (!allowedOrigin || origin !== allowedOrigin) return json({ ok: false }, 403);
    return json({ ok: true }, 204, allowedOrigin);
  }
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (env("MERCADOPAGO_INTEGRATION_ENABLED").toLowerCase() !== "true") {
    return json({ ok: false, error: "integracion_no_activada" }, 503, allowedOrigin);
  }
  if (!allowedOrigin || origin !== allowedOrigin) return json({ ok: false, error: "origen_no_permitido" }, 403);

  const accessToken = env("MERCADOPAGO_ACCESS_TOKEN");
  const backUrl = env("MERCADOPAGO_BACK_URL");
  const expectedCollector = env("MERCADOPAGO_EXPECTED_COLLECTOR_ID");
  if (!accessToken || !backUrl || !expectedCollector) return json({ ok: false, error: "credenciales_no_configuradas" }, 503, allowedOrigin);
  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > 16384) return json({ ok: false, error: "solicitud_demasiado_grande" }, 413, allowedOrigin);

  let input: any;
  try { input = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400, allowedOrigin); }
  const nombre = String(input?.nombre || "").trim();
  const correo = String(input?.correo || "").trim();
  const whatsapp = String(input?.whatsapp || "").trim();
  const plan = String(input?.plan || "").trim();
  const modo = String(input?.modo || "directo").trim().toLowerCase();
  const codigo = String(input?.codigo || "").trim();
  const isTrial = modo === "trial";
  const attribution = safeAttribution(input?.attribution, isTrial ? codigo : "");

  if (!nombre || !correo || !whatsapp || !["VIP", "VIP Pro"].includes(plan)) return json({ ok: false, error: "datos_incompletos" }, 400, allowedOrigin);
  if (isTrial && !codigo) return json({ ok: false, error: "codigo_requerido", mensaje: "Escribe tu código de 21 días." }, 400, allowedOrigin);
  const normalizedPhone = whatsapp.replace(/\D/g, "").slice(-10);
  const identity = `${correo.toLowerCase()}|${normalizedPhone}|${isTrial ? "trial" : "directo"}`;

  try {
    const rate = await rpc("vip_mp_checkout_rate_guard", { p_identity: identity, p_ip: clientIp(req) });
    if (rate?.allowed !== true) {
      return json({ ok: false, error: "demasiados_intentos", mensaje: "Se hicieron varios intentos seguidos. Espera unos minutos antes de volver a intentarlo.", retry_after: Number(rate?.retry_after || 900) }, 429, allowedOrigin);
    }

    if (isTrial) {
      const prep = await rpc("vip_mp_trial_checkout_preparar", { p_nombre: nombre, p_correo: correo, p_whatsapp: whatsapp, p_codigo: codigo, p_plan: plan });
      if (!prep?.ok) return json({ ok: false, error: String(prep?.error || "trial_no_disponible"), mensaje: String(prep?.mensaje || "No fue posible preparar los 21 días gratis.") }, 400, allowedOrigin);
      await captureAttribution(String(prep.external_reference || ""), attribution);
      if (prep?.init_point && prep?.mp_plan_id) {
        return json({ ok: true, trial: true, reutilizada: true, external_reference: prep.external_reference, plan_nombre: prep.plan_nombre, precio: prep.precio, moneda: prep.moneda, trial_dias: prep.trial_dias, init_point: prep.init_point }, 200, allowedOrigin);
      }
      const trialDays = Math.max(1, Math.min(Number(prep.trial_dias || 21), 90));
      const mpPlanBody = {
        reason: `Plataforma MY · ${prep.plan_nombre} · ${trialDays} días gratis`,
        auto_recurring: { frequency: 1, frequency_type: "months", free_trial: { frequency: trialDays, frequency_type: "days" }, transaction_amount: Number(prep.precio), currency_id: "MXN" },
        payment_methods_allowed: { payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "prepaid_card" }] },
        back_url: backUrl,
      };
      const mpPlan = await mpPost("/preapproval_plan", accessToken, mpPlanBody, String(prep.external_reference));
      assertCollector(mpPlan);
      if (!mpPlan?.id || !mpPlan?.init_point) return json({ ok: false, error: "mercado_pago_no_creo_plan_trial" }, 502, allowedOrigin);
      const linked = await rpc("vip_mp_trial_plan_vincular", { p_external_reference: prep.external_reference, p_plan_id: String(mpPlan.id), p_init_point: String(mpPlan.init_point), p_live_mode: Boolean(mpPlan.live_mode), p_datos: mpPlan });
      if (!linked?.ok) return json({ ok: false, error: "no_se_pudo_vincular_trial" }, 500, allowedOrigin);
      return json({ ok: true, trial: true, reutilizada: false, external_reference: prep.external_reference, plan_nombre: prep.plan_nombre, precio: prep.precio, moneda: prep.moneda, trial_dias: trialDays, init_point: mpPlan.init_point }, 200, allowedOrigin);
    }

    const prep = await rpc("vip_mp_checkout_preparar", { p_nombre: nombre, p_correo: correo, p_whatsapp: whatsapp, p_plan: plan });
    if (!prep?.ok) {
      console.warn("vip-mp-checkout rejected", String(prep?.error || prep?.estado || "no_preparado"));
      return json({ ok: false, error: "checkout_no_disponible", mensaje: "No fue posible preparar la suscripción con estos datos. Si ya tienes una cuenta, inicia sesión o contacta soporte." }, 400, allowedOrigin);
    }
    await captureAttribution(String(prep.external_reference || ""), attribution);
    if (prep?.mp_preapproval_id && prep?.init_point) return json({ ok: true, reutilizada: true, external_reference: prep.external_reference, plan_nombre: prep.plan_nombre, precio: prep.precio, moneda: prep.moneda, init_point: prep.init_point }, 200, allowedOrigin);

    const mpBody = { reason: `Plataforma MY · ${prep.plan_nombre}`, external_reference: prep.external_reference, payer_email: correo, auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: Number(prep.precio), currency_id: "MXN" }, back_url: backUrl, status: "pending" };
    const mp = await mpPost("/preapproval", accessToken, mpBody, String(prep.external_reference));
    assertCollector(mp);
    if (!mp?.id || !mp?.init_point) return json({ ok: false, error: "mercado_pago_no_creo_suscripcion" }, 502, allowedOrigin);
    const linked = await rpc("vip_mp_suscripcion_vincular", { p_external_reference: prep.external_reference, p_preapproval_id: String(mp.id), p_init_point: String(mp.init_point), p_estado: String(mp.status || "pending"), p_live_mode: Boolean(mp.live_mode), p_datos: mp });
    if (!linked?.ok) return json({ ok: false, error: "no_se_pudo_vincular_checkout" }, 500, allowedOrigin);
    return json({ ok: true, reutilizada: false, external_reference: prep.external_reference, plan_nombre: prep.plan_nombre, precio: prep.precio, moneda: prep.moneda, init_point: mp.init_point }, 200, allowedOrigin);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    console.error("vip-mp-checkout", code);
    if (code === "MERCADOPAGO_COLLECTOR_MISMATCH" || code === "MERCADOPAGO_EXPECTED_COLLECTOR_ID_MISSING") return json({ ok: false, error: "configuracion_cuenta_mercado_pago_no_valida" }, 503, allowedOrigin);
    return json({ ok: false, error: "error_interno_checkout" }, 500, allowedOrigin);
  }
});
