/* MY V196 DIAMANTE · Control financiero único
 * Una sola autoridad: permisos, apertura, tarjetas, Centro de Control y cierre de sesión.
 * Claves históricas se leen solo como compatibilidad de datos y nunca como lógica activa.
 */
(function(){
  'use strict';
  if(window.__VIP_FINANCE_CONTROL_V196__) return;
  window.__VIP_FINANCE_CONTROL_V196__=true;

  var BRIDGE='vip_finance_context_v1';
  var CONFIG_KEY='vip_finance_access';
  var LEGACY_CONFIG_KEYS=['vip_finance_access_v166'];
  var PATH='finanzas-clientes/index.html';
  var TTL=60000;
  var pending=null;

  function app(){return window.__VIP_APP__||null;}
  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
  function digits(v){return clean(v).replace(/\D/g,'');}
  function member(){var a=app(),s=a&&a.state;return a&&s&&s.view==='app'&&s.session?s.session:null;}
  function fp(s){return [clean(s&&s.codigo).toUpperCase(),digits(s&&s.whatsapp),clean(s&&s.correo||s&&s.email).toLowerCase()].join('|');}
  function client(){var a=app();return (a&&a.sb)||window.__VIP_CONFIG_CLIENT__||null;}
  function clearBridge(){try{sessionStorage.removeItem(BRIDGE);}catch(_){} }
  function emit(d){try{window.dispatchEvent(new CustomEvent('vip-finance-decision-updated',{detail:d}));}catch(_){} }
  function setDecision(d){window.__VIP_FINANCE_DECISION__=d;emit(d);return d;}
  function failDecision(fingerprint,message){clearBridge();return setDecision({status:'error',allowed:false,fingerprint:fingerprint||'',level:'none',modules:{},checkedAt:Date.now(),message:message||'No se pudo verificar el acceso.'});}

  async function ensure(force){
    var s=member();
    if(!s){pending=null;return setDecision({status:'idle',allowed:false,fingerprint:'',level:'none',modules:{},checkedAt:Date.now()});}
    var fingerprint=fp(s),old=window.__VIP_FINANCE_DECISION__;
    if(!force&&old&&old.status==='ok'&&old.fingerprint===fingerprint&&Date.now()-Number(old.checkedAt||0)<TTL)return old;
    if(pending&&pending.fingerprint===fingerprint)return pending.promise;
    var c=client();
    if(!c||typeof c.rpc!=='function')return failDecision(fingerprint,'Supabase todavía no está disponible.');
    setDecision({status:'pending',allowed:false,fingerprint:fingerprint,level:'none',modules:{},checkedAt:Date.now()});
    var promise=(async function(){
      try{
        var r=await c.rpc('vip_finanzas_acceso',{p_codigo:clean(s.codigo).toUpperCase(),p_whatsapp:clean(s.whatsapp)});
        if(r&&r.error)throw new Error(r.error.message||'RPC_ERROR');
        var d=r&&r.data;
        if(!(d&&d.ok===true))throw new Error((d&&d.mensaje)||'ACCESS_NOT_CONFIRMED');
        return setDecision({
          status:'ok',
          allowed:d.allowed===true,
          fingerprint:fingerprint,
          level:clean(d.level)||'none',
          modules:d.modules&&typeof d.modules==='object'?d.modules:{},
          plan:clean(d.plan)||clean(s.plan),
          storageIdentity:clean(d.storage_identity),
          legacyDbKeys:Array.isArray(d.legacy_db_keys)?d.legacy_db_keys.slice():[],
          checkedAt:Date.now()
        });
      }catch(e){return failDecision(fingerprint,(e&&e.message)||'No se pudo verificar Finanzas.');}
      finally{if(pending&&pending.fingerprint===fingerprint)pending=null;}
    })();
    pending={fingerprint:fingerprint,promise:promise};
    return promise;
  }

  async function openClient(ev){
    if(ev){try{ev.preventDefault();ev.stopPropagation();}catch(_){} }
    var s=member();
    if(!s){clearBridge();window.alert('Inicia sesión como integrante para abrir Mis Finanzas.');return false;}
    var d=await ensure(true);
    if(!(d&&d.status==='ok'&&d.allowed===true&&d.fingerprint===fp(s))){
      clearBridge();
      if(typeof window.vipV196ShowFinanceLocked==='function')window.vipV196ShowFinanceLocked(s);
      else window.alert('Finanzas no está habilitada para este acceso actual.');
      return false;
    }
    var payload={
      codigo:clean(s.codigo).toUpperCase(),
      whatsapp:clean(s.whatsapp),
      displayName:clean(s.nombre)||'Mi negocio',
      plan:clean(s.plan),
      financeAccess:true,
      financeLevel:d.level,
      financeModules:d.modules||{},
      verifiedAt:d.checkedAt,
      issuedAt:Date.now()
    };
    try{sessionStorage.setItem(BRIDGE,JSON.stringify(payload));}
    catch(_){window.alert('Tu navegador no permitió abrir el espacio privado. Revisa que el almacenamiento esté habilitado.');return false;}
    location.assign(new URL(PATH,location.href).href);
    return true;
  }

  function esc(v){return clean(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function planName(key){var a=app(),p=a&&a.state&&a.state.planes&&a.state.planes[key];return clean(p&&p.nombre)||({Básico:'21 DÍAS GRATIS CON CÓDIGO',VIP:'VIP','VIP Pro':'VIP PREMIUM'}[key]||key);}
  async function readFinanceConfig(){
    var c=client();if(!c||typeof c.rpc!=='function')throw new Error('Supabase no está disponible.');
    var r=await c.rpc('obtener_config');if(r&&r.error)throw new Error(r.error.message||'No se pudo leer la configuración.');
    var rows=Array.isArray(r&&r.data)?r.data:[];
    var row=rows.find(function(x){return x&&x.clave===CONFIG_KEY;})||rows.find(function(x){return x&&LEGACY_CONFIG_KEYS.indexOf(x.clave)>=0;});
    var cfg=row&&row.valor&&typeof row.valor==='object'?JSON.parse(JSON.stringify(row.valor)):{};
    cfg.visible=cfg.visible!==false;
    cfg.planDefaults=Object.assign({'Básico':'none','VIP':'advanced','VIP Pro':'advanced'},cfg.planDefaults||{});
    cfg.memberOverrides=cfg.memberOverrides&&typeof cfg.memberOverrides==='object'?cfg.memberOverrides:{};
    cfg.modules=cfg.modules&&typeof cfg.modules==='object'?cfg.modules:{};
    return cfg;
  }
  async function saveFinanceConfig(cfg){
    var c=client();if(!c||typeof c.rpc!=='function')throw new Error('Supabase no está disponible.');
    var r=await c.rpc('guardar_config_confirmada',{p_clave:CONFIG_KEY,p_valor:cfg});
    if(r&&r.error)throw new Error(r.error.message||'No se pudo guardar.');
    var d=r&&r.data;
    if(d===false||(d&&d.ok===false))throw new Error((d&&d.mensaje)||'Supabase no confirmó el guardado.');
    return d;
  }
  async function openAdmin(){
    var old=document.getElementById('vip-v196-finance-admin-overlay');if(old)old.remove();
    var a=app();if(!(a&&a.state&&a.state.view==='admin')){window.alert('Abre el Centro de Control como administradora.');return;}
    var o=document.createElement('div');o.id='vip-v196-finance-admin-overlay';o.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(23,10,34,.72);display:flex;align-items:center;justify-content:center;padding:18px';
    o.innerHTML='<div role="dialog" aria-modal="true" style="width:min(620px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:22px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.35);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><div style="font-size:28px">📊</div><h2 style="margin:6px 0;color:#2a1142">Accesos de Finanzas</h2><p style="color:#6f6578;line-height:1.5">Supabase es la única fuente de verdad para permisos. Define si cada plan puede abrir su dashboard privado de Ingresos, Egresos, Utilidad, Perfil Fiscal / SAT y Mi Meta.</p><div data-v196-finance-body style="margin-top:16px">Cargando configuración segura…</div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px"><button data-v196-close type="button" style="padding:11px 15px;border-radius:10px;border:1px solid #ddd;background:#fff">Cerrar</button><button data-v196-save type="button" disabled style="padding:11px 15px;border-radius:10px;border:0;background:#d4af37;color:#241733;font-weight:800">Guardar</button></div><div data-v196-status aria-live="polite" style="font-size:12px;margin-top:10px;color:#6f6578"></div></div>';
    document.body.appendChild(o);
    o.querySelector('[data-v196-close]').onclick=function(){o.remove();};o.onclick=function(e){if(e.target===o)o.remove();};
    var body=o.querySelector('[data-v196-finance-body]'),save=o.querySelector('[data-v196-save]'),status=o.querySelector('[data-v196-status]');
    try{
      var cfg=await readFinanceConfig();
      body.innerHTML='<label style="display:flex;gap:10px;align-items:center;padding:12px;border:1px solid #eee;border-radius:12px;margin-bottom:12px"><input data-global type="checkbox" '+(cfg.visible?'checked':'')+'><span><b>Mostrar Finanzas en MY</b><small style="display:block;color:#82778a">Si se apaga, nadie podrá abrir la herramienta.</small></span></label>'+['Básico','VIP','VIP Pro'].map(function(k){var level=cfg.planDefaults[k]==='advanced'?'advanced':'none';return '<label style="display:grid;grid-template-columns:1fr minmax(145px,190px);gap:12px;align-items:center;padding:12px;border:1px solid #eee;border-radius:12px;margin:8px 0"><span><b>'+esc(planName(k))+'</b><small style="display:block;color:#82778a">Clave técnica: '+esc(k)+'</small></span><select data-plan="'+esc(k)+'" style="padding:10px;border-radius:9px;border:1px solid #ddd;background:#fff"><option value="none" '+(level==='none'?'selected':'')+'>Sin acceso a Finanzas</option><option value="advanced" '+(level==='advanced'?'selected':'')+'>Finanzas completa · Ingresos, Egresos, Utilidad y Mi Meta</option></select></label>';}).join('');
      save.disabled=false;
      save.onclick=async function(){
        save.disabled=true;status.textContent='Guardando en Supabase…';
        try{
          cfg.visible=!!body.querySelector('[data-global]').checked;
          body.querySelectorAll('[data-plan]').forEach(function(sel){cfg.planDefaults[sel.dataset.plan]=sel.value==='advanced'?'advanced':'none';});
          await saveFinanceConfig(cfg);
          status.textContent='Guardado y confirmado en Supabase ✓';
          var s=member();if(s)await ensure(true);
        }catch(e){status.textContent='No se guardó ningún cambio. '+((e&&e.message)||'Revisa la conexión.');}
        finally{save.disabled=false;}
      };
    }catch(e){body.textContent='No pudimos cargar la configuración.';status.textContent=(e&&e.message)||'';}
  }

  window.vipV196EnsureFinanceDecision=ensure;
  window.vipV196OpenClientFinance=openClient;
  window.vipV196OpenFinanceAdmin=openAdmin;
  window.vipV196ClearFinanceBridge=clearBridge;

  function onState(){var s=member();if(!s){clearBridge();setDecision({status:'idle',allowed:false,fingerprint:'',level:'none',modules:{},checkedAt:Date.now()});return;}ensure(false);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',onState,{once:true});else onState();
  window.addEventListener('focus',function(){var s=member(),d=window.__VIP_FINANCE_DECISION__;if(s&&(!d||d.fingerprint!==fp(s)||Date.now()-Number(d.checkedAt||0)>TTL))ensure(true);});
})();


/* Integración visual vigente de Finanzas */

(function(){
  'use strict';
  if(window.__VIP_FINANCE_UI_V196__)return;
  window.__VIP_FINANCE_UI_V196__=true;
  var BRIDGE='vip_finance_context_v1',PATH='finanzas-clientes/index.html',timer=0;
  function app(){return window.__VIP_APP__||null;}
  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim();}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function member(){var a=app(),s=a&&a.state;if(!(a&&s&&s.view==='app'&&s.session&&s.session.codigo))return null;return s.session;}
  function planKey(session){var a=app(),plans=a&&a.state&&a.state.planes||{},raw=clean(session&&session.plan);if(plans[raw])return raw;var keys=Object.keys(plans),found=keys.find(function(k){return clean(plans[k]&&plans[k].nombre).toLowerCase()===raw.toLowerCase();});return found||raw||'Básico';}
  function defaultAccess(key){return key!=='Básico';}
  function sessionFp(session){return clean(session&&session.codigo).toUpperCase()+'|'+clean(session&&session.whatsapp).replace(/\D/g,'');}
  function hasAccess(session){var d=window.__VIP_FINANCE_DECISION__;return !!(d&&d.status==='ok'&&d.allowed===true&&d.fingerprint===sessionFp(session));}
  function clearBridge(){try{sessionStorage.removeItem(BRIDGE);}catch(_){}}
  function closeOverlay(){var o=document.getElementById('vip-v196-finance-overlay');if(o)o.remove();}
  function goMembership(){closeOverlay();var a=app();if(a&&a.state&&typeof a.setState==='function')a.setState({sub:'membresia'});}
  function showLocked(session){
    closeOverlay();clearBridge();var a=app(),plans=a&&a.state&&a.state.planes||{},key=planKey(session),name=clean(plans[key]&&plans[key].nombre)||key;
    var o=document.createElement('div');o.id='vip-v196-finance-overlay';o.innerHTML='<div class="vip-v196-finance-box" role="dialog" aria-modal="true" aria-labelledby="vip-v196-finance-title"><div class="vip-v196-finance-mark">🔒</div><h2 id="vip-v196-finance-title">Finanzas está disponible en otros planes</h2><p class="vip-v196-finance-intro">Puedes ver esta herramienta desde tu plan '+esc(name)+', pero necesitas un plan que incluya Finanzas para abrir tu espacio privado.</p><div class="vip-v196-finance-locked-benefits"><div><b>Registros fáciles:</b> ingresos, ventas, trabajos o servicios y gastos.</div><div><b>Organización:</b> facturas, SAT, régimen y cierre mensual.</div><div><b>Privacidad:</b> tus datos solo se cargan después de validar tu identidad y membresía.</div></div><div class="vip-v196-finance-overlay-actions"><button class="vip-v196-finance-primary" type="button" data-v196-finance-membership>Ver mi membresía</button><button class="vip-v196-finance-secondary" type="button" data-v196-finance-close>Cerrar</button></div></div>';
    document.body.appendChild(o);o.querySelector('[data-v196-finance-close]').onclick=closeOverlay;o.querySelector('[data-v196-finance-membership]').onclick=goMembership;o.onclick=function(e){if(e.target===o)closeOverlay();};
  }
  function openFinance(ev){
    if(window.vipV196OpenClientFinance) return window.vipV196OpenClientFinance(ev);
    if(ev){ev.preventDefault();ev.stopPropagation();}
    clearBridge();window.alert('Estamos verificando tu acceso a Finanzas. Inténtalo nuevamente en un momento.');
  }
  window.vipV196ShowFinanceLocked=showLocked;
  function membershipCard(){var all=document.querySelectorAll('div');for(var i=0;i<all.length;i++){if(clean(all[i].textContent)==='TU MEMBRESÍA'){var n=all[i];for(var j=0;n&&j<6;j++,n=n.parentElement){if(n.querySelector&&n.querySelector('a[href*="wa.me"]')&&clean(n.textContent).indexOf('TU MEMBRESÍA')>=0)return n;}}}return null;}
  function buildFinanceCard(id,tools){
    var s=member(),allowed=s&&hasAccess(s),card=document.createElement('section');card.id=id;card.className=(tools?'vip-v196-finance-tools-card ':'')+(allowed?'':'vip-v196-finance-locked');card.setAttribute('aria-label','Mis Finanzas');
    card.innerHTML='<div class="vip-v196-finance-icon" aria-hidden="true">📊</div><div class="vip-v196-finance-copy"><div class="vip-v196-finance-top"><h2>Mis Finanzas</h2><span class="vip-v196-finance-private">'+(allowed?'● INCLUIDO EN TU PLAN':'🔒 VISTA PREVIA')+'</span></div><p>Registra fácilmente <b>ingresos, ventas, trabajos o servicios y gastos</b>. También organiza facturas, SAT, régimen y tu cierre mensual.</p><p class="vip-v196-finance-backup-note">'+(allowed?'<b>Tu espacio es privado.</b> Tus registros se guardan localmente y se sincronizan de forma privada con tu identidad financiera; el respaldo cifrado sigue disponible como protección adicional.':'<b>Conoce la herramienta.</b> Puedes verla desde cualquier plan y solicitar acceso cuando la necesites.')+'</p></div><button class="vip-v196-finance-open" type="button">'+(allowed?'Abrir Mis Finanzas →':'Ver qué incluye 🔒')+'</button>';
    card.querySelector('button').onclick=openFinance;return card;
  }
  function ensureHomeCard(){var s=member(),old=document.getElementById('vip-v196-finance-card');if(!s){if(old)old.remove();return;}if(old&&old.dataset.v196Finance==='1')return;if(old)old.remove();var anchor=membershipCard();if(!anchor)return;var card=buildFinanceCard('vip-v196-finance-card',false);card.dataset.v196Finance='1';anchor.insertAdjacentElement('afterend',card);}
  function ensureToolsCard(){var s=member(),old=document.getElementById('vip-v196-finance-tools-card'),title=Array.prototype.find.call(document.querySelectorAll('.vip-v101-section-title'),function(x){return clean(x.textContent).indexOf('Herramientas de Venta')>=0;});if(!(s&&title)){if(old)old.remove();return;}if(old)return;var sub=title.nextElementSibling||title;sub.insertAdjacentElement('afterend',buildFinanceCard('vip-v196-finance-tools-card',true));}
  function ensureSidebar(){
    var s=member();if(!s){document.querySelectorAll('.vip-v196-finance-sidebar-finance').forEach(function(x){x.remove();});return;}
    var labels=Array.prototype.filter.call(document.querySelectorAll('button span'),function(x){return clean(x.textContent)==='Herramientas de Venta';});
    labels.forEach(function(label){var ref=label.closest('button');if(!ref||ref.nextElementSibling&&ref.nextElementSibling.classList.contains('vip-v196-finance-sidebar-finance'))return;var b=ref.cloneNode(true);b.classList.add('vip-v196-finance-sidebar-finance');b.removeAttribute('onclick');var spans=b.querySelectorAll('span'),labelCopy=Array.prototype.find.call(spans,function(x){return clean(x.textContent)==='Herramientas de Venta';});if(labelCopy){labelCopy.textContent='Finanzas';var icon=labelCopy.previousElementSibling,lock=labelCopy.nextElementSibling;if(icon)icon.textContent='▥';if(lock)lock.textContent=hasAccess(s)?'':'🔒';}else b.textContent='▥ Finanzas'+(hasAccess(s)?'':' 🔒');b.onclick=openFinance;ref.insertAdjacentElement('afterend',b);
    });
  }
  function syntheticCard(source,title,icon,desc,handler){var c=source.cloneNode(true),i=c.querySelector('.vip-admin-icon'),t=c.querySelector('.vip-admin-card-title'),d=c.querySelector('.vip-admin-card-sub');if(i)i.textContent=icon;if(t)t.textContent=title;if(d)d.textContent=desc;c.removeAttribute('id');c.removeAttribute('onclick');c.onclick=handler;return c;}
  function openFinanceAdmin(){
    if(window.vipV196OpenFinanceAdmin) return window.vipV196OpenFinanceAdmin();
    window.alert('La configuración segura de Finanzas todavía no terminó de cargar.');
  }
  
  function ensureControlCenter(){
    var a=app(),state=a&&a.state;if(!(a&&state&&state.view==='admin'&&state.adminSection==='hub'))return;var original=document.querySelector('.vip-v58-admin-grid');if(!original||document.getElementById('vip-v196-finance-control-groups'))return;var originals=Array.prototype.slice.call(original.children).filter(function(x){return x.classList&&x.classList.contains('vip-admin-card');}),byTitle={};originals.forEach(function(c){var t=c.querySelector('.vip-admin-card-title');if(t)byTitle[clean(t.textContent)]=c;});if(!originals.length)return;
    var actualAdminFinance=Array.prototype.find.call(document.querySelectorAll('button'),function(b){return !b.closest('#vip-v196-finance-control-groups')&&clean(b.textContent).indexOf('Administración, Finanzas y SAT')>=0;});
    var defs=[
      {title:'👥 Administración de clientes',desc:'Personas, atención y servicios que ofreces directamente a tus clientes.',items:['Miembros','Servicio al Cliente','Consultas Estratégicas']},
      {title:'👑 Mi plataforma y mi administración',desc:'Planes, cobros, accesos, promociones y la operación interna de tu plataforma.',items:['Membresías y Pagos','Beneficios por Plan','Accesos por Plan','Promos, Descuentos y Regalos','Países y monedas']},
      {title:'🧩 Herramientas y GPTs',desc:'Herramientas, ayudantes, materiales y experiencias que usan las integrantes.',items:['Herramientas del sistema','Ayudantes VIP','Material semanal, quincenal o mensual','Academia VIP','Clase Grupal Semanal Exclusiva','Gamificación']},
      {title:'📣 Contenido y navegación',desc:'Lo que publicas, destacas y acomodas para que las integrantes lo encuentren.',items:['Novedades del Club','Lo más poderoso','Tarjetas del Inicio','Barra lateral']}
    ];
    var used={},wrap=document.createElement('div');wrap.id='vip-v196-finance-control-groups';
    function addGroup(def,cards){if(!cards.length)return;var sec=document.createElement('section');sec.className='vip-v196-finance-control-group';sec.innerHTML='<div class="vip-v196-finance-control-group-head"><h2>'+esc(def.title)+'</h2><p>'+esc(def.desc)+'</p></div><div class="vip-admin-grid"></div>';var grid=sec.querySelector('.vip-admin-grid');cards.forEach(function(c){grid.appendChild(c);});wrap.appendChild(sec);}
    defs.forEach(function(def){var cards=[];def.items.forEach(function(name){var src=byTitle[name];if(!src)return;used[name]=true;var clone=src.cloneNode(true);clone.removeAttribute('id');clone.removeAttribute('onclick');clone.onclick=function(){src.click();};cards.push(clone);});if(def.title.indexOf('Mi plataforma')>=0&&actualAdminFinance){cards.push(syntheticCard(originals[0],'Mis Finanzas administrativas','💼','Tus suscripciones confirmadas, ingresos, egresos, utilidad, facturas, Perfil Fiscal / SAT y cierres.',function(){actualAdminFinance.click();}));}addGroup(def,cards);});
    addGroup({title:'📊 Finanzas de clientes',desc:'Controla quién puede usar su propio dashboard de Ingresos, Egresos, Utilidad, facturas, Perfil Fiscal / SAT y cierre mensual.'},[syntheticCard(originals[0],'Administración de Finanzas de clientes','📊','Elige qué planes pueden acceder; los demás la verán bloqueada.',openFinanceAdmin)]);
    var rest=originals.filter(function(c){var t=c.querySelector('.vip-admin-card-title');return t&&!used[clean(t.textContent)];}).map(function(src){var clone=src.cloneNode(true);clone.removeAttribute('id');clone.removeAttribute('onclick');clone.onclick=function(){src.click();};return clone;});addGroup({title:'Otras secciones',desc:'Accesos adicionales del Centro de Control.'},rest);
    original.style.display='none';var heading=original.previousElementSibling;if(heading&&heading.classList.contains('vip-admin-all-sections-title'))heading.textContent='Centro de Control organizado por áreas';original.insertAdjacentElement('beforebegin',wrap);
  }
  function wrapLogout(a){if(!a||a.__vipV196FinanceLogoutWrapped||typeof a.doLogout!=='function')return;var old=a.doLogout;a.__vipV196FinanceLogoutWrapped=true;a.doLogout=function(){clearBridge();return old.apply(this,arguments);};}
  function ensure(){var a=app();wrapLogout(a);var s=member();if(s&&window.vipV196EnsureFinanceDecision)window.vipV196EnsureFinanceDecision(false);if(s&&!hasAccess(s))clearBridge();ensureHomeCard();ensureToolsCard();ensureSidebar();ensureControlCenter();}
  function schedule(){if(timer)return;timer=setTimeout(function(){timer=0;ensure();},100);}
  function refreshDecisionUi(){document.querySelectorAll('#vip-v196-finance-card,#vip-v196-finance-tools-card,.vip-v196-finance-sidebar-finance').forEach(function(x){x.remove();});schedule();}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('vip-finance-decision-updated',refreshDecisionUi);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure,{once:true});else ensure();
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeOverlay();});
})();

