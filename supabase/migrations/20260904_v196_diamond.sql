-- MY V196 DIAMANTE · MIGRACIÓN ÚNICA DE ENTREGA
-- Finanzas/identidad estable + Crecimiento/ciclo de suscripción.
-- Generada 2026-09-04. Fuentes auditadas por separado; entrega con una sola transacción.

begin;

-- ============================================================
-- A. FINANZAS E IDENTIDAD ESTABLE
-- ============================================================
-- MY V196 DIAMANTE · Finanzas privadas
-- Objetivo: una sola configuración vigente, identidad financiera estable y RPC explícitos.
-- No borra snapshots, movimientos, catálogo, metas ni identidades.

-- 1) Nueva clave estable de configuración (sin número de versión).
insert into public.config_app(clave, valor, actualizado_en)
select 'vip_finance_access', valor, now()
from public.config_app
where clave='vip_finance_access_v166'
  and not exists (select 1 from public.config_app where clave='vip_finance_access');

insert into public.config_app(clave, valor, actualizado_en)
select 'vip_finance_access',
       '{"visible":true,"planDefaults":{"Básico":"none","VIP":"advanced","VIP Pro":"advanced"},"memberOverrides":{},"modules":{"advanced":{"calculator":true,"goals":true,"catalog":true,"clients":true,"orders":true,"income":true,"services":true,"expenses":true,"closing":true,"invoices":true,"taxes":true}}}'::jsonb,
       now()
where not exists (select 1 from public.config_app where clave='vip_finance_access');

-- 2) Acceso financiero: identidad Auth vinculada manda; Código+WhatsApp queda solo como compatibilidad temporal.
create or replace function public.vip_finanzas_acceso(p_codigo text, p_whatsapp text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'extensions', 'private', 'pg_temp'
as $function$
declare
  v_miembro bigint;
  v_plan text;
  v_finance_identity uuid;
  v_legacy_keys jsonb := '[]'::jsonb;
  v_cfg jsonb := '{}'::jsonb;
  v_visible boolean := true;
  v_level text;
  v_modules jsonb;
  v_es_basico boolean;
begin
  v_miembro := public.vip_miembro_activo_id(p_codigo,p_whatsapp);
  if v_miembro is null then
    return jsonb_build_object('ok',false,'mensaje','Acceso no válido o membresía inactiva.');
  end if;

  select coalesce(m.plan,'Básico'), m.finance_identity
    into v_plan, v_finance_identity
  from public.miembros m
  where m.id=v_miembro;

  if v_finance_identity is null then
    raise exception 'FINANCE_IDENTITY_MISSING';
  end if;

  select coalesce(jsonb_agg(a.legacy_db_key order by a.created_at,a.legacy_db_key),'[]'::jsonb)
    into v_legacy_keys
  from private.vip_finance_identity_aliases a
  where a.miembro_id=v_miembro;

  v_es_basico := lower(trim(coalesce(v_plan,''))) in ('básico','basico');

  select coalesce(valor,'{}'::jsonb)
    into v_cfg
  from public.config_app
  where clave='vip_finance_access';
  v_cfg := coalesce(v_cfg,'{}'::jsonb);

  begin
    if v_cfg ? 'visible' then
      v_visible := coalesce((v_cfg->>'visible')::boolean,true);
    end if;
  exception when others then
    v_visible := true;
  end;

  -- V196: la excepción individual usa finance_identity, no Código VIP ni una huella versionada.
  v_level := coalesce(v_cfg->'memberOverrides'->>v_finance_identity::text,'inherit');

  if v_level='inherit' then
    v_level := coalesce(
      v_cfg->'planDefaults'->>v_plan,
      case when v_es_basico then 'none' else 'advanced' end
    );
  end if;

  -- Compatibilidad de datos: "essential" se normaliza a sin acceso; no existe un tercer motor financiero.
  if v_level='essential' then v_level := 'none'; end if;
  if v_level not in ('none','advanced') then
    v_level := case when v_es_basico then 'none' else 'advanced' end;
  end if;

  if v_level='advanced' then
    v_modules := coalesce(
      v_cfg->'modules'->'advanced',
      '{"calculator":true,"goals":true,"catalog":true,"clients":true,"orders":true,"income":true,"services":true,"expenses":true,"closing":true,"invoices":true,"taxes":true}'::jsonb
    );
  else
    v_modules := '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'ok',true,
    'allowed',v_visible and v_level='advanced',
    'level',v_level,
    'modules',v_modules,
    'plan',v_plan,
    'storage_identity',v_finance_identity::text,
    'legacy_db_keys',v_legacy_keys,
    'storage_version',2
  );
end;
$function$;

-- 3) Tabla de snapshots nunca se consulta directamente desde el cliente.
alter table public.vip_finanzas_sync enable row level security;
revoke all on table public.vip_finanzas_sync from public, anon, authenticated;

-- 4) RPC: acceso mínimo explícito. SECURITY DEFINER queda acotado por vip_miembro_activo_id y search_path fijo.
revoke execute on function public.vip_finanzas_acceso(text,text) from public;
revoke execute on function public.vip_finanzas_sync_obtener(text,text) from public;
revoke execute on function public.vip_finanzas_sync_guardar(text,text,jsonb,bigint) from public;

grant execute on function public.vip_finanzas_acceso(text,text) to anon, authenticated;
grant execute on function public.vip_finanzas_sync_obtener(text,text) to anon, authenticated;
grant execute on function public.vip_finanzas_sync_guardar(text,text,jsonb,bigint) to anon, authenticated;

-- 5) Identidad de integrantes: toda función histórica que usa Código+WhatsApp
-- delega al único resolvedor Auth-first vigente. Esto evita dos validadores paralelos.
create or replace function public.vip_miembro_valido(p_codigo text, p_whatsapp text)
returns table(id bigint,nombre text,codigo_vip text,whatsapp text,plan text,estado text,fecha_vencimiento date)
language sql
security definer
stable
set search_path = 'pg_catalog','public','extensions','pg_temp'
as $function$
  with resolved as (
    select public.vip_miembro_activo_id(p_codigo,p_whatsapp) as miembro_id
  )
  select m.id,m.nombre,m.codigo_vip,m.whatsapp,m.plan,m.estado,m.fecha_vencimiento
  from public.miembros m
  join resolved r on r.miembro_id=m.id
  limit 1;
$function$;
revoke execute on function public.vip_miembro_valido(text,text) from public;
grant execute on function public.vip_miembro_valido(text,text) to anon,authenticated;

-- 6) Contratos administrativos sin número de versión.
-- La implementación real se renombra; los nombres V191 sobreviven solamente
-- como wrappers de compatibilidad durante la transición y ya no contienen lógica propia.
do $migration$
begin
  if to_regprocedure('public.vip_suscripciones_pagos_admin_panel(text,date,date,integer)') is null
     and to_regprocedure('public.vip_suscripciones_pagos_admin_panel_v191(text,date,date,integer)') is not null then
    alter function public.vip_suscripciones_pagos_admin_panel_v191(text,date,date,integer)
      rename to vip_suscripciones_pagos_admin_panel;
  end if;
  if to_regprocedure('public.vip_suscriptor_admin_actualizar(bigint,text,text,text,text,text,date)') is null
     and to_regprocedure('public.vip_suscriptor_admin_actualizar_v191(bigint,text,text,text,text,text,date)') is not null then
    alter function public.vip_suscriptor_admin_actualizar_v191(bigint,text,text,text,text,text,date)
      rename to vip_suscriptor_admin_actualizar;
  end if;
end $migration$;

create or replace function public.vip_suscripciones_pagos_admin_panel_v191(
  p_filtro text default '', p_desde date default null, p_hasta date default null, p_limite integer default 100
) returns jsonb
language sql security invoker
set search_path = 'pg_catalog','public','extensions','pg_temp'
as $function$
  select public.vip_suscripciones_pagos_admin_panel(p_filtro,p_desde,p_hasta,p_limite);
$function$;

create or replace function public.vip_suscriptor_admin_actualizar_v191(
  p_id bigint,p_nombre text,p_correo text,p_whatsapp text,p_plan text,p_estado text,p_fecha_vencimiento date
) returns jsonb
language sql security invoker
set search_path = 'pg_catalog','public','extensions','pg_temp'
as $function$
  select public.vip_suscriptor_admin_actualizar(p_id,p_nombre,p_correo,p_whatsapp,p_plan,p_estado,p_fecha_vencimiento);
$function$;

revoke execute on function public.vip_suscripciones_pagos_admin_panel(text,date,date,integer) from public,anon;
revoke execute on function public.vip_suscriptor_admin_actualizar(bigint,text,text,text,text,text,date) from public,anon;
grant execute on function public.vip_suscripciones_pagos_admin_panel(text,date,date,integer) to authenticated;
grant execute on function public.vip_suscriptor_admin_actualizar(bigint,text,text,text,text,text,date) to authenticated;
revoke execute on function public.vip_suscripciones_pagos_admin_panel_v191(text,date,date,integer) from public,anon;
revoke execute on function public.vip_suscriptor_admin_actualizar_v191(bigint,text,text,text,text,text,date) from public,anon;
grant execute on function public.vip_suscripciones_pagos_admin_panel_v191(text,date,date,integer) to authenticated;
grant execute on function public.vip_suscriptor_admin_actualizar_v191(bigint,text,text,text,text,text,date) to authenticated;

