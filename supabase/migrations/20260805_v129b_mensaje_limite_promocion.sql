create or replace function public.vip_promocion_canjear(p_whatsapp text, p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.vip_promociones_codigos%rowtype;
  v_wa text;
  v_codigo_vip text;
  v_miembro_id bigint;
  v_canje_id bigint;
  v_inicio date := current_date;
  v_fin date;
  v_nombre text := 'Acceso promocional';
  v_existente boolean;
begin
  v_wa := public.vip_normalizar_whatsapp(p_whatsapp);
  if length(v_wa) < 10 then
    return jsonb_build_object('ok',false,'estado','whatsapp_invalido','mensaje','Escribe un número de WhatsApp válido.');
  end if;
  v_wa := right(v_wa,10);

  if btrim(coalesce(p_codigo,''))='' then
    return jsonb_build_object('ok',false,'estado','codigo_vacio','mensaje','Escribe tu código promocional.');
  end if;

  select * into p
  from public.vip_promociones_codigos
  where lower(btrim(codigo)) = lower(btrim(p_codigo))
  for update;

  if not found then
    return jsonb_build_object('ok',false,'estado','codigo_invalido','mensaje','Código no válido. Revisa que esté escrito exactamente como lo recibiste.');
  end if;

  perform pg_advisory_xact_lock(hashtext(p.id::text || ':' || v_wa));

  if p.cupo_maximo is not null and p.usos >= p.cupo_maximo then
    update public.vip_promociones_codigos set estado='finalizada',mostrar_boton=false,actualizado_en=now() where id=p.id;
    return jsonb_build_object('ok',false,'estado','sin_cupos','mensaje','Esta promoción ya alcanzó el límite de activaciones. El código ya no es válido.');
  end if;
  if p.fecha_fin is not null and p.fecha_fin < now() then
    update public.vip_promociones_codigos set estado='finalizada',mostrar_boton=false,actualizado_en=now() where id=p.id;
    return jsonb_build_object('ok',false,'estado','vencida','mensaje','Esta promoción ya terminó. El código ya no es válido.');
  end if;
  if p.estado='proximamente' then
    return jsonb_build_object('ok',false,'estado','proximamente','mensaje',coalesce(nullif(p.mensaje_publico,''),'La promoción todavía no está activa.'));
  end if;
  if p.estado not in ('activa') then
    return jsonb_build_object('ok',false,'estado',p.estado,'mensaje','Este código ya no está disponible.');
  end if;
  if p.fecha_inicio is not null and p.fecha_inicio > now() then
    return jsonb_build_object('ok',false,'estado','no_iniciada','mensaje','La promoción todavía no inicia.');
  end if;

  if p.un_uso_por_whatsapp and exists(
    select 1 from public.vip_promociones_canjes c
    where c.promocion_id=p.id and c.whatsapp_normalizado=v_wa and c.estado in ('pendiente','activo')
  ) then
    return jsonb_build_object('ok',false,'estado','ya_usado','mensaje','Este número de WhatsApp ya utilizó esta promoción.');
  end if;

  if p.solo_nuevos then
    select exists(
      select 1 from public.miembros m
      where right(public.vip_normalizar_whatsapp(m.whatsapp),10)=v_wa
    ) into v_existente;
    if v_existente then
      return jsonb_build_object('ok',false,'estado','miembro_existente','mensaje','Esta promoción es únicamente para accesos nuevos.');
    end if;
  end if;

  v_fin := v_inicio + p.duracion_dias;

  if not p.activacion_automatica then
    insert into public.vip_promociones_canjes(
      promocion_id,whatsapp,whatsapp_normalizado,plan,duracion_dias,estado,detalle
    ) values(
      p.id,p_whatsapp,v_wa,p.plan,p.duracion_dias,'pendiente','Pendiente de aprobación desde el Centro de Control'
    ) returning id into v_canje_id;

    update public.vip_promociones_codigos
       set usos=usos+1,
           estado=case when cupo_maximo is not null and usos+1>=cupo_maximo then 'finalizada' else estado end,
           mostrar_boton=case when cupo_maximo is not null and usos+1>=cupo_maximo then false else mostrar_boton end,
           actualizado_en=now()
     where id=p.id;

    return jsonb_build_object('ok',true,'estado','pendiente','mensaje','Tu solicitud fue registrada. La administradora revisará la activación.','canje_id',v_canje_id);
  end if;

  v_codigo_vip := public.vip_promocion_generar_codigo_vip();

  insert into public.miembros(nombre,whatsapp,correo,codigo_vip,fecha_inicio,fecha_vencimiento,estado,plan,duracion)
  values(v_nombre,p_whatsapp,null,v_codigo_vip,v_inicio,v_fin,'activo',p.plan,'Prueba '||p.duracion_dias||' días')
  returning id into v_miembro_id;

  insert into public.vip_promociones_canjes(
    promocion_id,miembro_id,whatsapp,whatsapp_normalizado,codigo_vip,plan,duracion_dias,estado,fecha_inicio,fecha_vencimiento,detalle,resuelto_en
  ) values(
    p.id,v_miembro_id,p_whatsapp,v_wa,v_codigo_vip,p.plan,p.duracion_dias,'activo',v_inicio,v_fin,'Activación automática',now()
  ) returning id into v_canje_id;

  update public.vip_promociones_codigos
     set usos=usos+1,
         estado=case when cupo_maximo is not null and usos+1>=cupo_maximo then 'finalizada' else estado end,
         mostrar_boton=case when cupo_maximo is not null and usos+1>=cupo_maximo then false else mostrar_boton end,
         actualizado_en=now()
   where id=p.id;

  return jsonb_build_object(
    'ok',true,
    'estado','activo',
    'mensaje','Tu acceso fue activado correctamente.',
    'codigo_vip',v_codigo_vip,
    'whatsapp',p_whatsapp,
    'plan',p.plan,
    'duracion_dias',p.duracion_dias,
    'fecha_inicio',v_inicio,
    'fecha_vencimiento',v_fin,
    'miembro_id',v_miembro_id,
    'canje_id',v_canje_id
  );
exception when unique_violation then
  return jsonb_build_object('ok',false,'estado','duplicado','mensaje','Este código o WhatsApp ya fue utilizado.');
when others then
  return jsonb_build_object('ok',false,'estado','error','mensaje','No fue posible activar el acceso. Intenta nuevamente.');
end;
$$;

