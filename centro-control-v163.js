(function(){
  'use strict';
  if(window.__VIP_V163_MEMBERSHIP_CENTER__) return;
  window.__VIP_V163_MEMBERSHIP_CENTER__=true;

  var PLAN_KEYS=['Básico','VIP'];
  var HIDDEN_PLAN_KEY='VIP Pro';
  var BILLING_KEY='vip_control_membresias_v163';
  var MESSAGE_KEY='vip_control_mensajes_v163';
  var BILLING_LOCAL='vip_v163_billing_local';
  var MESSAGE_LOCAL='vip_v163_messages_local';
  var MESSAGE_LOG_LOCAL='vip_v163_message_log_local';
  var state={
    tab:'members',
    billing:{},
    cloudMode:'unknown',
    search:'',
    filter:'all',
    selectedMemberId:'',
    templateKey:'renewal_soon',
    messages:null,
    communicationLog:[],
    trialCode:'',
    trialResult:null,
    busy:false
  };

  var TEMPLATE_DEFS=[
    ['welcome','Bienvenida','Primer mensaje al entrar'],
    ['access','Datos de acceso','Código VIP y enlace'],
    ['trial_activation','Pase de 7 días','Activación privada'],
    ['trial_expiry','Fin de prueba','Invitación a continuar'],
    ['renewal_soon','Renovación próxima','Aviso antes del vencimiento'],
    ['renewal_today','Renovación de hoy','Recordatorio del día'],
    ['payment_received','Pago recibido','Confirmación y nueva fecha'],
    ['payment_late','Pago pendiente','Seguimiento amable'],
    ['founder_final','Último mes fundador','Aviso del mes final'],
    ['regular_change','Cambio a precio regular','Fin del beneficio fundador'],
    ['suspension','Acceso suspendido','Aviso de suspensión'],
    ['reactivation','Acceso reactivado','Confirmación de regreso'],
    ['class_notice','Clase o evento','Invitación a una clase'],
    ['new_content','Contenido nuevo','Aviso de actualización'],
    ['support','Seguimiento y soporte','Atención general']
  ];

  var DEFAULT_TEMPLATES={
    welcome:'Hola {{nombre}} 👋\n\n¡Bienvenida a {{plan}}! Tu acceso ya está preparado. Aquí encontrarás herramientas, clases y recursos para ayudarte a vender mejor.\n\n{{firma}}',
    access:'Hola {{nombre}}. Estos son tus datos de acceso:\n\nPlan: {{plan}}\nCódigo VIP: {{codigo_vip}}\nPróxima renovación: {{fecha_renovacion}}\n\nGuarda este mensaje en un lugar seguro.\n{{firma}}',
    trial_activation:'Hola {{nombre}} 🎁\n\nPor ser clienta de nuestras plantillas, tienes un pase privado de 7 días para conocer {{plan}}.\n\nCódigo: {{codigo_vip}}\nActívalo aquí: {{enlace_acceso}}\n\nEl código es personal y de un solo uso. {{firma}}',
    trial_expiry:'Hola {{nombre}}. Tu pase de 7 días está por terminar. Si quieres conservar tus herramientas, clases y recursos, puedes continuar en {{plan}} por {{precio_actual}} MXN al mes.\n\n{{enlace_pago}}\n{{firma}}',
    renewal_soon:'Hola {{nombre}} 😊\n\nTe recordamos que tu acceso a {{plan}} se renueva el {{fecha_renovacion}} por {{precio_actual}} MXN.{{detalle_fundador}}\n\n{{instrucciones_pago}}\n{{firma}}',
    renewal_today:'Hola {{nombre}}. Hoy corresponde la renovación de {{plan}} por {{precio_actual}} MXN.{{detalle_fundador}}\n\nCuando realices tu pago, envíame tu comprobante para confirmar tu acceso.\n{{instrucciones_pago}}\n{{firma}}',
    payment_received:'¡Pago recibido, {{nombre}}! ✅\n\nTu acceso a {{plan}} quedó renovado hasta el {{fecha_renovacion}}. Importe confirmado: {{precio_pagado}} MXN.{{detalle_fundador}}\n\nGracias por continuar con nosotras. {{firma}}',
    payment_late:'Hola {{nombre}}. Vimos que la renovación de {{plan}} quedó pendiente desde el {{fecha_renovacion}}. El importe es de {{precio_actual}} MXN.\n\nSi ya pagaste, compárteme tu comprobante; si necesitas apoyo, escríbeme y lo revisamos.\n{{firma}}',
    founder_final:'Hola {{nombre}} 🌟\n\nEsta será tu mensualidad {{mes_fundador}} de {{meses_fundador}} con precio fundador en {{plan}} por {{precio_actual}} MXN. A partir del {{fecha_cambio_precio}}, la mensualidad regular será de {{precio_regular}} MXN.\n\n{{firma}}',
    regular_change:'Hola {{nombre}}. Tu periodo de precio fundador en {{plan}} terminó. A partir del {{fecha_cambio_precio}}, tu mensualidad regular será de {{precio_regular}} MXN.\n\nGracias por haber confiado desde el inicio. {{firma}}',
    suspension:'Hola {{nombre}}. Tu acceso a {{plan}} quedó suspendido temporalmente. Tus datos siguen registrados; para reactivarlo, contáctame o envía tu comprobante de renovación.\n\n{{firma}}',
    reactivation:'¡Listo, {{nombre}}! ✅ Tu acceso a {{plan}} fue reactivado y estará disponible hasta el {{fecha_renovacion}}.\n\n{{firma}}',
    class_notice:'Hola {{nombre}} 🎓\n\nTenemos una nueva clase para integrantes de {{plan}}. Revisa la sección Academia o las novedades de la plataforma para ver el tema, fecha y acceso.\n\n{{firma}}',
    new_content:'Hola {{nombre}} ✨\n\nYa publicamos contenido nuevo dentro de {{plan}}. Entra a tu plataforma para encontrar las herramientas, recursos o clases recién agregadas.\n\n{{firma}}',
    support:'Hola {{nombre}}. ¿Cómo vas con {{plan}}? Si necesitas ayuda para encontrar una herramienta, aplicar un recurso o resolver una duda de acceso, puedes responderme por aquí.\n\n{{firma}}'
  };

  var DEFAULT_SETTINGS={
    senderName:'Yuliana · Club VIP MY',
    supportPhone:'',
    paymentLink:'',
    paymentInstructions:'Envíame tu comprobante por este WhatsApp para validar la renovación.',
    signature:'Yuliana · Club VIP MY'
  };

  function app(){ return window.__VIP_APP__||null; }
  function client(){ var a=app(); return (a&&typeof a.cfgClient==='function'&&a.cfgClient())||(a&&a.sb)||window.__VIP_CONFIG_CLIENT__||null; }
  function clean(v){ return String(v==null?'':v).replace(/\s+/g,' ').trim(); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function clone(v){ try{return JSON.parse(JSON.stringify(v));}catch(_){return v;} }
  function localGet(key,fallback){ try{var v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v;}catch(_){return fallback;} }
  function localSet(key,value){ try{localStorage.setItem(key,JSON.stringify(value));}catch(_){} }
  function number(v,fallback){ var n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n:(fallback||0); }
  function money(v){ return '$'+number(v,0).toLocaleString('es-MX',{maximumFractionDigits:2})+' MXN'; }
  function isoDate(value){
    if(!value) return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
    var d=new Date(value); if(isNaN(d)) return '';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function parseDate(value){ var x=isoDate(value);if(!x)return null;var p=x.split('-').map(Number);return new Date(p[0],p[1]-1,p[2],12,0,0,0); }
  function today(){ var d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate(),12,0,0,0); }
  function addDays(value,days){ var d=parseDate(value)||today();d.setDate(d.getDate()+Number(days||0));return isoDate(d); }
  function addMonth(value){ var d=parseDate(value)||today(),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);var last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return isoDate(d); }
  function laterDate(a,b){ var da=parseDate(a),db=parseDate(b);if(!da)return isoDate(b);if(!db)return isoDate(a);return da>db?isoDate(a):isoDate(b); }
  function daysUntil(value){ var d=parseDate(value);return d?Math.ceil((d-today())/86400000):null; }
  function dateLabel(value){ var d=parseDate(value);return d?d.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'}):'por definir'; }
  function whatsapp(value){ var n=String(value||'').replace(/\D/g,'');if(n.length===10)n='52'+n;return n; }
  function managerName(){var x=window.__VIP_TEAM_ACCESS__||{};return clean(x.nombre||x.correo||x.email)||(x.rol==='duena'?'Dueña':'Administración');}
  function planName(key){ var a=app(),p=a&&a.state&&a.state.planes&&a.state.planes[key];return clean(p&&p.nombre)||key||'VIP'; }
  function memberId(m){ return String((m&&m.id)!=null?m.id:(m&&m.codigo_vip)||''); }
  function members(){ var a=app();return a&&a.state&&Array.isArray(a.state.members)?a.state.members:[]; }
  function status(text,error){ var el=document.querySelector('#vip-v163-center .vip-v163-status');if(!el)return;el.textContent=text||'';el.classList.toggle('is-error',!!error); }
  function cloudBadge(){ return state.cloudMode==='cloud'?'<span class="vip-v163-cloud">● SINCRONIZADO EN SUPABASE</span>':'<span class="vip-v163-cloud local">● RESPALDO LOCAL · FALTA SQL</span>'; }

  function planDefaults(key){
    if(key==='Básico')return {nombre:'VIP',founderPrice:149,regularPrice:199,colorPrincipal:'#6d3aa0',colorAccent:'#d9be7e'};
    return {nombre:'VIP Pro',founderPrice:299,regularPrice:399,colorPrincipal:'#2c1245',colorAccent:'#d9be7e'};
  }
  function founderOfferActive(p){
    if(!p||p.founderActive===false)return false;
    var end=parseDate(p.founderEndDate);return !end||end>=today();
  }
  function normalizePlans(raw){
    var next=clone(raw||{}),changed=false;
    PLAN_KEYS.forEach(function(key){
      var d=planDefaults(key),p=Object.assign({},next[key]||{});
      if(!clean(p.nombre)||p.nombre==='Básico'||(key==='VIP'&&p.nombre==='VIP')){p.nombre=d.nombre;changed=true;}
      if(p.founderActive==null){p.founderActive=true;changed=true;}
      if(!number(p.founderPrice)){p.founderPrice=d.founderPrice;changed=true;}
      if(!number(p.regularPrice)){p.regularPrice=d.regularPrice;changed=true;}
      if(!number(p.founderMonths)){p.founderMonths=3;changed=true;}
      if(!p.colorPrincipal){p.colorPrincipal=d.colorPrincipal;changed=true;}
      if(!p.colorAccent){p.colorAccent=d.colorAccent;changed=true;}
      if(!clean(p.founderLabel)){p.founderLabel='Precio fundador';changed=true;}
      if(p.visible===false){p.visible=true;changed=true;}
      var publicPrice=founderOfferActive(p)?number(p.founderPrice):number(p.regularPrice);
      if(number(p.precio)!==publicPrice){p.precio=String(publicPrice);changed=true;}
      p.membershipModelVersion=163;
      next[key]=p;
    });
    if(next[HIDDEN_PLAN_KEY]&&next[HIDDEN_PLAN_KEY].membershipModelVersion!==163){
      next[HIDDEN_PLAN_KEY]=Object.assign({},next[HIDDEN_PLAN_KEY],{visible:false,membershipModelVersion:163});changed=true;
    }
    return {plans:next,changed:changed};
  }

  function installPlanNormalization(){
    var a=app();if(!a||a.__vipV163PlansWrapped)return;
    a.__vipV163PlansWrapped=true;
    if(typeof a.loadPlanes==='function'){
      var old=a.loadPlanes.bind(a);
      a.loadPlanes=function(){ return normalizePlans(old()).plans; };
    }
    var n=normalizePlans(a.state&&a.state.planes||{});
    if(n.changed&&typeof a.setState==='function')a.setState({planes:n.plans});
  }

  function defaultMessages(){ return {settings:clone(DEFAULT_SETTINGS),templates:clone(DEFAULT_TEMPLATES),updatedAt:''}; }
  function normalizeMessages(value){
    var out=defaultMessages(),v=value||{};
    out.settings=Object.assign(out.settings,v.settings||{});
    out.templates=Object.assign(out.templates,v.templates||{});
    out.updatedAt=v.updatedAt||'';
    return out;
  }

  async function loadMessages(){
    var local=normalizeMessages(localGet(MESSAGE_LOCAL,null));state.messages=local;
    var c=client();if(!c)return local;
    try{
      var r=await c.rpc('obtener_config');
      if(r.error)throw r.error;
      var row=(Array.isArray(r.data)?r.data:[]).find(function(x){return x&&x.clave===MESSAGE_KEY;});
      if(row&&row.valor){state.messages=normalizeMessages(row.valor);localSet(MESSAGE_LOCAL,state.messages);}
    }catch(_){}
    return state.messages;
  }

  async function saveMessages(){
    var a=app();state.messages.updatedAt=new Date().toISOString();localSet(MESSAGE_LOCAL,state.messages);
    if(a&&typeof a.saveKV==='function'){
      status('Guardando y comprobando los mensajes en Supabase…');
      var ok=await a.saveKV(MESSAGE_KEY,clone(state.messages),function(msg){status(msg,(/^❌/.test(msg||'')));});
      if(ok===true){status('Mensajes guardados y disponibles desde tu Centro de Control.');return true;}
    }
    status('Los mensajes quedaron guardados en este dispositivo. Revisa tu sesión de Supabase para sincronizarlos.',true);return false;
  }

  function defaultRecord(m){
    var key=(m&&m.plan)||'Básico',a=app(),p=a&&a.state&&a.state.planes&&a.state.planes[key]||{},reg=number(p.regularPrice,planDefaults(key).regularPrice),found=number(p.founderPrice,planDefaults(key).founderPrice);
    return {
      member_id:memberId(m),plan_key:key,founder_active:false,founder_month:0,founder_total:number(p.founderMonths,3),founder_price:found,regular_price:reg,
      next_renewal:isoDate(m&&m.fecha_vencimiento),price_change_date:'',grace_until:'',last_payment:'',payment_link:'',notes:'',status:'active',updated_at:''
    };
  }
  function recordFor(m){ return Object.assign(defaultRecord(m),state.billing[memberId(m)]||{}); }
  function saveBillingLocal(){ localSet(BILLING_LOCAL,state.billing); }

  async function loadBilling(){
    state.billing=localGet(BILLING_LOCAL,{})||{};state.cloudMode='local';
    state.communicationLog=localGet(MESSAGE_LOG_LOCAL,[])||[];
    var c=client();if(!c)return state.billing;
    try{
      var r=await c.from('vip_control_membresias').select('*');
      if(r.error)throw r.error;
      var map={};(r.data||[]).forEach(function(x){map[String(x.member_id)]=x;});
      state.billing=Object.assign({},state.billing,map);state.cloudMode='cloud';saveBillingLocal();
      var logs=await c.from('vip_control_comunicaciones').select('*').order('created_at',{ascending:false}).limit(30);
      if(!logs.error&&Array.isArray(logs.data)){state.communicationLog=logs.data;localSet(MESSAGE_LOG_LOCAL,state.communicationLog);}
    }catch(e){state.cloudMode='local';}
    return state.billing;
  }

  async function saveRecord(record){
    record=Object.assign({},record,{member_id:String(record.member_id),updated_at:new Date().toISOString()});
    state.billing[String(record.member_id)]=record;saveBillingLocal();
    if(state.cloudMode==='cloud'){
      var c=client(),payload=clone(record);
      try{var r=await c.from('vip_control_membresias').upsert(payload,{onConflict:'member_id'});if(r.error)throw r.error;return true;}
      catch(e){status('El control se guardó localmente, pero Supabase no confirmó la sincronización: '+clean(e&&e.message),true);return false;}
    }
    return true;
  }

  async function logPayment(m,amount,kind,note){
    if(state.cloudMode!=='cloud')return;
    try{await client().from('vip_control_pagos').insert({member_id:memberId(m),amount:number(amount),kind:kind||'manual',note:note||'',paid_at:new Date().toISOString()});}catch(_){}
  }
  async function logMessage(m,key,text,statusName){
    var item={id:'local-'+Date.now(),member_id:memberId(m),template_key:key,phone:whatsapp(m&&m.whatsapp),rendered_text:text,status:statusName||'opened',managed_by:managerName(),created_at:new Date().toISOString()};
    state.communicationLog=[item].concat(state.communicationLog||[]).slice(0,30);localSet(MESSAGE_LOG_LOCAL,state.communicationLog);
    if(state.cloudMode!=='cloud')return;
    try{var r=await client().from('vip_control_comunicaciones').insert({member_id:item.member_id,template_key:item.template_key,phone:item.phone,rendered_text:item.rendered_text,status:item.status,managed_by:item.managed_by}).select('*').single();if(!r.error&&r.data){state.communicationLog=[r.data].concat(state.communicationLog.filter(function(x){return x.id!==item.id;})).slice(0,30);localSet(MESSAGE_LOG_LOCAL,state.communicationLog);}}catch(_){}
  }

  function currentPrice(r){ return r.founder_active&&number(r.founder_month)<number(r.founder_total)?number(r.founder_price):number(r.regular_price); }
  function founderDetail(r){
    if(!(r&&r.founder_active))return '';
    var next=Math.min(number(r.founder_month)+1,number(r.founder_total));
    if(number(r.founder_month)>=number(r.founder_total))return ' Tu periodo fundador ya concluyó y corresponde el precio regular.';
    return ' Esta corresponde a la mensualidad '+next+' de '+number(r.founder_total)+' con beneficio fundador. Después, la mensualidad regular será de '+money(r.regular_price)+'.';
  }

  function varsFor(m,r,extra){
    r=Object.assign(recordFor(m),r||{});var settings=state.messages&&state.messages.settings||DEFAULT_SETTINGS;
    var nextFounder=Math.min(number(r.founder_month)+1,Math.max(1,number(r.founder_total)));
    return Object.assign({
      nombre:clean(m&&m.nombre)||'integrante',plan:planName(r.plan_key||m&&m.plan),precio_actual:String(currentPrice(r)),precio_regular:String(number(r.regular_price)),precio_pagado:String(currentPrice(r)),
      fecha_renovacion:dateLabel(r.next_renewal||m&&m.fecha_vencimiento),mes_fundador:String(nextFounder),meses_fundador:String(number(r.founder_total,3)),fecha_cambio_precio:dateLabel(r.price_change_date||r.next_renewal),
      dias_gracia:String(Math.max(0,daysUntil(r.grace_until)||0)),codigo_vip:clean(m&&m.codigo_vip)||'',enlace_pago:clean(r.payment_link)||clean(settings.paymentLink)||'Solicita aquí tus datos de pago.',
      enlace_acceso:'',instrucciones_pago:clean(settings.paymentInstructions),firma:clean(settings.signature)||clean(settings.senderName),whatsapp_soporte:clean(settings.supportPhone),detalle_fundador:founderDetail(r)
    },extra||{});
  }
  function renderText(template,vars){ return String(template||'').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g,function(_,key){return vars[key]!=null?String(vars[key]):'';}).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim(); }
  function messageText(m,key,extra){ var cfg=state.messages||defaultMessages();return renderText(cfg.templates[key]||DEFAULT_TEMPLATES[key]||'',varsFor(m,recordFor(m),extra)); }

  function tabMeta(){return {
    members:['💳','Control de membresías','Renovaciones, pagos, fundador, gracia y suspensión.'],
    plans:['👑','Planes y precio fundador','Dos planes públicos: VIP y VIP Pro, con precios editables.'],
    messages:['💬','Comunicación y mensajes','Edita una vez y envía con los datos correctos de cada persona.'],
    trials:['🎁','Pases privados de 7 días','Códigos individuales para clientas que ya compraron plantillas.']
  }[state.tab];}

  function ensureOverlay(){
    var old=document.getElementById('vip-v163-center');if(old)return old;
    var root=document.createElement('div');root.id='vip-v163-center';root.innerHTML='<div class="vip-v163-shell" role="dialog" aria-modal="true" aria-labelledby="vip-v163-title"><header class="vip-v163-header"><div class="vip-v163-header-mark">👑</div><div class="vip-v163-header-copy"><h2 id="vip-v163-title">Control comercial VIP</h2><p>Planes, renovaciones, mensajes y pases privados desde un solo lugar.</p></div><button class="vip-v163-close" type="button" aria-label="Cerrar">×</button></header><nav class="vip-v163-tabs" aria-label="Secciones"><button class="vip-v163-tab" data-tab="members">💳 Membresías</button><button class="vip-v163-tab" data-tab="plans">👑 Planes</button><button class="vip-v163-tab" data-tab="messages">💬 Mensajes</button><button class="vip-v163-tab" data-tab="trials">🎁 Pases 7 días</button></nav><div class="vip-v163-status" aria-live="polite"></div><main class="vip-v163-body"></main></div>';
    document.body.appendChild(root);
    root.querySelector('.vip-v163-close').onclick=closeCenter;
    root.querySelector('.vip-v163-tabs').onclick=function(e){var b=e.target.closest('[data-tab]');if(!b)return;state.tab=b.dataset.tab;state.selectedMemberId='';render();};
    root.onclick=function(e){if(e.target===root)closeCenter();};
    root.querySelector('.vip-v163-body').addEventListener('click',bodyClick);
    root.querySelector('.vip-v163-body').addEventListener('input',bodyInput);
    root.querySelector('.vip-v163-body').addEventListener('change',bodyInput);
    return root;
  }
  function closeCenter(){ var x=document.getElementById('vip-v163-center');if(x)x.remove();document.body.style.overflow=''; }
  async function openCenter(tab){
    state.tab=tab||'members';ensureOverlay();document.body.style.overflow='hidden';renderLoading();
    await Promise.all([loadMessages(),loadBilling()]);render();
  }
  window.vipV163OpenMembershipCenter=openCenter;

  function renderLoading(){var body=document.querySelector('#vip-v163-center .vip-v163-body');if(body)body.innerHTML='<div class="vip-v163-empty">Cargando el control comercial y comprobando Supabase…</div>';}
  function render(){
    var root=document.getElementById('vip-v163-center');if(!root)return;
    root.querySelectorAll('.vip-v163-tab').forEach(function(b){b.classList.toggle('is-active',b.dataset.tab===state.tab);});
    var meta=tabMeta(),mark=root.querySelector('.vip-v163-header-mark'),title=root.querySelector('#vip-v163-title'),copy=root.querySelector('.vip-v163-header-copy p');mark.textContent=meta[0];title.textContent=meta[1];copy.textContent=meta[2];
    if(state.tab==='members')renderMembers();else if(state.tab==='plans')renderPlans();else if(state.tab==='messages')renderMessages();else renderTrials();
  }

  function intro(title,text,badge){ return '<div class="vip-v163-intro"><div><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p></div>'+(badge||'')+'</div>'; }
  function visibleMembers(){
    var q=state.search.toLowerCase(),list=members().filter(function(m){var r=recordFor(m),d=daysUntil(r.next_renewal||m.fecha_vencimiento);if(q&&[m.nombre,m.whatsapp,m.codigo_vip,planName(r.plan_key)].join(' ').toLowerCase().indexOf(q)<0)return false;if(state.filter==='founder'&&!r.founder_active)return false;if(state.filter==='due'&&!(d!=null&&d>=0&&d<=7))return false;if(state.filter==='late'&&!(d!=null&&d<0))return false;if(state.filter==='suspended'&&!(m.estado==='suspendido'||r.status==='suspended'))return false;return true;});
    return list;
  }
  function memberStats(){
    var out={due:0,late:0,founder:0,suspended:0};members().forEach(function(m){var r=recordFor(m),d=daysUntil(r.next_renewal||m.fecha_vencimiento);if(d!=null&&d>=0&&d<=7)out.due++;if(d!=null&&d<0)out.late++;if(r.founder_active&&number(r.founder_month)<number(r.founder_total))out.founder++;if(m.estado==='suspendido'||r.status==='suspended')out.suspended++;});return out;
  }
  function memberBadge(m,r){var d=daysUntil(r.next_renewal||m.fecha_vencimiento);if(m.estado==='suspendido'||r.status==='suspended')return '<span class="vip-v163-badge danger">SUSPENDIDO</span>';if(d!=null&&d<0)return '<span class="vip-v163-badge danger">VENCIDO</span>';if(d!=null&&d<=7)return '<span class="vip-v163-badge warning">RENUEVA PRONTO</span>';if(r.founder_active&&number(r.founder_month)<number(r.founder_total))return '<span class="vip-v163-badge founder">FUNDADOR '+number(r.founder_month)+'/'+number(r.founder_total)+'</span>';return '<span class="vip-v163-badge">ACTIVO</span>';}
  function memberCard(m){
    var r=recordFor(m),renew=r.next_renewal||m.fecha_vencimiento,d=daysUntil(renew),dayText=d==null?'Sin fecha':(d<0?Math.abs(d)+' días vencida':d+' días restantes');
    return '<article class="vip-v163-member" data-member="'+esc(memberId(m))+'"><div class="vip-v163-member-top"><div><h4>'+esc(m.nombre||'Sin nombre')+'</h4><div class="vip-v163-member-meta">'+esc(m.whatsapp||'Sin WhatsApp')+' · '+esc(m.codigo_vip||'Sin código')+'<br>'+esc(planName(r.plan_key||m.plan))+'</div></div>'+memberBadge(m,r)+'</div><div class="vip-v163-member-grid"><div class="vip-v163-member-cell"><span>PRECIO ACTUAL</span><b>'+money(currentPrice(r))+'</b></div><div class="vip-v163-member-cell"><span>PRÓXIMA RENOVACIÓN</span><b>'+esc(dateLabel(renew))+'</b></div><div class="vip-v163-member-cell"><span>VIGENCIA</span><b>'+esc(dayText)+'</b></div><div class="vip-v163-member-cell"><span>DESPUÉS</span><b>'+money(r.regular_price)+'/mes</b></div></div><div class="vip-v163-member-actions"><button class="vip-v163-btn primary" data-action="message">💬 Enviar mensaje</button><button class="vip-v163-btn gold" data-action="payment">✓ Confirmar pago</button><button class="vip-v163-btn" data-action="configure">⚙ Configurar</button><button class="vip-v163-btn" data-action="extend">＋ Extender acceso</button><button class="vip-v163-btn" data-action="grace">⏳ Dar gracia</button>'+(m.estado==='suspendido'||r.status==='suspended'?'<button class="vip-v163-btn green" data-action="reactivate">Reactivar</button>':'<button class="vip-v163-btn danger" data-action="suspend">Suspender</button>')+'</div></article>';
  }
  function memberEditor(m){
    if(!m)return '';var r=recordFor(m),plans=PLAN_KEYS.map(function(k){return '<option value="'+esc(k)+'" '+(r.plan_key===k?'selected':'')+'>'+esc(planName(k))+'</option>';}).join('');
    return '<section class="vip-v163-panel" data-member-editor="'+esc(memberId(m))+'"><h3>Configurar a '+esc(m.nombre||'integrante')+'</h3><p>Define si tiene precio fundador, en qué mensualidad va y cuándo corresponde la siguiente renovación.</p><div class="vip-v163-form-grid three"><div class="vip-v163-field"><label>PLAN</label><select data-edit-field="plan_key">'+plans+'</select></div><div class="vip-v163-field"><label>PRÓXIMA RENOVACIÓN</label><input type="date" data-edit-field="next_renewal" value="'+esc(r.next_renewal||isoDate(m.fecha_vencimiento))+'"></div><div class="vip-v163-field"><label>ESTADO DE CONTROL</label><select data-edit-field="status"><option value="active" '+(r.status==='active'?'selected':'')+'>Activo</option><option value="grace" '+(r.status==='grace'?'selected':'')+'>En gracia</option><option value="suspended" '+(r.status==='suspended'?'selected':'')+'>Suspendido</option></select></div><label class="vip-v163-check"><input type="checkbox" data-edit-field="founder_active" '+(r.founder_active?'checked':'')+'> Tiene precio fundador</label><div class="vip-v163-field"><label>MENSUALIDADES FUNDADOR PAGADAS</label><input type="number" min="0" max="24" data-edit-field="founder_month" value="'+number(r.founder_month)+'"></div><div class="vip-v163-field"><label>TOTAL MESES FUNDADOR</label><input type="number" min="1" max="24" data-edit-field="founder_total" value="'+number(r.founder_total,3)+'"></div><div class="vip-v163-field"><label>PRECIO FUNDADOR</label><input type="number" min="1" step="1" data-edit-field="founder_price" value="'+number(r.founder_price)+'"></div><div class="vip-v163-field"><label>PRECIO REGULAR</label><input type="number" min="1" step="1" data-edit-field="regular_price" value="'+number(r.regular_price)+'"></div><div class="vip-v163-field"><label>FECHA CAMBIO A REGULAR</label><input type="date" data-edit-field="price_change_date" value="'+esc(r.price_change_date||'')+'"></div><div class="vip-v163-field full"><label>LINK DE PAGO INDIVIDUAL (OPCIONAL)</label><input data-edit-field="payment_link" value="'+esc(r.payment_link||'')+'" placeholder="Se conectará con Mercado Pago cuando estés lista"></div><div class="vip-v163-field full"><label>NOTAS INTERNAS</label><textarea data-edit-field="notes" placeholder="Acuerdos, comprobantes o seguimiento">'+esc(r.notes||'')+'</textarea></div></div><div class="vip-v163-split-actions"><button class="vip-v163-btn primary" data-action="save-member-control">Guardar control</button><button class="vip-v163-btn" data-action="cancel-member-control">Cerrar edición</button></div></section>';
  }
  function renderMembers(){
    var body=document.querySelector('#vip-v163-center .vip-v163-body'),stats=memberStats(),selected=members().find(function(m){return memberId(m)===state.selectedMemberId;}),list=visibleMembers();
    body.innerHTML=intro('Tu tablero de renovación','Aquí sabrás quién renueva, cuánto debe pagar y en qué mensualidad fundadora se encuentra.',cloudBadge())+memberEditor(selected)+'<div class="vip-v163-stats"><div class="vip-v163-stat"><strong>'+stats.due+'</strong><span>RENUEVAN EN 7 DÍAS</span></div><div class="vip-v163-stat"><strong>'+stats.late+'</strong><span>PAGOS PENDIENTES</span></div><div class="vip-v163-stat"><strong>'+stats.founder+'</strong><span>PRECIO FUNDADOR</span></div><div class="vip-v163-stat"><strong>'+stats.suspended+'</strong><span>SUSPENDIDOS</span></div></div><div class="vip-v163-toolbar"><input class="vip-v163-search" data-search placeholder="Buscar por nombre, WhatsApp o código" value="'+esc(state.search)+'"><select class="vip-v163-filter" data-filter><option value="all">Todos</option><option value="due" '+(state.filter==='due'?'selected':'')+'>Renuevan pronto</option><option value="late" '+(state.filter==='late'?'selected':'')+'>Vencidos</option><option value="founder" '+(state.filter==='founder'?'selected':'')+'>Fundadores</option><option value="suspended" '+(state.filter==='suspended'?'selected':'')+'>Suspendidos</option></select></div><div id="vip-v163-member-results">'+(list.length?'<div class="vip-v163-members">'+list.map(memberCard).join('')+'</div>':'<div class="vip-v163-empty">No hay integrantes que coincidan con este filtro.</div>')+'</div>';
  }

  function planForm(key){
    var a=app(),p=a&&a.state&&a.state.planes&&a.state.planes[key]||{},d=planDefaults(key),active=founderOfferActive(p);
    return '<section class="vip-v163-plan" data-plan="'+esc(key)+'" style="--plan-color:'+esc(p.colorPrincipal||d.colorPrincipal)+'"><div class="vip-v163-plan-head"><div><h3>'+esc(p.nombre||d.nombre)+'</h3><span>CLAVE INTERNA: '+esc(key)+'</span></div><span>'+((p.founderActive!==false)?'OFERTA FUNDADOR':'PRECIO REGULAR')+'</span></div><div class="vip-v163-form-grid"><div class="vip-v163-field"><label>NOMBRE PÚBLICO</label><input data-plan-field="nombre" value="'+esc(p.nombre||d.nombre)+'"></div><div class="vip-v163-field"><label>ETIQUETA FUNDADOR</label><input data-plan-field="founderLabel" value="'+esc(p.founderLabel||'Precio fundador')+'"></div><label class="vip-v163-check"><input type="checkbox" data-plan-field="founderActive" '+(p.founderActive!==false?'checked':'')+'> Mostrar precio fundador</label><div class="vip-v163-field"><label>MESES A PRECIO FUNDADOR</label><input type="number" min="1" max="24" data-plan-field="founderMonths" value="'+number(p.founderMonths,3)+'"></div><div class="vip-v163-field"><label>PRECIO FUNDADOR MXN</label><input type="number" min="1" step="1" data-plan-field="founderPrice" value="'+number(p.founderPrice,d.founderPrice)+'"></div><div class="vip-v163-field"><label>PRECIO REGULAR MXN</label><input type="number" min="1" step="1" data-plan-field="regularPrice" value="'+number(p.regularPrice,d.regularPrice)+'"></div><div class="vip-v163-field"><label>ÚLTIMO DÍA PARA ENTRAR COMO FUNDADOR</label><input type="date" data-plan-field="founderEndDate" value="'+esc(p.founderEndDate||'')+'"></div><div class="vip-v163-field"><label>CUPO MÁXIMO FUNDADOR (OPCIONAL)</label><input type="number" min="1" data-plan-field="founderMax" value="'+esc(p.founderMax||'')+'" placeholder="Sin límite"></div><div class="vip-v163-field"><label>COLOR PRINCIPAL</label><input type="color" data-plan-field="colorPrincipal" value="'+esc(p.colorPrincipal||d.colorPrincipal)+'"></div><div class="vip-v163-field"><label>COLOR DE ACENTO</label><input type="color" data-plan-field="colorAccent" value="'+esc(p.colorAccent||d.colorAccent)+'"></div></div><div class="vip-v163-plan-preview"><small>ASÍ SE CALCULARÁ HOY</small><strong>'+money(active?number(p.founderPrice,d.founderPrice):number(p.regularPrice,d.regularPrice))+'/mes</strong><p>'+(active?number(p.founderMonths,3)+' meses; después '+money(p.regularPrice||d.regularPrice)+'/mes.':'Precio regular activo.')+'</p></div></section>';
  }
  function renderPlans(){
    var body=document.querySelector('#vip-v163-center .vip-v163-body');body.innerHTML=intro('Dos planes claros y escalables','VIP funciona como entrada; VIP Pro concentra el acompañamiento y el acceso más completo. Los beneficios y permisos siguen editándose en tus secciones actuales.',cloudBadge())+'<div class="vip-v163-plan-layout">'+PLAN_KEYS.map(planForm).join('')+'</div><div class="vip-v163-note" style="margin-top:13px"><b>Importante:</b> la tercera clave técnica se mantiene oculta para no romper permisos antiguos. Al público solo se muestran VIP y VIP Pro. El precio fundador no es permanente: cada integrante conserva el beneficio únicamente durante el número de mensualidades que tú configures.</div><div class="vip-v163-split-actions"><button class="vip-v163-btn primary" data-action="save-plans">Guardar y publicar los dos planes</button></div>';
  }

  function templateList(){return TEMPLATE_DEFS.map(function(x){return '<button class="vip-v163-template '+(state.templateKey===x[0]?'is-active':'')+'" data-template="'+x[0]+'">'+esc(x[1])+'<small>'+esc(x[2])+'</small></button>';}).join('');}
  function sampleMember(){return members()[0]||{nombre:'Ana María',whatsapp:'3312345678',codigo_vip:'VIP-ANA01',plan:'Básico',fecha_vencimiento:addDays(today(),5)};}
  function renderMessages(){
    var body=document.querySelector('#vip-v163-center .vip-v163-body'),cfg=state.messages||defaultMessages(),set=cfg.settings,tpl=cfg.templates[state.templateKey]||'',sample=sampleMember(),preview=messageText(sample,state.templateKey);
    var recent=(state.communicationLog||[]).slice(0,12),names={};members().forEach(function(m){names[memberId(m)]=m.nombre;});
    body.innerHTML=intro('Biblioteca de mensajes','Los precios, fechas, plan y mensualidad fundadora se colocan automáticamente al elegir una integrante.',cloudBadge())+'<section class="vip-v163-panel"><h3>Datos generales para todos los mensajes</h3><p>Estas líneas se reutilizan para que no tengas que corregir cada mensaje por separado.</p><div class="vip-v163-form-grid"><div class="vip-v163-field"><label>NOMBRE O FIRMA</label><input data-setting="signature" value="'+esc(set.signature||'')+'"></div><div class="vip-v163-field"><label>WHATSAPP DE SOPORTE (REFERENCIA)</label><input data-setting="supportPhone" value="'+esc(set.supportPhone||'')+'" placeholder="5233…"></div><div class="vip-v163-field full"><label>LINK GENERAL DE PAGO (OPCIONAL)</label><input data-setting="paymentLink" value="'+esc(set.paymentLink||'')+'" placeholder="Se puede agregar después con Mercado Pago"></div><div class="vip-v163-field full"><label>INSTRUCCIONES DE PAGO</label><textarea data-setting="paymentInstructions">'+esc(set.paymentInstructions||'')+'</textarea></div></div></section><div class="vip-v163-message-layout"><section class="vip-v163-panel"><h3>Mensajes</h3><p>Elige cuál quieres editar.</p><div class="vip-v163-template-list">'+templateList()+'</div></section><section class="vip-v163-panel"><h3>'+esc((TEMPLATE_DEFS.find(function(x){return x[0]===state.templateKey;})||[])[1]||'Mensaje')+'</h3><p>Puedes cambiar todo el texto. Pulsa una variable para insertarla.</p><div class="vip-v163-vars">'+['nombre','plan','precio_actual','precio_regular','precio_pagado','fecha_renovacion','mes_fundador','meses_fundador','fecha_cambio_precio','codigo_vip','enlace_pago','enlace_acceso','instrucciones_pago','firma'].map(function(v){return '<button class="vip-v163-var" data-var="'+v+'">{{'+v+'}}</button>';}).join('')+'</div><div class="vip-v163-field"><textarea id="vip-v163-template-editor" data-template-editor="'+esc(state.templateKey)+'" style="min-height:220px">'+esc(tpl)+'</textarea></div><label style="display:block;margin:12px 0 6px;color:#6b5d73;font-size:9.5px;font-weight:950">VISTA PREVIA CON DATOS DE EJEMPLO</label><div class="vip-v163-preview" id="vip-v163-template-preview">'+esc(preview)+'</div><div class="vip-v163-split-actions"><button class="vip-v163-btn primary" data-action="save-messages">Guardar todos los mensajes</button><button class="vip-v163-btn green" data-action="test-message">Probar con una integrante</button></div></section></div><section class="vip-v163-panel"><h3>Historial reciente</h3><p>WhatsApp no confirma si la persona lo envió; aquí se registra cuándo se abrió o copió el mensaje y quién lo preparó.</p>'+(recent.length?'<div class="vip-v163-members">'+recent.map(function(x){var def=TEMPLATE_DEFS.find(function(d){return d[0]===x.template_key;});return '<div class="vip-v163-member"><div class="vip-v163-member-top"><div><h4>'+esc(names[String(x.member_id)]||'Integrante')+'</h4><div class="vip-v163-member-meta">'+esc(def&&def[1]||x.template_key)+' · '+esc(new Date(x.created_at).toLocaleString('es-MX'))+'</div></div><span class="vip-v163-badge">'+esc(x.status==='copied'?'COPIADO':'ABIERTO')+'</span></div><div class="vip-v163-member-meta" style="margin-top:10px">Preparó: <b>'+esc(x.managed_by||'Administración')+'</b></div></div>';}).join('')+'</div>':'<div class="vip-v163-empty">Todavía no hay mensajes abiertos o copiados.</div>')+'</section>';
  }

  function nextTrialCode(){return 'VIP7-'+Math.random().toString(36).slice(2,8).toUpperCase();}
  function renderTrials(){
    if(!state.trialCode)state.trialCode=nextTrialCode();var body=document.querySelector('#vip-v163-center .vip-v163-body'),result=state.trialResult;
    body.innerHTML=intro('Pase privado para compradoras','Crea un código individual, de un solo uso y válido para 7 días. No se presenta como tercer plan ni se anuncia al público.',cloudBadge())+'<section class="vip-v163-panel"><h3>Crear pase de cortesía</h3><p>Envía el enlace únicamente a una persona que ya te compró plantillas.</p><div class="vip-v163-form-grid"><div class="vip-v163-field"><label>NOMBRE DE LA CLIENTA</label><input id="vip-v163-trial-name" placeholder="Ana María"></div><div class="vip-v163-field"><label>WHATSAPP</label><input id="vip-v163-trial-phone" inputmode="tel" placeholder="3312345678"></div><div class="vip-v163-field"><label>CÓDIGO INDIVIDUAL</label><input id="vip-v163-trial-code" value="'+esc(state.trialCode)+'"></div><div class="vip-v163-field"><label>PLAN QUE CONOCERÁ</label><select id="vip-v163-trial-plan">'+PLAN_KEYS.map(function(k){return '<option value="'+esc(k)+'">'+esc(planName(k))+'</option>';}).join('')+'</select></div></div><div class="vip-v163-note" style="margin-top:12px">El acceso dura exactamente 7 días desde que la clienta canjea el código. El enlace de canje es privado; el bloque de prueba permanece oculto para visitantes normales.</div><div class="vip-v163-split-actions"><button class="vip-v163-btn primary" data-action="create-trial">Crear código y enlace privado</button><button class="vip-v163-btn" data-action="new-trial-code">Generar otro código</button></div>'+(result?'<div class="vip-v163-trial-result"><strong>Pase creado correctamente</strong><span class="vip-v163-code">'+esc(result.code)+'</span><div class="vip-v163-preview">'+esc(result.message)+'</div><div class="vip-v163-split-actions"><button class="vip-v163-btn" data-action="copy-trial">Copiar mensaje</button><button class="vip-v163-btn green" data-action="send-trial">Enviar por WhatsApp</button></div></div>':'')+'</section>';
  }

  function getMemberFromAction(el){var card=el.closest('[data-member]'),id=card&&card.dataset.member;return members().find(function(m){return memberId(m)===String(id);});}
  async function bodyClick(e){
    var template=e.target.closest('[data-template]');if(template){state.templateKey=template.dataset.template;renderMessages();return;}
    var variable=e.target.closest('[data-var]');if(variable){insertVariable(variable.dataset.var);return;}
    var action=e.target.closest('[data-action]');if(!action)return;
    var name=action.dataset.action,m=getMemberFromAction(action);
    if(name==='configure'&&m){state.selectedMemberId=memberId(m);renderMembers();document.querySelector('#vip-v163-center .vip-v163-body').scrollTop=0;return;}
    if(name==='cancel-member-control'){state.selectedMemberId='';renderMembers();return;}
    if(name==='save-member-control'){await saveMemberEditor(action);return;}
    if(name==='message'&&m){openMessageModal(m);return;}
    if(name==='payment'&&m){await confirmPayment(m,action);return;}
    if(name==='extend'&&m){await extendMember(m);return;}
    if(name==='grace'&&m){await graceMember(m);return;}
    if(name==='suspend'&&m){await suspendMember(m);return;}
    if(name==='reactivate'&&m){await reactivateMember(m);return;}
    if(name==='save-plans'){await savePlans(action);return;}
    if(name==='save-messages'){await saveMessages();return;}
    if(name==='test-message'){openMessageModal(sampleMember(),state.templateKey,true);return;}
    if(name==='create-trial'){await createTrial(action);return;}
    if(name==='new-trial-code'){state.trialCode=nextTrialCode();state.trialResult=null;renderTrials();return;}
    if(name==='copy-trial'&&state.trialResult){await copyText(state.trialResult.message);status('Mensaje del pase copiado.');return;}
    if(name==='send-trial'&&state.trialResult){openWhatsApp(state.trialResult.phone,state.trialResult.message);return;}
  }
  function bodyInput(e){
    if(e.target.matches('[data-search]')){state.search=e.target.value;var results=document.getElementById('vip-v163-member-results'),list=visibleMembers();if(results)results.innerHTML=list.length?'<div class="vip-v163-members">'+list.map(memberCard).join('')+'</div>':'<div class="vip-v163-empty">No hay integrantes que coincidan con este filtro.</div>';return;}
    if(e.target.matches('[data-filter]')){state.filter=e.target.value;renderMembers();return;}
    if(e.target.matches('[data-setting]')){state.messages.settings[e.target.dataset.setting]=e.target.value;var preview=document.getElementById('vip-v163-template-preview');if(preview)preview.textContent=messageText(sampleMember(),state.templateKey);return;}
    if(e.target.matches('[data-template-editor]')){state.messages.templates[e.target.dataset.templateEditor]=e.target.value;var prev=document.getElementById('vip-v163-template-preview');if(prev)prev.textContent=messageText(sampleMember(),e.target.dataset.templateEditor);return;}
  }
  function insertVariable(name){var ta=document.getElementById('vip-v163-template-editor');if(!ta)return;var token='{{'+name+'}}',start=ta.selectionStart||0,end=ta.selectionEnd||0;ta.value=ta.value.slice(0,start)+token+ta.value.slice(end);state.messages.templates[state.templateKey]=ta.value;ta.focus();ta.selectionStart=ta.selectionEnd=start+token.length;var prev=document.getElementById('vip-v163-template-preview');if(prev)prev.textContent=messageText(sampleMember(),state.templateKey);}

  async function saveMemberEditor(btn){
    var panel=btn.closest('[data-member-editor]'),m=members().find(function(x){return memberId(x)===panel.dataset.memberEditor;});if(!m)return;var r=recordFor(m);
    panel.querySelectorAll('[data-edit-field]').forEach(function(el){var k=el.dataset.editField,v=el.type==='checkbox'?el.checked:el.value;if(['founder_month','founder_total','founder_price','regular_price'].indexOf(k)>=0)v=number(v);r[k]=v;});
    if(number(r.founder_month)>number(r.founder_total)){status('La mensualidad fundadora pagada no puede ser mayor al total configurado.',true);return;}
    if(number(r.regular_price)<1||number(r.founder_price)<1){status('Revisa los precios antes de guardar.',true);return;}
    btn.disabled=true;var ok=await saveRecord(r);try{await updateMember(m,{plan:r.plan_key});}catch(e){status(clean(e&&e.message)||'No se pudo actualizar el plan del miembro.',true);btn.disabled=false;return;}btn.disabled=false;state.selectedMemberId='';renderMembers();status(ok?'Control de '+clean(m.nombre)+' guardado y sincronizado.':'Control guardado localmente; falta aplicar el SQL de Supabase.',!ok);
  }

  async function updateMember(m,fields){
    var a=app();if(a&&a.useSb&&a.sb&&m.id!=null){var r=await a.sb.from('miembros').update(fields).eq('id',m.id);if(r.error)throw r.error;if(typeof a.refreshCloud==='function')await a.refreshCloud();return;}
    if(a&&a.state){var list=(a.state.members||[]).map(function(x){return memberId(x)===memberId(m)?Object.assign({},x,fields):x;});await new Promise(function(resolve){a.setState({members:list},function(){try{if(typeof a.persist==='function')a.persist();}catch(_){}resolve();});});}
  }
  async function confirmPayment(m,btn){
    var r=recordFor(m),price=currentPrice(r);if(!window.confirm('¿Confirmar un pago de '+money(price)+' de '+clean(m.nombre)+' y extender su acceso un mes?'))return;
    btn.disabled=true;var base=laterDate(r.next_renewal||m.fecha_vencimiento,isoDate(today())),next=addMonth(base),paidFounder=r.founder_active&&number(r.founder_month)<number(r.founder_total);
    if(paidFounder)r.founder_month=number(r.founder_month)+1;
    r.last_payment=isoDate(today());r.next_renewal=next;r.status='active';r.grace_until='';if(paidFounder&&number(r.founder_month)>=number(r.founder_total))r.price_change_date=next;
    try{await updateMember(m,{fecha_vencimiento:next,estado:'activo'});await saveRecord(r);await logPayment(m,price,'manual','Pago confirmado desde Centro de Control V163');renderMembers();status('Pago confirmado. La nueva renovación es el '+dateLabel(next)+'.');openMessageModal(Object.assign({},m,{fecha_vencimiento:next}),'payment_received',false,{precio_pagado:String(price)});}catch(e){status('No se confirmó el pago: '+clean(e&&e.message),true);}finally{btn.disabled=false;}
  }
  async function extendMember(m){var days=Number(window.prompt('¿Cuántos días quieres agregar al acceso?','7'));if(!(days>0&&days<=365))return;var r=recordFor(m),next=addDays(laterDate(r.next_renewal||m.fecha_vencimiento,isoDate(today())),days);try{r.next_renewal=next;r.status='active';await updateMember(m,{fecha_vencimiento:next,estado:'activo'});await saveRecord(r);renderMembers();status('Acceso extendido hasta el '+dateLabel(next)+'.');}catch(e){status(clean(e&&e.message)||'No se pudo extender.',true);}}
  async function graceMember(m){var days=Number(window.prompt('¿Cuántos días de gracia quieres dar?','3'));if(!(days>0&&days<=30))return;var r=recordFor(m),until=addDays(laterDate(r.next_renewal||m.fecha_vencimiento,isoDate(today())),days);try{r.grace_until=until;r.next_renewal=until;r.status='grace';await updateMember(m,{fecha_vencimiento:until,estado:'activo'});await saveRecord(r);renderMembers();status('Periodo de gracia activo hasta el '+dateLabel(until)+'.');}catch(e){status(clean(e&&e.message)||'No se pudo aplicar la gracia.',true);}}
  async function suspendMember(m){if(!window.confirm('¿Suspender el acceso de '+clean(m.nombre)+'?'))return;var r=recordFor(m);try{r.status='suspended';await updateMember(m,{estado:'suspendido'});await saveRecord(r);renderMembers();status('Acceso suspendido.');openMessageModal(m,'suspension');}catch(e){status(clean(e&&e.message)||'No se pudo suspender.',true);}}
  async function reactivateMember(m){var r=recordFor(m),d=daysUntil(r.next_renewal||m.fecha_vencimiento);if(d!=null&&d<0){window.alert('La fecha ya venció. Confirma el pago o extiende el acceso antes de reactivar.');return;}try{r.status='active';await updateMember(m,{estado:'activo'});await saveRecord(r);renderMembers();status('Acceso reactivado.');openMessageModal(m,'reactivation');}catch(e){status(clean(e&&e.message)||'No se pudo reactivar.',true);}}

  async function savePlans(btn){
    var a=app(),next=clone(a&&a.state&&a.state.planes||{}),error='';
    document.querySelectorAll('#vip-v163-center [data-plan]').forEach(function(card){var key=card.dataset.plan,p=Object.assign({},next[key]||{});card.querySelectorAll('[data-plan-field]').forEach(function(el){var k=el.dataset.planField,v=el.type==='checkbox'?el.checked:el.value;if(['founderMonths','founderPrice','regularPrice'].indexOf(k)>=0)v=number(v);p[k]=v;});if(!clean(p.nombre))error='Cada plan necesita un nombre.';if(number(p.founderPrice)<1||number(p.regularPrice)<1)error='Los precios deben ser mayores a cero.';if(number(p.regularPrice)<number(p.founderPrice))error='El precio regular no debe ser menor al precio fundador.';p.visible=true;p.precio=String(founderOfferActive(p)?number(p.founderPrice):number(p.regularPrice));p.membershipModelVersion=163;next[key]=p;});
    if(error){status(error,true);return;}if(next[HIDDEN_PLAN_KEY])next[HIDDEN_PLAN_KEY]=Object.assign({},next[HIDDEN_PLAN_KEY],{visible:false,membershipModelVersion:163});
    btn.disabled=true;status('Publicando los dos planes y comprobando Supabase…');
    await new Promise(function(resolve){a.setState({planes:next},resolve);});localSet('vip_planes',next);
    var ok=typeof a.saveKV==='function'?await a.saveKV('vip_planes',next,function(msg){status(msg,/^❌/.test(msg||''));}):false;btn.disabled=false;renderPlans();status(ok?'Planes publicados: VIP y VIP Pro quedaron actualizados.':'Los cambios quedaron en este dispositivo, pero Supabase no confirmó la publicación.',!ok);
  }

  function suggestedTemplate(m){var r=recordFor(m),d=daysUntil(r.next_renewal||m.fecha_vencimiento);if(m.estado==='suspendido'||r.status==='suspended')return'suspension';if(d!=null&&d<0)return'payment_late';if(d===0)return'renewal_today';if(r.founder_active&&number(r.founder_month)===number(r.founder_total)-1)return'founder_final';return'renewal_soon';}
  function openMessageModal(m,key,isTest,extra){
    var old=document.getElementById('vip-v163-message-modal');if(old)old.remove();key=key||suggestedTemplate(m);var root=document.createElement('div');root.id='vip-v163-message-modal';root.dataset.member=memberId(m);root._vipMember=m;root._vipExtra=extra||{};
    root.innerHTML='<div class="vip-v163-message-box" role="dialog" aria-modal="true"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h3>Mensaje para '+esc(m.nombre||'integrante')+'</h3><p>Elige una plantilla; el precio, plan y fecha ya vienen completados.</p></div><button class="vip-v163-close" style="background:#f3edf6;color:#4d226e" type="button">×</button></div><div class="vip-v163-field"><label>TIPO DE MENSAJE</label><select id="vip-v163-message-select">'+TEMPLATE_DEFS.map(function(x){return'<option value="'+x[0]+'" '+(x[0]===key?'selected':'')+'>'+esc(x[1])+'</option>';}).join('')+'</select></div><div class="vip-v163-preview" id="vip-v163-message-preview" style="margin-top:11px"></div><div class="vip-v163-split-actions"><button class="vip-v163-btn" data-modal-action="copy">Copiar mensaje</button><button class="vip-v163-btn green" data-modal-action="whatsapp">Abrir WhatsApp</button></div></div>';
    document.body.appendChild(root);var update=function(){var k=root.querySelector('select').value;root.querySelector('#vip-v163-message-preview').textContent=messageText(m,k,root._vipExtra);};update();root.querySelector('select').onchange=update;root.querySelector('.vip-v163-close').onclick=function(){root.remove();};root.onclick=async function(e){if(e.target===root){root.remove();return;}var b=e.target.closest('[data-modal-action]');if(!b)return;var k=root.querySelector('select').value,textValue=messageText(m,k,root._vipExtra);if(b.dataset.modalAction==='copy'){await copyText(textValue);b.textContent='Copiado ✓';await logMessage(m,k,textValue,'copied');}else{openWhatsApp(m.whatsapp,textValue);await logMessage(m,k,textValue,'opened');}};
  }
  async function copyText(textValue){try{await navigator.clipboard.writeText(textValue);return true;}catch(_){var ta=document.createElement('textarea');ta.value=textValue;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(__){}ta.remove();return true;}}
  function openWhatsApp(phone,textValue){var n=whatsapp(phone);if(!n){window.alert('Esta persona no tiene un WhatsApp válido registrado.');return;}window.open('https://wa.me/'+n+'?text='+encodeURIComponent(textValue),'_blank','noopener');}

  async function createTrial(btn){
    var c=client(),name=clean(document.getElementById('vip-v163-trial-name').value),phone=clean(document.getElementById('vip-v163-trial-phone').value),code=clean(document.getElementById('vip-v163-trial-code').value).toUpperCase(),plan=document.getElementById('vip-v163-trial-plan').value;if(!name||whatsapp(phone).length<12||!code){status('Escribe nombre, WhatsApp y código individual.',true);return;}if(!c){status('No hay conexión con Supabase para crear el pase.',true);return;}
    btn.disabled=true;status('Creando el código privado en Supabase…');
    var end=new Date();end.setDate(end.getDate()+30);
    var data={id:'',nombre:'Pase 7 días · '+name,codigo:code,plan:plan,duracion_dias:7,cupo_maximo:1,estado:'activa',fecha_inicio:new Date().toISOString(),fecha_fin:end.toISOString(),origen:'Compradora de plantillas · '+phone,texto_boton:'Canjear mi pase privado',mensaje_publico:'Pase personal de cortesía para una clienta de plantillas.',un_uso_por_whatsapp:true,solo_nuevos:true,activacion_automatica:true,mostrar_boton:true};
    try{var r=await c.rpc('vip_promocion_admin_guardar',{p_datos:data});if(r.error)throw r.error;if(!r.data||r.data.ok!==true)throw new Error(r.data&&r.data.mensaje||'Supabase no confirmó el código.');var base=(location.origin&&location.origin!=='null'?location.origin+location.pathname:'https://club-vip-my.vercel.app/'),link=base+(base.indexOf('?')>=0?'&':'?')+'canjear='+encodeURIComponent(code);var tempMember={nombre:name,whatsapp:phone,codigo_vip:code,plan:plan,fecha_vencimiento:addDays(today(),7)};var message=messageText(tempMember,'trial_activation',{enlace_acceso:link,codigo_vip:code});state.trialResult={code:code,phone:phone,link:link,message:message};state.trialCode=nextTrialCode();renderTrials();status('Pase privado creado. Ya puedes copiarlo o enviarlo por WhatsApp.');}catch(e){status('No se creó el pase: '+clean(e&&e.message)+'. Revisa que el SQL de promociones automáticas esté activo.',true);}finally{btn.disabled=false;}
  }

  function ensureHub(){
    var a=app(),s=a&&a.state;if(!(a&&s&&s.view==='admin'&&s.adminSection==='hub'))return;var host=document.getElementById('vip-v162-control-groups')||document.querySelector('.vip-v58-admin-grid');if(!host||document.getElementById('vip-v163-hub-group'))return;
    var sec=document.createElement('section');sec.id='vip-v163-hub-group';sec.className='vip-v163-hub-group';sec.innerHTML='<div class="vip-v163-hub-head"><h2>💼 Ventas, membresías y comunicación</h2><p>Controla tus dos planes, precios fundadores, renovaciones y mensajes sin editar el código.</p></div><div class="vip-v163-hub-grid"><button class="vip-v163-hub-card" data-open-v163="members"><span class="vip-v163-hub-icon">💳</span><b>Control de membresías y renovaciones</b><small>Pagos manuales, próxima fecha, gracia, suspensión y mes fundador.</small><em>Abrir control →</em></button><button class="vip-v163-hub-card" data-open-v163="plans"><span class="vip-v163-hub-icon">👑</span><b>Planes VIP y precio fundador</b><small>VIP y VIP Pro, precios editables, meses, fechas y colores.</small><em>Configurar planes →</em></button><button class="vip-v163-hub-card" data-open-v163="messages"><span class="vip-v163-hub-icon">💬</span><b>Comunicación y mensajes</b><small>Bienvenida, renovación, pago, suspensión, clases y contenido nuevo.</small><em>Editar mensajes →</em></button><button class="vip-v163-hub-card" data-open-v163="trials"><span class="vip-v163-hub-icon">🎁</span><b>Pases privados de 7 días</b><small>Código único para compradoras de plantillas; no aparece como plan público.</small><em>Crear pase →</em></button></div>';
    var first=host.firstElementChild;if(first)host.insertBefore(sec,first);else host.appendChild(sec);sec.onclick=function(e){var b=e.target.closest('[data-open-v163]');if(b)openCenter(b.dataset.openV163);};
  }

  function decoratePlans(){
    var a=app(),plans=a&&a.state&&a.state.planes;if(!plans)return;var cards=Array.prototype.slice.call(document.querySelectorAll('.vip-v120-plan-card')),used=[];
    PLAN_KEYS.forEach(function(key){var p=plans[key]||{},name=clean(p.nombre)||planName(key),card=cards.find(function(c){return used.indexOf(c)<0&&clean(c.textContent).toLowerCase().indexOf(name.toLowerCase())>=0;});if(!card)return;used.push(card);card.classList.add('vip-v163-plan-public');card.style.setProperty('--v163-offer-color',p.colorPrincipal||planDefaults(key).colorPrincipal);card.style.setProperty('--v163-offer-accent',p.colorAccent||planDefaults(key).colorAccent);var old=card.querySelector('.vip-v163-offer-banner');if(!founderOfferActive(p)){if(old)old.remove();return;}var signature=[p.founderPrice,p.regularPrice,p.founderMonths,p.founderEndDate,p.founderMax,p.founderLabel].join('|');if(old&&old.dataset.signature===signature)return;if(!old){old=document.createElement('div');old.className='vip-v163-offer-banner';var title=card.querySelector('h2,h3');if(title&&title.parentNode)title.parentNode.insertBefore(old,title.nextSibling);else card.insertBefore(old,card.firstChild);}old.dataset.signature=signature;var limit=p.founderEndDate?' Disponible para nuevas fundadoras hasta el '+dateLabel(p.founderEndDate)+'.':'';if(p.founderMax)limit+=' Cupo máximo: '+number(p.founderMax)+' personas.';old.innerHTML='<b>🌟 '+esc(p.founderLabel||'Precio fundador')+': '+money(p.founderPrice)+'/mes</b><span>Durante tus primeros '+number(p.founderMonths,3)+' meses; después '+money(p.regularPrice)+'/mes.'+esc(limit)+'</span>';});
  }

  function enforceMonthlyMemberships(){
    var a=app();
    if(a&&a.state&&a.state.loginDur!=='mensual'&&!a.__vipV163MonthlyPending){
      a.__vipV163MonthlyPending=true;
      a.setState({loginDur:'mensual'},function(){a.__vipV163MonthlyPending=false;});
    }
    var head=document.querySelector('.vip-v121-plans-head');
    if(head){
      Array.prototype.forEach.call(head.querySelectorAll('div'),function(x){
        if(clean(x.textContent).indexOf('Puedes iniciar mensual o ahorrar pagando')===0)x.textContent='Membresías mensuales, sin plazo forzoso. El precio fundador cambia automáticamente al precio regular al terminar sus meses.';
      });
    }
    var note=document.querySelector('.vip-v121-duration-note');
    if(note)note.textContent='Elige VIP o VIP Pro. Los importes se muestran en MXN y la renovación actual se confirma manualmente por WhatsApp.';
  }

  function protectPrivateTrial(){
    var wrap=document.querySelector('.vip-promo-7dias-visible');if(!wrap)return;var params=new URLSearchParams(location.search),code=params.get('canjear');if(!code){wrap.classList.add('vip-v163-private-hide');return;}wrap.classList.remove('vip-v163-private-hide');wrap.style.removeProperty('display');var toggle=document.getElementById('vip-redeem-toggle'),panel=document.getElementById('vip-redeem-panel'),input=document.getElementById('vip-redeem-code');if(input&&input.value!==code)input.value=code;if(panel&&(panel.hasAttribute('hidden')||panel.style.display==='none')&&toggle)try{toggle.click();}catch(_){}if(wrap.scrollIntoView&&!wrap.dataset.v163Scrolled){wrap.dataset.v163Scrolled='1';setTimeout(function(){wrap.scrollIntoView({behavior:'smooth',block:'center'});},700);}}

  function addSectionNote(){
    var a=app(),s=a&&a.state;if(!(a&&s&&s.view==='admin'&&(s.adminSection==='planesedit'||s.adminSection==='membresias')))return;var body=document.querySelector('.vip-admin-shell')||document.querySelector('.vip-admin-content');if(!body||body.querySelector('.vip-v163-section-note'))return;var note=document.createElement('div');note.className='vip-v163-section-note vip-v163-note';note.style.margin='12px 16px';note.innerHTML='<b>Nuevo control comercial:</b> los precios fundadores, mensualidades y mensajes de renovación ahora se administran desde <button type="button" style="border:0;background:none;color:#6d3aa0;font-weight:900;cursor:pointer">Planes y precio fundador</button>.';note.querySelector('button').onclick=function(){openCenter(s.adminSection==='planesedit'?'plans':'members');};var back=body.querySelector('.vip-admin-back-wrap');if(back&&back.nextSibling)body.insertBefore(note,back.nextSibling);else body.insertBefore(note,body.firstChild);}

  function ensure(){installPlanNormalization();enforceMonthlyMemberships();ensureHub();decoratePlans();protectPrivateTrial();addSectionNote();}
  var timer=0;function schedule(){if(timer)return;timer=setTimeout(function(){timer=0;ensure();},90);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){var msg=document.getElementById('vip-v163-message-modal');if(msg)msg.remove();else closeCenter();}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure,{once:true});else ensure();
  setInterval(ensure,1000);
})();