-- 7) Mi Negocio: contrato estable para registrar cobros con comisión.
-- La implementación vigente deja de llamarse _v2. El nombre _v2 queda solo como
-- wrapper temporal para clientes antiguos y no es usado por V196.
do $migration$
begin
  if to_regprocedure('public.my_pago_registrar(text,text,uuid,numeric,text,date,text,text,numeric,uuid)') is null
     and to_regprocedure('public.my_pago_registrar_v2(text,text,uuid,numeric,text,date,text,text,numeric,uuid)') is not null then
    alter function public.my_pago_registrar_v2(text,text,uuid,numeric,text,date,text,text,numeric,uuid)
      rename to my_pago_registrar;
  end if;
end $migration$;

create or replace function public.my_pago_registrar_v2(
  p_codigo text,
  p_whatsapp text,
  p_operacion_id uuid,
  p_monto numeric,
  p_metodo text,
  p_fecha date default null,
  p_referencia text default '',
  p_notas text default '',
  p_comision numeric default 0,
  p_idempotencia uuid default null
) returns jsonb
language sql
security invoker
set search_path = 'pg_catalog','public','extensions','pg_temp'
as $function$
  select public.my_pago_registrar(
    p_codigo,p_whatsapp,p_operacion_id,p_monto,p_metodo,
    p_fecha,p_referencia,p_notas,p_comision,p_idempotencia
  );
$function$;

revoke execute on function public.my_pago_registrar(text,text,uuid,numeric,text,date,text,text,numeric,uuid) from public;
grant execute on function public.my_pago_registrar(text,text,uuid,numeric,text,date,text,text,numeric,uuid) to anon,authenticated;
revoke execute on function public.my_pago_registrar_v2(text,text,uuid,numeric,text,date,text,text,numeric,uuid) from public;
grant execute on function public.my_pago_registrar_v2(text,text,uuid,numeric,text,date,text,text,numeric,uuid) to anon,authenticated;

-- 8) Promociones: el sincronizador público también resuelve identidad con el
-- único validador Auth-first. Código+WhatsApp queda solo como fallback de cuentas
-- antiguas todavía no vinculadas a Auth.
create or replace function public.vip_promocion_sincronizar_acceso(p_codigo text, p_whatsapp text)
returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public','extensions','pg_temp'
as $function$
declare
  m public.miembros%rowtype;
  c public.vip_promociones_canjes%rowtype;
  v_mid bigint;
  v_estado text;
  v_puede boolean := false;
begin
  v_mid := public.vip_miembro_activo_id(p_codigo,p_whatsapp);
  if v_mid is null then
    return jsonb_build_object('ok',false,'estado','acceso_no_valido');
  end if;

  select * into m from public.miembros where id=v_mid;
  if m.id is null then
    return jsonb_build_object('ok',false,'estado','acceso_no_valido');
  end if;

  select * into c
  from public.vip_promociones_canjes
  where miembro_id=m.id
    and beneficio_unico_vida=true
    and estado not in ('rechazado','cancelado')
  order by creado_en desc
  limit 1
  for update;

  if c.id is null then
    v_puede := coalesce(m.estado,'activo') not in ('suspendido','vencido')
      and (
        (m.fecha_vencimiento_exacta is not null and m.fecha_vencimiento_exacta>now())
        or
        (m.fecha_vencimiento_exacta is null and (m.fecha_vencimiento is null or m.fecha_vencimiento>=current_date))
      );
    return jsonb_build_object(
      'ok',true,'estado',case when v_puede then 'suscripcion' else 'vencido' end,
      'puede_entrar',v_puede,'plan',m.plan
    );
  end if;

  if m.plan<>'Básico' then
    update public.vip_promociones_canjes
      set estado='convertido'
    where id=c.id and estado<>'convertido';
    update public.vip_control_membresias
      set plan_key=m.plan,status='active',grace_until=null,updated_at=now()
    where member_id=m.id::text;
    return jsonb_build_object(
      'ok',true,'estado','suscripcion','puede_entrar',true,
      'plan',m.plan,'plan_post_prueba',c.plan_post_prueba
    );
  end if;

  if c.fecha_vencimiento_exacta is not null and now()<c.fecha_vencimiento_exacta then
    v_estado:='prueba'; v_puede:=true;
    update public.vip_promociones_canjes set estado='activo' where id=c.id and estado<>'activo';
    update public.miembros set estado='activo' where id=m.id and estado<>'activo';
    update public.vip_control_membresias
      set status='active',next_renewal=c.fecha_vencimiento,grace_until=c.grace_until,updated_at=now()
    where member_id=m.id::text;
  elsif c.grace_until_exacta is not null and now()<c.grace_until_exacta then
    v_estado:='gracia'; v_puede:=true;
    update public.vip_promociones_canjes set estado='gracia' where id=c.id and estado<>'gracia';
    update public.miembros set estado='activo' where id=m.id and estado<>'activo';
    update public.vip_control_membresias
      set status='grace',grace_until=c.grace_until,updated_at=now()
    where member_id=m.id::text;
  else
    v_estado:='suspendido'; v_puede:=false;
    update public.vip_promociones_canjes set estado='suspendido' where id=c.id and estado<>'suspendido';
    update public.miembros set estado='suspendido' where id=m.id and estado<>'suspendido';
    update public.vip_control_membresias
      set status='suspended',updated_at=now()
    where member_id=m.id::text;
  end if;

  return jsonb_build_object(
    'ok',true,'estado',v_estado,'puede_entrar',v_puede,'plan',m.plan,
    'plan_post_prueba',c.plan_post_prueba,'fecha_vencimiento',c.fecha_vencimiento,
    'fecha_vencimiento_exacta',c.fecha_vencimiento_exacta,'grace_until',c.grace_until,
    'grace_until_exacta',c.grace_until_exacta
  );
end;
$function$;
revoke execute on function public.vip_promocion_sincronizar_acceso(text,text) from public;
grant execute on function public.vip_promocion_sincronizar_acceso(text,text) to anon,authenticated;

-- 9) Secure-by-default para objetos FUTUROS: una tabla o función nueva no se
-- vuelve API pública por accidente. Las migraciones futuras deben otorgar solo
-- los permisos explícitos que correspondan.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Service role permanece disponible para automatizaciones internas; las
-- superficies cliente quedan opt-in y sujetas a RLS/RPC explícitos.

-- ============================================================
-- B. CRECIMIENTO Y CICLO DE SUSCRIPCIÓN
-- ============================================================
-- MY V196 DIAMANTE · Crecimiento y ciclo de suscripción
-- Fecha: 2026-09-04
-- Regla DIAMANTE: una sola identidad estable, una sola fuente de pagos,
-- eventos financieros confirmados por backend y migración no destructiva.


create schema if not exists private;

create table if not exists public.vip_growth_attribution (
  id uuid primary key default gen_random_uuid(),
  external_reference text,
  user_id uuid,
  miembro_id bigint references public.miembros(id) on delete set null,
  source text not null default '',
  campaign text not null default '',
  ad text not null default '',
  product_origin text not null default '',
  promotion_origin text not null default '',
  utm_medium text not null default '',
  utm_term text not null default '',
  utm_content text not null default '',
  fbclid text not null default '',
  captured_at timestamptz not null default now(),
  linked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vip_growth_attribution_external_reference_len check (char_length(coalesce(external_reference,'')) <= 240)
);

create unique index if not exists vip_growth_attribution_external_reference_uq
  on public.vip_growth_attribution(external_reference)
  where external_reference is not null and btrim(external_reference) <> '';
create index if not exists vip_growth_attribution_user_idx on public.vip_growth_attribution(user_id, captured_at desc);
create index if not exists vip_growth_attribution_member_idx on public.vip_growth_attribution(miembro_id, captured_at desc);

create table if not exists public.vip_growth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  miembro_id bigint references public.miembros(id) on delete set null,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  plan_key text not null default '',
  source text not null default '',
  campaign text not null default '',
  ad text not null default '',
  product_origin text not null default '',
  promotion_origin text not null default '',
  monetary_value numeric(14,2),
  currency text not null default 'MXN',
  provider text not null default '',
  provider_payment_id text not null default '',
  provider_subscription_id text not null default '',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint vip_growth_events_type_chk check (event_type in (
    'registered',
    'trial_started','onboarding_completed','activated',
    'subscription_started','subscription_renewed',
    'trial_cancelled','payment_failed','subscription_cancelled','plan_upgraded',
    'value_action'
  )),
  constraint vip_growth_events_currency_len check (char_length(currency) between 3 and 8),
  constraint vip_growth_events_idem_len check (char_length(idempotency_key) between 3 and 500)
);

