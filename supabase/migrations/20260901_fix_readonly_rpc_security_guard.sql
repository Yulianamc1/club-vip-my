-- MY · 2026-09-01
-- Registro de la reparación aplicada al proyecto Supabase Club-VIP-mysublimacion.
-- Esta migración YA FUE APLICADA el 2026-09-01. Se conserva en GitHub como historial técnico.
-- El cambio evita que RPCs de solo lectura fallen con HTTP 405 cuando el pre-request
-- de seguridad intenta registrar el rate limit dentro de una transacción READ ONLY.

create or replace function public.vip_api_pre_request_security()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions', 'private', 'pg_temp'
as $function$
declare
  req_method text := current_setting('request.method', true);
  req_path text := coalesce(current_setting('request.path', true),'');
  hdr jsonb;
  jwt jsonb;
  req_role text;
  ip_text text;
  req_ip inet;
  rpc_name text;
  v_bucket text;
  window_interval interval;
  hits bigint;
  max_hits integer;
begin
  if req_method is null or req_method in ('GET','HEAD','OPTIONS') then
    return;
  end if;

  begin
    jwt := nullif(current_setting('request.jwt.claims', true),'')::jsonb;
  exception when others then
    jwt := '{}'::jsonb;
  end;
  req_role := coalesce(jwt->>'role', current_user);
  if req_role not in ('anon','authenticated') then
    return;
  end if;

  -- Las RPC STABLE/IMMUTABLE pueden ejecutarse en transacciones READ ONLY.
  -- En ese caso no intentamos escribir el ledger de rate limits.
  if current_setting('transaction_read_only', true) = 'on' then
    return;
  end if;

  begin
    hdr := nullif(current_setting('request.headers', true),'')::jsonb;
    ip_text := split_part(coalesce(hdr->>'x-forwarded-for',''),',',1);
    req_ip := nullif(btrim(ip_text),'')::inet;
  exception when others then
    req_ip := null;
  end;
  if req_ip is null then
    return;
  end if;

  if req_method='DELETE' then
    v_bucket := case when req_role='authenticated' then 'auth_delete' else 'anon_delete' end;
    max_hits := case when req_role='authenticated' then 15 else 5 end;
    window_interval := interval '10 minutes';
  elsif req_path like '%rpc/%' then
    rpc_name := regexp_replace(req_path, '^.*/rpc/', '');
    rpc_name := split_part(rpc_name,'?',1);

    if req_role='authenticated'
       and rpc_name ~* '(eliminar|purgar|bloquear|revocar|cancelar|anular)' then
      v_bucket := 'auth_destructive_rpc';
      max_hits := 20;
      window_interval := interval '10 minutes';
    elsif req_role='authenticated' then
      v_bucket := 'auth_rpc';
      max_hits := 1200;
      window_interval := interval '5 minutes';
    elsif rpc_name in ('vip_promocion_canjear','vip_promocion_canjear_v2') then
      v_bucket := 'anon_promo';
      max_hits := 20;
      window_interval := interval '10 minutes';
    elsif rpc_name in ('my_solicitud_publica_crear','my_cotizacion_publica_responder') then
      v_bucket := 'anon_public_write';
      max_hits := 60;
      window_interval := interval '5 minutes';
    elsif exists(select 1 from private.vip_sensitive_anon_rpcs s where s.function_name=rpc_name) then
      v_bucket := 'anon_credential';
      max_hits := 120;
      window_interval := interval '5 minutes';
    else
      v_bucket := 'anon_rpc';
      max_hits := 300;
      window_interval := interval '5 minutes';
    end if;
  else
    v_bucket := case when req_role='authenticated' then 'auth_write' else 'anon_write' end;
    max_hits := case when req_role='authenticated' then 600 else 120 end;
    window_interval := interval '5 minutes';
  end if;

  select count(*) into hits
  from private.vip_api_rate_limits
  where ip=req_ip
    and bucket=v_bucket
    and request_at >= now() - window_interval;

  if hits >= max_hits then
    raise sqlstate 'PGRST' using
      message = jsonb_build_object(
        'code','rate_limit',
        'message','Demasiadas solicitudes. Intenta nuevamente en unos minutos.'
      )::text,
      detail = jsonb_build_object(
        'status',429,
        'headers',jsonb_build_object(
          'Retry-After',
          case when v_bucket in ('anon_promo','auth_delete','auth_destructive_rpc') then '600' else '300' end
        )
      )::text;
  end if;

  insert into private.vip_api_rate_limits(ip,jwt_role,request_path,bucket)
  values(req_ip,req_role,left(req_path,180),v_bucket);
end;
$function$;

-- Estas dos funciones aceptan credenciales y deben conservar la ejecución READ WRITE
-- para que el pre-request pueda seguir aplicando rate limiting.
alter function public.vip_finanzas_acceso(text,text) volatile;
alter function public.vip_finanzas_sync_obtener(text,text) volatile;