create unique index if not exists vip_growth_events_idempotency_uq on public.vip_growth_events(idempotency_key);
create index if not exists vip_growth_events_type_time_idx on public.vip_growth_events(event_type, occurred_at desc);
create index if not exists vip_growth_events_user_time_idx on public.vip_growth_events(user_id, occurred_at desc);
create index if not exists vip_growth_events_member_time_idx on public.vip_growth_events(miembro_id, occurred_at desc);
create index if not exists vip_growth_events_segment_idx on public.vip_growth_events(plan_key, source, campaign, occurred_at desc);

alter table public.vip_growth_events enable row level security;
alter table public.vip_growth_attribution enable row level security;
revoke all on table public.vip_growth_events from public, anon, authenticated;
revoke all on table public.vip_growth_attribution from public, anon, authenticated;
grant all on table public.vip_growth_events to service_role;
grant all on table public.vip_growth_attribution to service_role;

create or replace function private.vip_growth_user_id(p_miembro bigint)
returns uuid
language sql
stable
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
  select m.finance_identity from public.miembros m where m.id=p_miembro limit 1;
$$;
revoke all on function private.vip_growth_user_id(bigint) from public,anon,authenticated;

create or replace function private.vip_growth_clip(p_value text, p_max integer default 180)
returns text
language sql
immutable
set search_path='pg_catalog','pg_temp'
as $$
  select left(btrim(coalesce(p_value,'')), greatest(1,least(coalesce(p_max,180),500)));
$$;
revoke all on function private.vip_growth_clip(text,integer) from public,anon,authenticated;

create or replace function private.vip_growth_link_attribution(p_miembro bigint, p_external_reference text default null)
returns void
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_uid uuid;
begin
  select finance_identity into v_uid from public.miembros where id=p_miembro;
  if v_uid is null then return; end if;
  if nullif(btrim(coalesce(p_external_reference,'')),'') is not null then
    update public.vip_growth_attribution
       set user_id=v_uid, miembro_id=p_miembro, linked_at=coalesce(linked_at,now()), updated_at=now()
     where external_reference=btrim(p_external_reference);
  end if;
  update public.vip_growth_attribution
     set miembro_id=p_miembro, linked_at=coalesce(linked_at,now()), updated_at=now()
   where user_id=v_uid and miembro_id is distinct from p_miembro;

  -- Completa eventos que pudieron nacer durante el webhook antes de que la atribución quedara vinculada.
  update public.vip_growth_events g
     set source=case when g.source='' then coalesce(a.source,'') else g.source end,
         campaign=case when g.campaign='' then coalesce(a.campaign,'') else g.campaign end,
         ad=case when g.ad='' then coalesce(a.ad,'') else g.ad end,
         product_origin=case when g.product_origin='' then coalesce(a.product_origin,'') else g.product_origin end,
         promotion_origin=case when g.promotion_origin='' then coalesce(a.promotion_origin,'') else g.promotion_origin end
  from lateral (
    select x.source,x.campaign,x.ad,x.product_origin,x.promotion_origin
    from public.vip_growth_attribution x
    where x.user_id=v_uid or x.miembro_id=p_miembro
    order by x.captured_at desc,x.created_at desc limit 1
  ) a
  where g.user_id=v_uid;
end;
$$;
revoke all on function private.vip_growth_link_attribution(bigint,text) from public,anon,authenticated;

create or replace function private.vip_growth_event_insert(
  p_miembro bigint,
  p_event_type text,
  p_idempotency_key text,
  p_occurred_at timestamptz default now(),
  p_plan text default null,
  p_value numeric default null,
  p_currency text default 'MXN',
  p_provider text default '',
  p_payment_id text default '',
  p_subscription_id text default '',
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare
  v_uid uuid; v_plan text; v_attr public.vip_growth_attribution%rowtype; v_id uuid;
begin
  if p_miembro is null then return null; end if;
  select finance_identity,coalesce(nullif(p_plan,''),plan,'') into v_uid,v_plan
  from public.miembros where id=p_miembro;
  if v_uid is null then return null; end if;

  select * into v_attr
  from public.vip_growth_attribution a
  where a.user_id=v_uid or a.miembro_id=p_miembro
  order by a.captured_at desc, a.created_at desc
  limit 1;

  insert into public.vip_growth_events(
    user_id,miembro_id,occurred_at,event_type,plan_key,
    source,campaign,ad,product_origin,promotion_origin,
    monetary_value,currency,provider,provider_payment_id,provider_subscription_id,
    idempotency_key,metadata
  ) values(
    v_uid,p_miembro,coalesce(p_occurred_at,now()),p_event_type,coalesce(v_plan,''),
    coalesce(nullif(v_attr.source,''),nullif(private.vip_growth_clip(p_metadata->>'source',120),''),nullif(private.vip_growth_clip(p_metadata->>'sale_origin',120),''),''),
    coalesce(nullif(v_attr.campaign,''),nullif(private.vip_growth_clip(p_metadata->>'campaign',180),''),''),
    coalesce(nullif(v_attr.ad,''),nullif(private.vip_growth_clip(p_metadata->>'ad',180),''),''),
    coalesce(nullif(v_attr.product_origin,''),nullif(private.vip_growth_clip(p_metadata->>'product_origin',180),''),''),
    coalesce(nullif(v_attr.promotion_origin,''),nullif(private.vip_growth_clip(p_metadata->>'promotion_origin',180),''),''),
    p_value,upper(coalesce(nullif(btrim(p_currency),''),'MXN')),
    private.vip_growth_clip(p_provider,80),private.vip_growth_clip(p_payment_id,180),private.vip_growth_clip(p_subscription_id,180),
    private.vip_growth_clip(p_idempotency_key,500),coalesce(p_metadata,'{}'::jsonb)
  ) on conflict(idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.vip_growth_event_insert(bigint,text,text,timestamptz,text,numeric,text,text,text,text,jsonb) from public,anon,authenticated;

create or replace function private.vip_growth_maybe_activate(p_miembro bigint)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_uid uuid; v_onboard timestamptz; v_value timestamptz; v_when timestamptz;
begin
  select finance_identity into v_uid from public.miembros where id=p_miembro;
  if v_uid is null then return false; end if;
  if exists(select 1 from public.vip_growth_events where user_id=v_uid and event_type='activated') then return true; end if;
  select min(occurred_at) into v_onboard from public.vip_growth_events where user_id=v_uid and event_type='onboarding_completed';
  select min(occurred_at) into v_value from public.vip_growth_events where user_id=v_uid and event_type='value_action';
  if v_onboard is null or v_value is null then return false; end if;
  v_when:=greatest(v_onboard,v_value);
  perform private.vip_growth_event_insert(
    p_miembro,'activated','activated:user:'||v_uid::text,v_when,null,null,'MXN','platform','','',
    jsonb_build_object(
      'definition','onboarding_completed + meaningful_value_action',
      'onboarding_at',v_onboard,'value_action_at',v_value,
      'criteria_version','v196-2026-09-04'
    )
  );
  return true;
end;
$$;
revoke all on function private.vip_growth_maybe_activate(bigint) from public,anon,authenticated;

-- Atribución previa al alta: solo la Edge Function de checkout puede escribirla por external_reference.
create or replace function public.vip_growth_attribution_capture_external(
  p_external_reference text,
  p_attribution jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_external text; v_id uuid;
begin
  v_external:=private.vip_growth_clip(p_external_reference,240);
  if v_external='' then return jsonb_build_object('ok',false,'error','external_reference_requerida'); end if;
  insert into public.vip_growth_attribution(
    external_reference,source,campaign,ad,product_origin,promotion_origin,
    utm_medium,utm_term,utm_content,fbclid,captured_at,metadata
  ) values(
    v_external,
    private.vip_growth_clip(coalesce(p_attribution->>'source',p_attribution->>'utm_source'),120),
    private.vip_growth_clip(coalesce(p_attribution->>'campaign',p_attribution->>'utm_campaign'),180),
    private.vip_growth_clip(coalesce(p_attribution->>'ad',p_attribution->>'utm_content'),180),
    private.vip_growth_clip(p_attribution->>'product_origin',180),
    private.vip_growth_clip(p_attribution->>'promotion_origin',180),
    private.vip_growth_clip(p_attribution->>'utm_medium',120),
    private.vip_growth_clip(p_attribution->>'utm_term',180),
    private.vip_growth_clip(p_attribution->>'utm_content',180),
    private.vip_growth_clip(p_attribution->>'fbclid',240),
    now(),jsonb_build_object('captured_by','checkout_backend')
  )
  on conflict(external_reference) where external_reference is not null and btrim(external_reference)<>''
  do update set
    source=case when excluded.source<>'' then excluded.source else public.vip_growth_attribution.source end,
    campaign=case when excluded.campaign<>'' then excluded.campaign else public.vip_growth_attribution.campaign end,
    ad=case when excluded.ad<>'' then excluded.ad else public.vip_growth_attribution.ad end,
    product_origin=case when excluded.product_origin<>'' then excluded.product_origin else public.vip_growth_attribution.product_origin end,
    promotion_origin=case when excluded.promotion_origin<>'' then excluded.promotion_origin else public.vip_growth_attribution.promotion_origin end,
    utm_medium=case when excluded.utm_medium<>'' then excluded.utm_medium else public.vip_growth_attribution.utm_medium end,
    utm_term=case when excluded.utm_term<>'' then excluded.utm_term else public.vip_growth_attribution.utm_term end,
    utm_content=case when excluded.utm_content<>'' then excluded.utm_content else public.vip_growth_attribution.utm_content end,
    fbclid=case when excluded.fbclid<>'' then excluded.fbclid else public.vip_growth_attribution.fbclid end,
    captured_at=least(public.vip_growth_attribution.captured_at,excluded.captured_at),updated_at=now()
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end;
$$;
revoke execute on function public.vip_growth_attribution_capture_external(text,jsonb) from public,anon,authenticated;
grant execute on function public.vip_growth_attribution_capture_external(text,jsonb) to service_role;

-- Atribución: solo datos de campaña, nunca secretos ni datos financieros.
create or replace function public.vip_growth_attribution_capture(
  p_codigo text,
  p_whatsapp text,
  p_attribution jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_mid bigint; v_uid uuid; v_external text; v_id uuid;
begin
  v_mid:=public.vip_miembro_activo_id(p_codigo,p_whatsapp);
  if v_mid is null then return jsonb_build_object('ok',false,'error','acceso_no_valido'); end if;
  select finance_identity into v_uid from public.miembros where id=v_mid;
  if v_uid is null then return jsonb_build_object('ok',false,'error','identidad_no_disponible'); end if;
  v_external:=private.vip_growth_clip(p_attribution->>'external_reference',240);
  if v_external<>'' and not exists(
    select 1 from public.vip_mp_suscripciones s
    where s.external_reference=v_external and s.miembro_id=v_mid
  ) then
    v_external:='';
  end if;
  insert into public.vip_growth_attribution(
    external_reference,user_id,miembro_id,source,campaign,ad,product_origin,promotion_origin,
    utm_medium,utm_term,utm_content,fbclid,captured_at,linked_at,metadata
  ) values(
    nullif(v_external,''),v_uid,v_mid,
    private.vip_growth_clip(coalesce(p_attribution->>'source',p_attribution->>'utm_source'),120),
    private.vip_growth_clip(coalesce(p_attribution->>'campaign',p_attribution->>'utm_campaign'),180),
    private.vip_growth_clip(coalesce(p_attribution->>'ad',p_attribution->>'utm_content'),180),
    private.vip_growth_clip(p_attribution->>'product_origin',180),
    private.vip_growth_clip(p_attribution->>'promotion_origin',180),
    private.vip_growth_clip(p_attribution->>'utm_medium',120),
    private.vip_growth_clip(p_attribution->>'utm_term',180),
    private.vip_growth_clip(p_attribution->>'utm_content',180),
    private.vip_growth_clip(p_attribution->>'fbclid',240),
    now(),now(),jsonb_build_object('captured_by','member_session')
  )
  on conflict(external_reference) where external_reference is not null and btrim(external_reference)<>''
  do update set
    user_id=excluded.user_id,miembro_id=excluded.miembro_id,linked_at=coalesce(public.vip_growth_attribution.linked_at,now()),updated_at=now()
  returning id into v_id;

  -- Si el webhook creó eventos antes de que la clienta regresara/iniciara sesión, completa solo campos vacíos.
  update public.vip_growth_events g
     set source=case when g.source='' then private.vip_growth_clip(coalesce(p_attribution->>'source',p_attribution->>'utm_source'),120) else g.source end,
         campaign=case when g.campaign='' then private.vip_growth_clip(coalesce(p_attribution->>'campaign',p_attribution->>'utm_campaign'),180) else g.campaign end,
         ad=case when g.ad='' then private.vip_growth_clip(coalesce(p_attribution->>'ad',p_attribution->>'utm_content'),180) else g.ad end,
         product_origin=case when g.product_origin='' then private.vip_growth_clip(p_attribution->>'product_origin',180) else g.product_origin end,
         promotion_origin=case when g.promotion_origin='' then private.vip_growth_clip(p_attribution->>'promotion_origin',180) else g.promotion_origin end
   where g.user_id=v_uid;

  return jsonb_build_object('ok',true,'id',v_id,'user_id',v_uid);
end;
$$;
revoke execute on function public.vip_growth_attribution_capture(text,text,jsonb) from public;
grant execute on function public.vip_growth_attribution_capture(text,text,jsonb) to anon,authenticated;

create or replace function public.vip_growth_value_action(
  p_codigo text,
  p_whatsapp text,
  p_action text,
  p_reference text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_mid bigint; v_uid uuid; v_action text; v_ref text;
begin
  v_mid:=public.vip_miembro_activo_id(p_codigo,p_whatsapp);
  if v_mid is null then return jsonb_build_object('ok',false,'error','acceso_no_valido'); end if;
  select finance_identity into v_uid from public.miembros where id=v_mid;
  v_action:=private.vip_growth_clip(p_action,80);
  v_ref:=private.vip_growth_clip(p_reference,180);
  if v_action<>'tool_result_saved' or v_ref='' then
    return jsonb_build_object('ok',false,'error','accion_no_permitida');
  end if;
  if octet_length(coalesce(p_metadata,'{}'::jsonb)::text)>4096 then
    return jsonb_build_object('ok',false,'error','metadata_demasiado_grande');
  end if;
  perform private.vip_growth_event_insert(
    v_mid,'value_action','value_action:user:'||v_uid::text||':'||v_action||':'||v_ref,now(),null,null,'MXN','platform','','',
    jsonb_build_object('action',v_action,'reference',v_ref,'tool',private.vip_growth_clip(p_metadata->>'tool',80))
  );
  perform private.vip_growth_maybe_activate(v_mid);
  return jsonb_build_object('ok',true,'activated',exists(select 1 from public.vip_growth_events where user_id=v_uid and event_type='activated'));
end;
$$;
revoke execute on function public.vip_growth_value_action(text,text,text,text,jsonb) from public;
grant execute on function public.vip_growth_value_action(text,text,text,text,jsonb) to anon,authenticated;

-- Onboarding: negocio + diagnóstico/ruta inicial con etapa y objetivo.
create or replace function private.vip_growth_maybe_onboarding(p_miembro bigint)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_uid uuid; v_route public.my_rutas%rowtype; v_business public.my_negocios%rowtype; v_completed_at timestamptz;
begin
  select finance_identity into v_uid from public.miembros where id=p_miembro;
  if v_uid is null then return false; end if;
  if exists(select 1 from public.vip_growth_events where user_id=v_uid and event_type='onboarding_completed') then return true; end if;
  select * into v_business from public.my_negocios n where n.miembro_id=p_miembro limit 1;
  if v_business.miembro_id is null or btrim(coalesce(v_business.tipo,''))='' or btrim(coalesce(v_business.modelo,''))='' then return false; end if;
  select * into v_route from public.my_rutas r where r.miembro_id=p_miembro limit 1;
  if v_route.miembro_id is null or btrim(coalesce(v_route.etapa,''))='' or btrim(coalesce(v_route.objetivo,''))=''
     or coalesce(v_route.diagnostico,'{}'::jsonb)='{}'::jsonb then return false; end if;
  -- El onboarding se considera terminado cuando AMBAS piezas existen; usamos la más reciente.
  v_completed_at:=greatest(
    coalesce(v_route.actualizado_en,v_route.creado_en,'epoch'::timestamptz),
    coalesce(v_business.actualizado_en,v_business.creado_en,'epoch'::timestamptz)
  );
  if v_completed_at='epoch'::timestamptz then v_completed_at:=now(); end if;
  perform private.vip_growth_event_insert(
    p_miembro,'onboarding_completed','onboarding_completed:user:'||v_uid::text,
    v_completed_at,null,null,'MXN','platform','','',
    jsonb_build_object('route_version',v_route.version,'stage',v_route.etapa,'goal',v_route.objetivo,'business_type',v_business.tipo,'business_model',v_business.modelo)
  );
  return true;
end;
$$;
revoke all on function private.vip_growth_maybe_onboarding(bigint) from public,anon,authenticated;

create or replace function private.vip_growth_route_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_done boolean:=false; v_uid uuid;
begin
  perform private.vip_growth_maybe_onboarding(NEW.miembro_id);
  if jsonb_typeof(coalesce(NEW.tareas,'[]'::jsonb))='array' then
    select exists(select 1 from jsonb_array_elements(NEW.tareas) x where lower(coalesce(x->>'done','false'))='true') into v_done;
  end if;
  if v_done then
    select finance_identity into v_uid from public.miembros where id=NEW.miembro_id;
    perform private.vip_growth_event_insert(
      NEW.miembro_id,'value_action','value_action:user:'||v_uid::text||':route:first_done',
      coalesce(NEW.actualizado_en,now()),null,null,'MXN','platform','','',
      jsonb_build_object('action','route_step_completed')
    );
  end if;
  perform private.vip_growth_maybe_activate(NEW.miembro_id);
  return NEW;
end;
$$;
revoke all on function private.vip_growth_route_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_route on public.my_rutas;
create trigger trg_vip_growth_route after insert or update of etapa,objetivo,diagnostico,tareas
on public.my_rutas for each row execute function private.vip_growth_route_trigger();

create or replace function private.vip_growth_business_onboarding_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
begin
  perform private.vip_growth_maybe_onboarding(NEW.miembro_id);
  perform private.vip_growth_maybe_activate(NEW.miembro_id);
  return NEW;
end;
$$;
revoke all on function private.vip_growth_business_onboarding_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_business_onboarding on public.my_negocios;
create trigger trg_vip_growth_business_onboarding after insert or update of tipo,modelo
on public.my_negocios for each row execute function private.vip_growth_business_onboarding_trigger();

create or replace function private.vip_growth_business_value_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_mid bigint; v_uid uuid; v_ref text; v_action text; v_when timestamptz;
begin
  v_mid:=NEW.miembro_id;
  select finance_identity into v_uid from public.miembros where id=v_mid;
  if v_uid is null then return NEW; end if;
  v_action:=case TG_TABLE_NAME
    when 'my_productos_servicios' then 'product_or_service_created'
    when 'my_clientes' then 'client_created'
    when 'my_cotizaciones' then 'quote_created'
    when 'my_operaciones' then 'operation_created'
    when 'my_pagos' then 'business_payment_recorded'
    else TG_TABLE_NAME
  end;
  v_ref:=coalesce(NEW.id::text,txid_current()::text);
  v_when:=coalesce(NEW.creado_en,now());
  perform private.vip_growth_event_insert(
    v_mid,'value_action','value_action:user:'||v_uid::text||':'||v_action||':'||v_ref,
    v_when,null,null,'MXN','platform','','',jsonb_build_object('action',v_action,'table',TG_TABLE_NAME)
  );
  perform private.vip_growth_maybe_activate(v_mid);
  return NEW;
end;
$$;
revoke all on function private.vip_growth_business_value_trigger() from public,anon,authenticated;

-- Solo INSERT: una edición posterior no crea otra acción de valor.
drop trigger if exists trg_vip_growth_product on public.my_productos_servicios;
create trigger trg_vip_growth_product after insert on public.my_productos_servicios
for each row execute function private.vip_growth_business_value_trigger();
drop trigger if exists trg_vip_growth_client on public.my_clientes;
create trigger trg_vip_growth_client after insert on public.my_clientes
for each row execute function private.vip_growth_business_value_trigger();
drop trigger if exists trg_vip_growth_quote on public.my_cotizaciones;
create trigger trg_vip_growth_quote after insert on public.my_cotizaciones
for each row execute function private.vip_growth_business_value_trigger();
drop trigger if exists trg_vip_growth_operation on public.my_operaciones;
create trigger trg_vip_growth_operation after insert on public.my_operaciones
for each row execute function private.vip_growth_business_value_trigger();
drop trigger if exists trg_vip_growth_business_payment on public.my_pagos;
create trigger trg_vip_growth_business_payment after insert on public.my_pagos
for each row execute function private.vip_growth_business_value_trigger();

create or replace function private.vip_growth_member_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
begin
  perform private.vip_growth_event_insert(
    NEW.id,'registered','registered:member:'||NEW.id::text,
    coalesce(NEW.creado_en,now()),NEW.plan,null,'MXN','platform','','',
    jsonb_build_object('member_created',true)
  );
  return NEW;
end;
$$;
revoke all on function private.vip_growth_member_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_member_insert on public.miembros;
create trigger trg_vip_growth_member_insert after insert on public.miembros
for each row execute function private.vip_growth_member_trigger();
drop trigger if exists trg_vip_growth_member_plan on public.miembros;

-- Al purgar una cuenta después de la retención vigente, conserva analítica agregable pero retira identificadores replicados.
create or replace function private.vip_growth_member_privacy_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
begin
  delete from public.vip_growth_attribution
   where miembro_id=OLD.id or user_id=OLD.finance_identity;
  update public.vip_growth_events
     set miembro_id=null,
         provider_payment_id='',
         provider_subscription_id='',
         metadata=(coalesce(metadata,'{}'::jsonb)-'external_reference'-'reference'-'payment_id'-'subscription_id')
   where user_id=OLD.finance_identity;
  return OLD;
end;
$$;
revoke all on function private.vip_growth_member_privacy_trigger() from public,anon,authenticated;
drop trigger if exists trg_vip_growth_member_privacy on public.miembros;
create trigger trg_vip_growth_member_privacy before delete on public.miembros
for each row execute function private.vip_growth_member_privacy_trigger();

-- Upgrade: usa el historial canónico de cambios de plan, no un cambio directo de la fila miembros.
create or replace function private.vip_growth_plan_change_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_old_rank int; v_new_rank int;
begin
  if NEW.estado<>'aplicado' then return NEW; end if;
  if TG_OP='UPDATE' and OLD.estado='aplicado' then return NEW; end if;
  v_old_rank:=case NEW.plan_anterior when 'VIP' then 1 when 'VIP Pro' then 2 else 0 end;
  v_new_rank:=case NEW.plan_nuevo when 'VIP' then 1 when 'VIP Pro' then 2 else 0 end;
  if v_old_rank>=1 and v_new_rank>v_old_rank then
    perform private.vip_growth_event_insert(
      NEW.miembro_id,'plan_upgraded','plan_upgraded:change:'||NEW.id::text,
      coalesce(NEW.aplicado_en,NEW.creado_en,now()),NEW.plan_nuevo,coalesce(NEW.diferencia,0),'MXN','backend','','',
      jsonb_build_object('from_plan',NEW.plan_anterior,'to_plan',NEW.plan_nuevo,'change_type',NEW.tipo,'difference',NEW.diferencia)
    );
  end if;
  return NEW;
end;
$$;
revoke all on function private.vip_growth_plan_change_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_plan_change on public.vip_cambios_plan;
create trigger trg_vip_growth_plan_change after insert or update of estado,aplicado_en
on public.vip_cambios_plan for each row execute function private.vip_growth_plan_change_trigger();

-- Mercado Pago/trial: el evento nace de la fila que actualiza el webhook, no del navegador.
create or replace function private.vip_growth_mp_subscription_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_mid bigint; v_uid uuid;
begin
  v_mid:=NEW.miembro_id;
  if v_mid is null then return NEW; end if;
  perform private.vip_growth_link_attribution(v_mid,NEW.external_reference);
  select finance_identity into v_uid from public.miembros where id=v_mid;

  if NEW.trial_activado_at is not null and (TG_OP='INSERT' or OLD.trial_activado_at is null) then
    perform private.vip_growth_event_insert(
      v_mid,'trial_started','trial_started:mp_subscription:'||NEW.id::text,
      NEW.trial_activado_at,NEW.plan_key,0,NEW.moneda,'mercadopago','',coalesce(NEW.mp_preapproval_id,''),
      jsonb_build_object('trial_days',NEW.trial_dias,'promotion_id',NEW.trial_promocion_id,'external_reference',NEW.external_reference)
    );
  end if;

  if NEW.trial_activado_at is not null and NEW.first_payment_at is null
     and (NEW.cancelled_at is not null or lower(coalesce(NEW.estado,''))='cancelled')
     and (TG_OP='INSERT' or OLD.cancelled_at is null or OLD.estado is distinct from NEW.estado) then
    perform private.vip_growth_event_insert(
      v_mid,'trial_cancelled','trial_cancelled:mp_subscription:'||NEW.id::text,
      coalesce(NEW.cancelled_at,now()),NEW.plan_key,0,NEW.moneda,'mercadopago','',coalesce(NEW.mp_preapproval_id,''),
      jsonb_build_object('trial_days',NEW.trial_dias,'external_reference',NEW.external_reference)
    );
  end if;
  return NEW;
end;
$$;
revoke all on function private.vip_growth_mp_subscription_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_mp_subscription on public.vip_mp_suscripciones;
create trigger trg_vip_growth_mp_subscription after insert or update of trial_activado_at,cancelled_at,estado,miembro_id
on public.vip_mp_suscripciones for each row execute function private.vip_growth_mp_subscription_trigger();

-- Fallo financiero MP: nace del pago rechazado que el webhook ya guardó.
create or replace function private.vip_growth_mp_payment_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
begin
  if NEW.miembro_id is null or lower(coalesce(NEW.estado,''))<>'rejected' then return NEW; end if;
  perform private.vip_growth_event_insert(
    NEW.miembro_id,'payment_failed','payment_failed:mp_payment:'||NEW.mp_payment_id,
    coalesce(NEW.fecha_creado,NEW.actualizado_en,now()),null,NEW.monto_bruto,NEW.moneda,'mercadopago',
    NEW.mp_payment_id,coalesce(NEW.mp_preapproval_id,''),
    jsonb_build_object('status',NEW.estado,'status_detail',NEW.estado_detalle,'external_reference',NEW.external_reference)
  );
  return NEW;
end;
$$;
revoke all on function private.vip_growth_mp_payment_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_mp_payment on public.vip_mp_pagos;
create trigger trg_vip_growth_mp_payment after insert or update of estado,miembro_id
on public.vip_mp_pagos for each row execute function private.vip_growth_mp_payment_trigger();

-- Pago de membresía: la fuente de verdad ya es vip_pago_movimientos.
create or replace function private.vip_growth_membership_payment_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_event text; v_provider text; v_sub text; v_pay text; v_currency text:='MXN';
begin
  -- Los fallos manuales y MP nacen de una tabla backend. Si MP ya creó el evento desde vip_mp_pagos,
  -- reutilizamos exactamente la misma clave para que el UNIQUE haga la operación idempotente.
  if NEW.estado='rechazado' and NEW.tipo='rechazado' then
    v_provider:=case when NEW.canal_cobro='mercado_pago' or NEW.proveedor_pago='mercado_pago' then 'mercadopago' else coalesce(nullif(NEW.proveedor_pago,''),'manual') end;
    v_pay:=coalesce(NEW.proveedor_payment_id,NEW.referencia,'');
    v_sub:=coalesce(NEW.proveedor_subscription_id,'');
    perform private.vip_growth_event_insert(
      NEW.miembro_id,'payment_failed',
      case when v_provider='mercadopago' and v_pay<>'' then 'payment_failed:mp_payment:'||v_pay else 'payment_failed:membership_movement:'||NEW.id::text end,
      coalesce(NEW.fecha_pago::timestamp at time zone 'America/Mexico_City',NEW.creado_en,now()),
      NEW.plan,NEW.monto,'MXN',v_provider,v_pay,v_sub,
      jsonb_build_object('payment_movement_id',NEW.id,'payment_channel',NEW.canal_cobro,'payment_method',NEW.metodo_pago,'sale_origin',NEW.origen_venta)
    );
    return NEW;
  end if;

  -- Una cancelación manual confirmada también es evento financiero backend; MP usa el control canónico
  -- de membresía y por ello no pasa por esta rama.
  if NEW.estado='cancelado' and NEW.tipo='cancelado' then
    if exists(select 1 from public.vip_growth_events e where e.miembro_id=NEW.miembro_id and e.event_type='subscription_started') then
      perform private.vip_growth_event_insert(
        NEW.miembro_id,'subscription_cancelled','subscription_cancelled:membership_movement:'||NEW.id::text,
        coalesce(NEW.fecha_pago::timestamp at time zone 'America/Mexico_City',NEW.creado_en,now()),
        NEW.plan,null,'MXN','manual',coalesce(NEW.proveedor_payment_id,NEW.referencia,''),coalesce(NEW.proveedor_subscription_id,''),
        jsonb_build_object('payment_movement_id',NEW.id,'payment_method',NEW.metodo_pago,'sale_origin',NEW.origen_venta)
      );
    end if;
    return NEW;
  end if;

  if NEW.estado<>'aprobado' or NEW.tipo not in ('primer_pago','renovacion') then return NEW; end if;
  if NEW.tipo='renovacion' or NEW.clasificacion_suscripcion='renovacion' then v_event:='subscription_renewed';
  else v_event:='subscription_started'; end if;
  v_provider:=case when NEW.canal_cobro='mercado_pago' then 'mercadopago' else coalesce(nullif(NEW.proveedor_pago,''),'manual') end;
  v_sub:=coalesce(NEW.proveedor_subscription_id,'');
  v_pay:=coalesce(NEW.proveedor_payment_id,NEW.referencia,'');
  perform private.vip_growth_event_insert(
    NEW.miembro_id,v_event,v_event||':membership_payment:'||NEW.id::text,
    coalesce(NEW.fecha_pago::timestamp at time zone 'America/Mexico_City',NEW.creado_en,now()),
    NEW.plan,NEW.monto,v_currency,v_provider,v_pay,v_sub,
    jsonb_build_object(
      'payment_movement_id',NEW.id,'classification',NEW.clasificacion_suscripcion,
      'payment_channel',NEW.canal_cobro,'payment_method',NEW.metodo_pago,
      'processor_fee',NEW.comision_procesador,'processor_net',NEW.neto_procesador,
      'sale_origin',NEW.origen_venta,'source',NEW.origen_venta
    )
  );
  return NEW;
end;
$$;
revoke all on function private.vip_growth_membership_payment_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_membership_payment on public.vip_pago_movimientos;
create trigger trg_vip_growth_membership_payment after insert or update of estado,tipo,clasificacion_suscripcion,proveedor_payment_id
on public.vip_pago_movimientos for each row execute function private.vip_growth_membership_payment_trigger();

-- Fallo/cancelación: derivados del control de membresía que ya maneja Mercado Pago/retención.
create or replace function private.vip_growth_membership_control_trigger()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare v_mid bigint; v_plan text; v_uid uuid; v_provider text:='backend'; v_subscription text:='';
begin
  begin v_mid:=NEW.member_id::bigint; exception when others then return NEW; end;
  select finance_identity,plan into v_uid,v_plan from public.miembros where id=v_mid;
  select coalesce(s.mp_preapproval_id,'') into v_subscription
  from public.vip_mp_suscripciones s where s.miembro_id=v_mid
  order by coalesce(s.last_payment_at,s.trial_activado_at,s.creado_en) desc limit 1;
  if coalesce(v_subscription,'')<>'' then v_provider:='mercadopago'; end if;
  if v_uid is null then return NEW; end if;


  if NEW.cancelled_at is not null
     and exists(select 1 from public.vip_growth_events e where e.user_id=v_uid and e.event_type='subscription_started' and e.occurred_at<=NEW.cancelled_at)
     and (TG_OP='INSERT' or OLD.cancelled_at is null or OLD.cancelled_at is distinct from NEW.cancelled_at) then
    perform private.vip_growth_event_insert(
      v_mid,'subscription_cancelled',
      'subscription_cancelled:member:'||v_mid::text||':'||extract(epoch from NEW.cancelled_at)::bigint::text,
      NEW.cancelled_at,coalesce(NEW.plan_key,v_plan),null,'MXN',v_provider,'',coalesce(v_subscription,''),
      jsonb_build_object('effective_end',NEW.next_renewal,'status',NEW.status)
    );
  end if;
  return NEW;
end;
$$;
revoke all on function private.vip_growth_membership_control_trigger() from public,anon,authenticated;

drop trigger if exists trg_vip_growth_membership_control on public.vip_control_membresias;
create trigger trg_vip_growth_membership_control after insert or update of status,grace_until,cancelled_at
on public.vip_control_membresias for each row execute function private.vip_growth_membership_control_trigger();

-- Panel exclusivo de la propietaria.
create or replace function public.vip_growth_admin_panel(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_filtros jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path='pg_catalog','public','private','extensions','pg_temp'
as $$
declare
  v_access jsonb; v_from timestamptz; v_to timestamptz; v_plan text; v_source text; v_campaign text; v_ad text; v_product text;
  v_registered bigint; v_trials bigint; v_onboard bigint; v_activated bigint; v_started bigint; v_renew_events bigint;
  v_cancel bigint; v_trial_cancel bigint; v_subscription_cancel bigint; v_failed bigint; v_upgrades bigint; v_trial_cohort bigint; v_trial_paid bigint;
  v_eligible bigint; v_renewed_users bigint; v_sources jsonb; v_plans jsonb; v_campaigns jsonb; v_ads jsonb; v_products jsonb;
begin
  v_access:=public.vip_equipo_mi_acceso();
  if coalesce(v_access->>'rol','')<>'duena' then raise exception 'No autorizado' using errcode='42501'; end if;
  v_from:=coalesce(p_desde,date_trunc('day',now())); v_to:=coalesce(p_hasta,now());
  if v_to<=v_from or v_to-v_from>interval '3 years' then raise exception 'Periodo no válido' using errcode='22023'; end if;
  v_plan:=nullif(btrim(coalesce(p_filtros->>'plan','')),'');
  v_source:=nullif(btrim(coalesce(p_filtros->>'source','')),'');
  v_campaign:=nullif(btrim(coalesce(p_filtros->>'campaign','')),'');
  v_ad:=nullif(btrim(coalesce(p_filtros->>'ad','')),'');
  v_product:=nullif(btrim(coalesce(p_filtros->>'product_origin','')),'');

  with e as (
    select * from public.vip_growth_events g
    where g.occurred_at>=v_from and g.occurred_at<v_to
      and (v_plan is null or g.plan_key=v_plan)
      and (v_source is null or g.source=v_source)
      and (v_campaign is null or g.campaign=v_campaign)
      and (v_ad is null or g.ad=v_ad)
      and (v_product is null or g.product_origin=v_product)
  )
  select
    count(distinct user_id) filter(where event_type='registered'),
    count(distinct user_id) filter(where event_type='trial_started'),
    count(distinct user_id) filter(where event_type='onboarding_completed'),
    count(distinct user_id) filter(where event_type='activated'),
    count(distinct user_id) filter(where event_type='subscription_started'),
    count(*) filter(where event_type='subscription_renewed'),
    count(*) filter(where event_type in ('trial_cancelled','subscription_cancelled')),
    count(*) filter(where event_type='trial_cancelled'),
    count(*) filter(where event_type='subscription_cancelled'),
    count(*) filter(where event_type='payment_failed'),
    count(*) filter(where event_type='plan_upgraded')
  into v_registered,v_trials,v_onboard,v_activated,v_started,v_renew_events,v_cancel,v_trial_cancel,v_subscription_cancel,v_failed,v_upgrades
  from e;

  -- Conversión usa únicamente cohortes de prueba que ya terminaron prueba + 3 días de gracia.
  with cohort as (
    select distinct user_id from public.vip_growth_events g
    where event_type='trial_started' and occurred_at>=v_from and occurred_at<v_to
      and occurred_at + make_interval(days=>greatest(1,least(coalesce(nullif(g.metadata->>'trial_days','')::int,21),90))+3) <= v_to
      and (v_plan is null or g.plan_key=v_plan)
      and (v_source is null or g.source=v_source)
      and (v_campaign is null or g.campaign=v_campaign)
      and (v_ad is null or g.ad=v_ad)
      and (v_product is null or g.product_origin=v_product)
  )
  select count(*),count(*) filter(where exists(
    select 1 from public.vip_growth_events p where p.user_id=cohort.user_id and p.event_type='subscription_started' and p.occurred_at<v_to
  )) into v_trial_cohort,v_trial_paid from cohort;

  -- Primera renovación: solo quienes ya alcanzaron 30 días + 3 días de gracia.
  with eligible as (
    select distinct user_id from public.vip_growth_events s
    where s.event_type='subscription_started' and s.occurred_at>=v_from and s.occurred_at < v_to-interval '33 days'
      and (v_plan is null or s.plan_key=v_plan)
      and (v_source is null or s.source=v_source)
      and (v_campaign is null or s.campaign=v_campaign)
      and (v_ad is null or s.ad=v_ad)
      and (v_product is null or s.product_origin=v_product)
  )
  select count(*),count(*) filter(where exists(
    select 1 from public.vip_growth_events r where r.user_id=eligible.user_id and r.event_type='subscription_renewed' and r.occurred_at<v_to
  )) into v_eligible,v_renewed_users from eligible;

  select coalesce(jsonb_agg(jsonb_build_object('source',source,'users',users) order by users desc),'[]'::jsonb)
  into v_sources from (
    select coalesce(nullif(source,''),'Sin fuente') source,count(distinct user_id) users
    from public.vip_growth_events
    where occurred_at>=v_from and occurred_at<v_to and event_type in ('trial_started','subscription_started')
      and (v_plan is null or plan_key=v_plan) and (v_source is null or source=v_source)
      and (v_campaign is null or campaign=v_campaign) and (v_ad is null or ad=v_ad)
      and (v_product is null or product_origin=v_product)
    group by 1 order by 2 desc limit 12
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('plan',plan_key,'users',users) order by users desc),'[]'::jsonb)
  into v_plans from (
    select coalesce(nullif(plan_key,''),'Sin plan') plan_key,count(distinct user_id) users
    from public.vip_growth_events
    where occurred_at>=v_from and occurred_at<v_to and event_type in ('trial_started','subscription_started','subscription_renewed')
      and (v_plan is null or plan_key=v_plan) and (v_source is null or source=v_source)
      and (v_campaign is null or campaign=v_campaign) and (v_ad is null or ad=v_ad)
      and (v_product is null or product_origin=v_product)
    group by 1 order by 2 desc limit 12
  ) p;

  select coalesce(jsonb_agg(jsonb_build_object('campaign',campaign,'users',users) order by users desc),'[]'::jsonb)
  into v_campaigns from (
    select coalesce(nullif(campaign,''),'Sin campaña') campaign,count(distinct user_id) users
    from public.vip_growth_events
    where occurred_at>=v_from and occurred_at<v_to and event_type in ('trial_started','subscription_started')
      and (v_plan is null or plan_key=v_plan) and (v_source is null or source=v_source)
      and (v_campaign is null or campaign=v_campaign) and (v_ad is null or ad=v_ad)
      and (v_product is null or product_origin=v_product)
    group by 1 order by 2 desc limit 12
  ) c;

  select coalesce(jsonb_agg(jsonb_build_object('ad',ad,'users',users) order by users desc),'[]'::jsonb)
  into v_ads from (
    select coalesce(nullif(ad,''),'Sin anuncio') ad,count(distinct user_id) users
    from public.vip_growth_events
    where occurred_at>=v_from and occurred_at<v_to and event_type in ('trial_started','subscription_started')
      and (v_plan is null or plan_key=v_plan) and (v_source is null or source=v_source)
      and (v_campaign is null or campaign=v_campaign) and (v_ad is null or ad=v_ad)
      and (v_product is null or product_origin=v_product)
    group by 1 order by 2 desc limit 12
  ) a;

  select coalesce(jsonb_agg(jsonb_build_object('product',product_origin,'users',users) order by users desc),'[]'::jsonb)
  into v_products from (
    select coalesce(nullif(product_origin,''),'Sin producto de origen') product_origin,count(distinct user_id) users
    from public.vip_growth_events
    where occurred_at>=v_from and occurred_at<v_to and event_type in ('trial_started','subscription_started')
      and (v_plan is null or plan_key=v_plan) and (v_source is null or source=v_source)
      and (v_campaign is null or campaign=v_campaign) and (v_ad is null or ad=v_ad)
      and (v_product is null or product_origin=v_product)
    group by 1 order by 2 desc limit 12
  ) pr;

  return jsonb_build_object(
    'ok',true,'from',v_from,'to',v_to,'filters',coalesce(p_filtros,'{}'::jsonb),
    'kpis',jsonb_build_object(
      'registered',coalesce(v_registered,0),'trial_started',coalesce(v_trials,0),
      'onboarding_completed',coalesce(v_onboard,0),'activated',coalesce(v_activated,0),
      'subscription_started',coalesce(v_started,0),'subscription_renewed',coalesce(v_renew_events,0),
      'cancelled',coalesce(v_cancel,0),'trial_cancelled',coalesce(v_trial_cancel,0),'subscription_cancelled',coalesce(v_subscription_cancel,0),'payment_failed',coalesce(v_failed,0),'plan_upgraded',coalesce(v_upgrades,0),
      'trial_to_paid_pct',case when coalesce(v_trial_cohort,0)>0 then round(v_trial_paid::numeric*100/v_trial_cohort,1) else 0 end,
      'first_renewal_retention_pct',case when coalesce(v_eligible,0)>0 then round(v_renewed_users::numeric*100/v_eligible,1) else 0 end
    ),
    'funnel',jsonb_build_array(
      jsonb_build_object('key','registered','label','Registros','value',coalesce(v_registered,0)),
      jsonb_build_object('key','trial_started','label','Prueba iniciada','value',coalesce(v_trials,0)),
      jsonb_build_object('key','onboarding_completed','label','Onboarding completado','value',coalesce(v_onboard,0)),
      jsonb_build_object('key','activated','label','Activada','value',coalesce(v_activated,0)),
      jsonb_build_object('key','subscription_started','label','Suscripción pagada','value',coalesce(v_started,0)),
      jsonb_build_object('key','subscription_renewed','label','Renovó','value',coalesce(v_renew_events,0))
    ),
    'segments',jsonb_build_object('sources',v_sources,'campaigns',v_campaigns,'ads',v_ads,'products',v_products,'plans',v_plans),
    'activation_definition',jsonb_build_object(
      'version','v196-2026-09-04',
      'requires_onboarding',true,
      'value_actions',jsonb_build_array('product_or_service_created','client_created','quote_created','operation_created','business_payment_recorded','route_step_completed','tool_result_saved')
    )
  );
end;
$$;
revoke execute on function public.vip_growth_admin_panel(timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.vip_growth_admin_panel(timestamptz,timestamptz,jsonb) to authenticated;

-- BACKFILL no destructivo: registra eventos reconstruibles sin alterar tablas origen.
insert into public.vip_growth_events(user_id,miembro_id,occurred_at,event_type,plan_key,idempotency_key,metadata)
select m.finance_identity,m.id,coalesce(m.creado_en,now()),'registered',coalesce(m.plan,''),'registered:member:'||m.id::text,jsonb_build_object('backfill',true)
from public.miembros m
on conflict(idempotency_key) do nothing;

insert into public.vip_growth_events(user_id,miembro_id,occurred_at,event_type,plan_key,idempotency_key,metadata)
select m.finance_identity,r.miembro_id,
       greatest(coalesce(r.actualizado_en,r.creado_en,'epoch'::timestamptz),coalesce(n.actualizado_en,n.creado_en,'epoch'::timestamptz)),
       'onboarding_completed',coalesce(m.plan,''),
       'onboarding_completed:user:'||m.finance_identity::text,
       jsonb_build_object('backfill',true,'route_version',r.version,'stage',r.etapa,'goal',r.objetivo,'business_type',n.tipo,'business_model',n.modelo)
from public.my_rutas r
join public.my_negocios n on n.miembro_id=r.miembro_id
join public.miembros m on m.id=r.miembro_id
where btrim(coalesce(r.etapa,''))<>'' and btrim(coalesce(r.objetivo,''))<>'' and coalesce(r.diagnostico,'{}'::jsonb)<>'{}'::jsonb
  and btrim(coalesce(n.tipo,''))<>'' and btrim(coalesce(n.modelo,''))<>''
on conflict(idempotency_key) do nothing;

with actions as (
  select miembro_id, min(creado_en) at from public.my_productos_servicios group by miembro_id
  union all select miembro_id,min(creado_en) from public.my_clientes group by miembro_id
  union all select miembro_id,min(creado_en) from public.my_cotizaciones group by miembro_id
  union all select miembro_id,min(creado_en) from public.my_operaciones group by miembro_id
  union all select miembro_id,min(creado_en) from public.my_pagos group by miembro_id
), first_action as (
  select miembro_id,min(at) at from actions group by miembro_id
)
insert into public.vip_growth_events(user_id,miembro_id,occurred_at,event_type,plan_key,idempotency_key,metadata)
select m.finance_identity,a.miembro_id,coalesce(a.at,now()),'value_action',coalesce(m.plan,''),
       'value_action:user:'||m.finance_identity::text||':historical:first',jsonb_build_object('action','historical_business_value','backfill',true)
from first_action a join public.miembros m on m.id=a.miembro_id
on conflict(idempotency_key) do nothing;

insert into public.vip_growth_events(
  user_id,miembro_id,occurred_at,event_type,plan_key,monetary_value,currency,provider,provider_payment_id,provider_subscription_id,idempotency_key,metadata
)
select m.finance_identity,p.miembro_id,
       coalesce(p.fecha_pago::timestamp at time zone 'America/Mexico_City',p.creado_en,now()),
       case when p.tipo='renovacion' or p.clasificacion_suscripcion='renovacion' then 'subscription_renewed' else 'subscription_started' end,
       coalesce(p.plan,m.plan,''),p.monto,'MXN',
       case when p.canal_cobro='mercado_pago' then 'mercadopago' else coalesce(nullif(p.proveedor_pago,''),'manual') end,
       coalesce(p.proveedor_payment_id,p.referencia,''),coalesce(p.proveedor_subscription_id,''),
       (case when p.tipo='renovacion' or p.clasificacion_suscripcion='renovacion' then 'subscription_renewed' else 'subscription_started' end)||':membership_payment:'||p.id::text,
       jsonb_build_object('backfill',true,'classification',p.clasificacion_suscripcion,'payment_channel',p.canal_cobro)
from public.vip_pago_movimientos p join public.miembros m on m.id=p.miembro_id
where p.estado='aprobado' and p.tipo in ('primer_pago','renovacion')
on conflict(idempotency_key) do nothing;

insert into public.vip_growth_events(
  user_id,miembro_id,occurred_at,event_type,plan_key,monetary_value,currency,provider,provider_subscription_id,idempotency_key,metadata
)
select m.finance_identity,s.miembro_id,s.trial_activado_at,'trial_started',coalesce(s.plan_key,m.plan,''),0,coalesce(s.moneda,'MXN'),'mercadopago',coalesce(s.mp_preapproval_id,''),
       'trial_started:mp_subscription:'||s.id::text,
       jsonb_build_object('backfill',true,'trial_days',s.trial_dias,'promotion_id',s.trial_promocion_id,'external_reference',s.external_reference)
from public.vip_mp_suscripciones s join public.miembros m on m.id=s.miembro_id
where s.trial_activado_at is not null
on conflict(idempotency_key) do nothing;

-- Backfill de eventos adicionales únicamente cuando la evidencia existe.
insert into public.vip_growth_events(
  user_id,miembro_id,occurred_at,event_type,plan_key,monetary_value,currency,provider,provider_payment_id,provider_subscription_id,idempotency_key,metadata
)
select m.finance_identity,p.miembro_id,coalesce(p.fecha_creado,p.actualizado_en,now()),'payment_failed',coalesce(m.plan,''),p.monto_bruto,coalesce(p.moneda,'MXN'),'mercadopago',
       p.mp_payment_id,coalesce(p.mp_preapproval_id,''),'payment_failed:mp_payment:'||p.mp_payment_id,
       jsonb_build_object('backfill',true,'status',p.estado,'status_detail',p.estado_detalle,'external_reference',p.external_reference)
from public.vip_mp_pagos p join public.miembros m on m.id=p.miembro_id
where lower(coalesce(p.estado,''))='rejected'
on conflict(idempotency_key) do nothing;

insert into public.vip_growth_events(
  user_id,miembro_id,occurred_at,event_type,plan_key,monetary_value,currency,provider,provider_payment_id,provider_subscription_id,idempotency_key,metadata
)
select m.finance_identity,p.miembro_id,coalesce(p.fecha_pago::timestamp at time zone 'America/Mexico_City',p.creado_en,now()),
       'payment_failed',coalesce(p.plan,m.plan,''),p.monto,'MXN',
       case when p.canal_cobro='mercado_pago' or p.proveedor_pago='mercado_pago' then 'mercadopago' else coalesce(nullif(p.proveedor_pago,''),'manual') end,
       coalesce(p.proveedor_payment_id,p.referencia,''),coalesce(p.proveedor_subscription_id,''),
       case when (p.canal_cobro='mercado_pago' or p.proveedor_pago='mercado_pago') and coalesce(p.proveedor_payment_id,'')<>''
            then 'payment_failed:mp_payment:'||p.proveedor_payment_id else 'payment_failed:membership_movement:'||p.id::text end,
       jsonb_build_object('backfill',true,'payment_movement_id',p.id,'payment_channel',p.canal_cobro,'payment_method',p.metodo_pago)
from public.vip_pago_movimientos p join public.miembros m on m.id=p.miembro_id
where p.estado='rechazado' and p.tipo='rechazado'
on conflict(idempotency_key) do nothing;

insert into public.vip_growth_events(
  user_id,miembro_id,occurred_at,event_type,plan_key,monetary_value,currency,provider,provider_subscription_id,idempotency_key,metadata
)
select m.finance_identity,s.miembro_id,s.cancelled_at,'trial_cancelled',coalesce(s.plan_key,m.plan,''),0,coalesce(s.moneda,'MXN'),'mercadopago',coalesce(s.mp_preapproval_id,''),
       'trial_cancelled:mp_subscription:'||s.id::text,jsonb_build_object('backfill',true,'trial_days',s.trial_dias,'external_reference',s.external_reference)
from public.vip_mp_suscripciones s join public.miembros m on m.id=s.miembro_id
where s.trial_activado_at is not null and s.first_payment_at is null and s.cancelled_at is not null
on conflict(idempotency_key) do nothing;

insert into public.vip_growth_events(
  user_id,miembro_id,occurred_at,event_type,plan_key,monetary_value,currency,provider,idempotency_key,metadata
)
select m.finance_identity,c.miembro_id,coalesce(c.aplicado_en,c.creado_en,now()),'plan_upgraded',c.plan_nuevo,coalesce(c.diferencia,0),'MXN','backend',
       'plan_upgraded:change:'||c.id::text,jsonb_build_object('backfill',true,'from_plan',c.plan_anterior,'to_plan',c.plan_nuevo,'change_type',c.tipo)
from public.vip_cambios_plan c join public.miembros m on m.id=c.miembro_id
where c.estado='aplicado' and c.plan_anterior='VIP' and c.plan_nuevo='VIP Pro'
on conflict(idempotency_key) do nothing;

insert into public.vip_growth_events(
  user_id,miembro_id,occurred_at,event_type,plan_key,currency,provider,provider_subscription_id,idempotency_key,metadata
)
select m.finance_identity,m.id,c.cancelled_at,'subscription_cancelled',coalesce(c.plan_key,m.plan,''),'MXN',
       case when coalesce(s.mp_preapproval_id,'')<>'' then 'mercadopago' else 'backend' end,coalesce(s.mp_preapproval_id,''),
       'subscription_cancelled:member:'||m.id::text||':'||extract(epoch from c.cancelled_at)::bigint::text,
       jsonb_build_object('backfill',true,'effective_end',c.next_renewal,'status',c.status)
from public.vip_control_membresias c
join public.miembros m on m.id::text=c.member_id
left join lateral (select mp_preapproval_id from public.vip_mp_suscripciones x where x.miembro_id=m.id order by coalesce(x.last_payment_at,x.creado_en) desc limit 1) s on true
where c.cancelled_at is not null
  and exists(select 1 from public.vip_pago_movimientos pm where pm.miembro_id=m.id and pm.estado='aprobado' and pm.tipo='primer_pago' and pm.fecha_pago<=c.cancelled_at::date)
on conflict(idempotency_key) do nothing;

-- Recalcula activación solo a partir de señales ya reconstruidas.
do $$
declare r record;
begin
  for r in select id from public.miembros loop
    perform private.vip_growth_maybe_activate(r.id);
  end loop;
end $$;

-- No se conceden accesos directos a las tablas. Solo RPC autorizados.
comment on table public.vip_growth_events is 'DIAMANTE V196: eventos pseudonimizados del ciclo de suscripción y activación. user_id = finance_identity estable; IDs de proveedor se anonimizan en purga.';
comment on table public.vip_growth_attribution is 'DIAMANTE V196: atribución de adquisición no financiera, vinculada a finance_identity cuando existe.';

commit;
