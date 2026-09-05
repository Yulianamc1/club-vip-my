(function(){
'use strict';
if(window.__MY_GROWTH_V196__) return;
window.__MY_GROWTH_V196__=true;

var ATTR_KEY='my_growth_attribution_v196';
var ATTR_LINK_KEY='my_growth_attribution_link_v196';
var OVERLAY_ID='my-growth-admin-v196';
var MAXLEN={source:120,campaign:180,ad:180,product_origin:180,promotion_origin:180,utm_medium:120,utm_term:180,utm_content:180,fbclid:240,external_reference:240};

function clip(v,n){return String(v==null?'':v).trim().slice(0,n||180)}
function safeJson(v,f){try{return JSON.parse(v)}catch(_){return f}}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function storeGet(k){try{return safeJson(localStorage.getItem(k)||'',null)}catch(_){return null}}
function storeSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(_){return false}}
function sessionGet(k){try{return safeJson(sessionStorage.getItem(k)||'',null)}catch(_){return null}}

function collectAttribution(){
  var prior=storeGet(ATTR_KEY)||{};
  var q={};
  try{
    var p=new URLSearchParams(location.search||'');
    ['utm_source','utm_campaign','utm_medium','utm_term','utm_content','fbclid','source','campaign','ad','ad_id','product_origin','product','promotion_origin','promotion'].forEach(function(k){
      var v=p.get(k);if(v!=null&&String(v).trim())q[k]=String(v).trim();
    });
  }catch(_){}
  var hasNew=Object.keys(q).length>0;
  var out={
    source:clip(q.source||q.utm_source||prior.source,MAXLEN.source),
    campaign:clip(q.campaign||q.utm_campaign||prior.campaign,MAXLEN.campaign),
    ad:clip(q.ad||q.ad_id||q.utm_content||prior.ad,MAXLEN.ad),
    product_origin:clip(q.product_origin||q.product||prior.product_origin,MAXLEN.product_origin),
    promotion_origin:clip(q.promotion_origin||q.promotion||prior.promotion_origin,MAXLEN.promotion_origin),
    utm_medium:clip(q.utm_medium||prior.utm_medium,MAXLEN.utm_medium),
    utm_term:clip(q.utm_term||prior.utm_term,MAXLEN.utm_term),
    utm_content:clip(q.utm_content||prior.utm_content,MAXLEN.utm_content),
    fbclid:clip(q.fbclid||prior.fbclid,MAXLEN.fbclid),
    first_captured_at:prior.first_captured_at||new Date().toISOString(),
    last_captured_at:hasNew?new Date().toISOString():(prior.last_captured_at||new Date().toISOString())
  };
  if(hasNew||!prior.first_captured_at) storeSet(ATTR_KEY,out);
  return out;
}

function currentAttribution(){return collectAttribution()}
function currentMember(){
  var a=storeGet('vip_member_auth');
  if(!(a&&a.codigo&&a.whatsapp)) return null;
  return {codigo:String(a.codigo),whatsapp:String(a.whatsapp),plan:String(a.plan||'')};
}
function currentClient(){
  return window.__VIP_CONFIG_CLIENT__||(window.__VIP_APP__&&window.__VIP_APP__.sb)||window.__VIP_PROMO_SB__||null;
}
async function waitClient(){
  for(var i=0;i<50;i++){var c=currentClient();if(c)return c;await new Promise(function(r){setTimeout(r,100)})}
  return null;
}
function pendingExternalReference(){var p=sessionGet('vip_trial_pending');return clip(p&&p.external_reference,MAXLEN.external_reference)}
function attributionPayload(){var a=currentAttribution(),p={};Object.keys(MAXLEN).forEach(function(k){if(k!=='external_reference'&&a[k])p[k]=clip(a[k],MAXLEN[k])});var ext=pendingExternalReference();if(ext)p.external_reference=ext;return p}
function stableSig(v){try{return btoa(unescape(encodeURIComponent(JSON.stringify(v)))).slice(0,900)}catch(_){return JSON.stringify(v)}}

async function linkAttribution(){
  var m=currentMember();if(!m)return false;
  var payload=attributionPayload();
  if(!Object.keys(payload).some(function(k){return k!=='external_reference'&&payload[k]} )&&!payload.external_reference)return false;
  var marker=m.codigo+'|'+stableSig(payload),old=storeGet(ATTR_LINK_KEY);
  if(old&&old.marker===marker)return true;
  var c=await waitClient();if(!c||!c.rpc)return false;
  try{
    var r=await c.rpc('vip_growth_attribution_capture',{p_codigo:m.codigo,p_whatsapp:m.whatsapp,p_attribution:payload});
    if(r.error||!r.data||r.data.ok!==true)return false;
    storeSet(ATTR_LINK_KEY,{marker:marker,at:new Date().toISOString()});return true;
  }catch(_){return false}
}

async function reportValueAction(detail){
  detail=detail||{};
  if(String(detail.action||'')!=='tool_result_saved')return false;
  var m=currentMember();if(!m)return false;
  var ref=clip(detail.reference,180);if(!ref)return false;
  var meta=detail.metadata&&typeof detail.metadata==='object'?detail.metadata:{};
  var safeMeta={tool:clip(meta.tool,80)};
  var c=await waitClient();if(!c||!c.rpc)return false;
  try{
    var r=await c.rpc('vip_growth_value_action',{p_codigo:m.codigo,p_whatsapp:m.whatsapp,p_action:'tool_result_saved',p_reference:ref,p_metadata:safeMeta});
    return !(r.error||!r.data||r.data.ok!==true);
  }catch(_){return false}
}

function localDateISO(d){var y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day}
function dateRange(kind){
  var now=new Date(),from=new Date(now),to=new Date(now);
  if(kind==='today'){from.setHours(0,0,0,0)}
  else if(kind==='7d'){from.setDate(from.getDate()-6);from.setHours(0,0,0,0)}
  else if(kind==='30d'){from.setDate(from.getDate()-29);from.setHours(0,0,0,0)}
  else if(kind==='month'){from=new Date(now.getFullYear(),now.getMonth(),1);from.setHours(0,0,0,0)}
  return {from:from,to:to};
}
function pct(v){var n=Number(v||0);return (Number.isFinite(n)?n:0).toFixed(1)+'%'}
function nfmt(v){return Number(v||0).toLocaleString('es-MX')}
function style(){
  if(document.getElementById('my-growth-style-v196'))return;
  var s=document.createElement('style');s.id='my-growth-style-v196';s.textContent='\
#'+OVERLAY_ID+'{position:fixed;inset:0;z-index:2147483300;background:rgba(20,10,31,.64);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}\
#'+OVERLAY_ID+' .myg-shell{width:min(1180px,100%);background:#fff;border-radius:24px;box-shadow:0 28px 80px rgba(26,10,39,.28);overflow:hidden;margin:auto}\
#'+OVERLAY_ID+' .myg-head{padding:20px 22px;background:linear-gradient(135deg,#2d1246,#6d3aa0);color:#fff;display:flex;justify-content:space-between;gap:14px;align-items:center}\
#'+OVERLAY_ID+' .myg-head h2{margin:0;font-size:clamp(20px,3vw,30px)} #'+OVERLAY_ID+' .myg-head p{margin:5px 0 0;opacity:.88}\
#'+OVERLAY_ID+' button{font:inherit} #'+OVERLAY_ID+' .myg-close{border:0;border-radius:14px;background:#fff;color:#32164b;padding:10px 14px;font-weight:800;cursor:pointer}\
#'+OVERLAY_ID+' .myg-body{padding:18px;background:#f8f5fb}.myg-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:14px}.myg-btn{border:1px solid #dfd2e9;background:#fff;border-radius:12px;padding:9px 12px;font-weight:800;color:#3b2050;cursor:pointer}.myg-btn.active{background:#4b2469;color:#fff;border-color:#4b2469}.myg-field{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:800;color:#54386a}.myg-field[hidden]{display:none!important}.myg-field input,.myg-field select{min-height:39px;border:1px solid #d8c9e3;border-radius:10px;padding:7px 9px;background:#fff}.myg-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.myg-card{background:#fff;border:1px solid #eadff0;border-radius:16px;padding:14px}.myg-card small{display:block;color:#765f86;font-weight:700}.myg-card b{display:block;font-size:26px;color:#311648;margin-top:5px}.myg-wide{grid-column:1/-1}.myg-cols{display:grid;grid-template-columns:1.4fr 1fr;gap:12px;margin-top:12px}.myg-funnel{display:grid;gap:8px}.myg-step{display:grid;grid-template-columns:160px 1fr 66px;gap:10px;align-items:center}.myg-bar{height:18px;background:#eee6f3;border-radius:999px;overflow:hidden}.myg-bar i{display:block;height:100%;background:linear-gradient(90deg,#6d3aa0,#b878d4);border-radius:inherit}.myg-list{display:grid;gap:7px}.myg-row{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #eee5f3;padding:7px 0}.myg-note{font-size:12px;color:#705e7a;line-height:1.45}.myg-error{padding:18px;color:#8a1d2d;background:#fff0f2;border-radius:14px}.myg-loading{padding:28px;text-align:center;color:#644a74;font-weight:800}@media(max-width:800px){#'+OVERLAY_ID+'{padding:8px}.myg-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.myg-cols{grid-template-columns:1fr}.myg-step{grid-template-columns:120px 1fr 55px}.myg-card b{font-size:22px}}';document.head.appendChild(s);
}
function shellHtml(){return '<div class="myg-shell"><div class="myg-head"><div><h2>📈 Crecimiento y Suscripciones</h2><p>Embudo, conversión, renovaciones y salud del ciclo de suscripción.</p></div><button class="myg-close" type="button">Cerrar</button></div><div class="myg-body"><div class="myg-controls"><button class="myg-btn active" data-range="today">Hoy</button><button class="myg-btn" data-range="7d">7 días</button><button class="myg-btn" data-range="30d">30 días</button><button class="myg-btn" data-range="month">Mes</button><button class="myg-btn" data-range="custom">Personalizado</button><label class="myg-field" data-custom-date hidden>Desde<input type="date" data-from disabled></label><label class="myg-field" data-custom-date hidden>Hasta<input type="date" data-to disabled></label><label class="myg-field">Plan<select data-plan><option value="">Todos</option><option value="VIP">VIP</option><option value="VIP Pro">VIP PREMIUM</option></select></label><label class="myg-field">Fuente<input type="text" data-source placeholder="Meta, orgánico…"></label><label class="myg-field">Campaña<input type="text" data-campaign placeholder="Campaña"></label><label class="myg-field">Anuncio<input type="text" data-ad placeholder="Anuncio"></label><label class="myg-field">Producto origen<input type="text" data-product placeholder="Producto digital"></label><button class="myg-btn" data-refresh>Actualizar</button></div><div data-content class="myg-loading">Calculando métricas…</div></div></div>'}
function kpi(label,val,sub){return '<div class="myg-card"><small>'+esc(label)+'</small><b>'+esc(val)+'</b>'+(sub?'<div class="myg-note">'+esc(sub)+'</div>':'')+'</div>'}
function renderPanel(root,data){
  var k=data.kpis||{},f=Array.isArray(data.funnel)?data.funnel:[],seg=data.segments||{};
  var max=Math.max.apply(null,[1].concat(f.map(function(x){return Number(x.value||0)})));
  var funnel=f.map(function(x){var w=Math.max(2,Math.round(Number(x.value||0)*100/max));return '<div class="myg-step"><span>'+esc(x.label)+'</span><div class="myg-bar"><i style="width:'+w+'%"></i></div><b>'+nfmt(x.value)+'</b></div>'}).join('');
  var sources=(seg.sources||[]).map(function(x){return '<div class="myg-row"><span>'+esc(x.source)+'</span><b>'+nfmt(x.users)+'</b></div>'}).join('')||'<div class="myg-note">Sin datos de fuente todavía.</div>';
  var campaigns=(seg.campaigns||[]).map(function(x){return '<div class="myg-row"><span>'+esc(x.campaign)+'</span><b>'+nfmt(x.users)+'</b></div>'}).join('')||'<div class="myg-note">Sin datos de campaña todavía.</div>';
  var ads=(seg.ads||[]).map(function(x){return '<div class="myg-row"><span>'+esc(x.ad)+'</span><b>'+nfmt(x.users)+'</b></div>'}).join('')||'<div class="myg-note">Sin datos de anuncio todavía.</div>';
  var products=(seg.products||[]).map(function(x){return '<div class="myg-row"><span>'+esc(x.product)+'</span><b>'+nfmt(x.users)+'</b></div>'}).join('')||'<div class="myg-note">Sin datos de producto de origen todavía.</div>';
  var plans=(seg.plans||[]).map(function(x){return '<div class="myg-row"><span>'+esc(x.plan==='VIP Pro'?'VIP PREMIUM':x.plan)+'</span><b>'+nfmt(x.users)+'</b></div>'}).join('')||'<div class="myg-note">Sin datos de plan todavía.</div>';
  root.innerHTML='<div class="myg-grid">'+
    kpi('Pruebas iniciadas',nfmt(k.trial_started))+
    kpi('Onboardings completados',nfmt(k.onboarding_completed))+
    kpi('Usuarias activadas',nfmt(k.activated))+
    kpi('Nuevas suscripciones',nfmt(k.subscription_started))+
    kpi('Renovaciones',nfmt(k.subscription_renewed))+
    kpi('Cancelaciones pagadas',nfmt(k.subscription_cancelled))+
    kpi('Pruebas canceladas',nfmt(k.trial_cancelled))+
    kpi('Pagos fallidos',nfmt(k.payment_failed))+
    kpi('Upgrades',nfmt(k.plan_upgraded))+
    kpi('Conversión prueba → pago',pct(k.trial_to_paid_pct),'Solo cohortes que ya terminaron prueba + gracia')+
    kpi('Retención primera renovación',pct(k.first_renewal_retention_pct),'Solo suscripciones que ya llegaron a su primera renovación')+
    kpi('Registros',nfmt(k.registered),'Primera etapa medible; no se crean cookies anónimas de visitantes')+
    '</div><div class="myg-cols"><div class="myg-card"><h3>Embudo de MY</h3><div class="myg-funnel">'+funnel+'</div><p class="myg-note">“Activada” exige onboarding + una acción real de valor; iniciar sesión no cuenta.</p></div><div><div class="myg-card"><h3>Fuentes</h3><div class="myg-list">'+sources+'</div></div><div class="myg-card" style="margin-top:12px"><h3>Campañas</h3><div class="myg-list">'+campaigns+'</div></div><div class="myg-card" style="margin-top:12px"><h3>Anuncios</h3><div class="myg-list">'+ads+'</div></div><div class="myg-card" style="margin-top:12px"><h3>Productos de origen</h3><div class="myg-list">'+products+'</div></div><div class="myg-card" style="margin-top:12px"><h3>Planes</h3><div class="myg-list">'+plans+'</div></div></div></div>';
}
async function loadPanel(overlay,kind){
  var c=await waitClient(),target=overlay.querySelector('[data-content]');if(!c||!c.rpc){target.innerHTML='<div class="myg-error">No se encontró una sesión segura de Supabase.</div>';return}
  var fromEl=overlay.querySelector('[data-from]'),toEl=overlay.querySelector('[data-to]'),planEl=overlay.querySelector('[data-plan]'),sourceEl=overlay.querySelector('[data-source]'),campaignEl=overlay.querySelector('[data-campaign]'),adEl=overlay.querySelector('[data-ad]'),productEl=overlay.querySelector('[data-product]'),r;
  if(kind==='custom'){
    var fs=fromEl.value,ts=toEl.value;if(!fs||!ts){target.innerHTML='<div class="myg-error">Selecciona las dos fechas.</div>';return}
    var fd=new Date(fs+'T00:00:00'),td=new Date(ts+'T00:00:00');td.setDate(td.getDate()+1);r={from:fd,to:td};
  }else r=dateRange(kind);
  target.className='myg-loading';target.textContent='Calculando métricas…';
  try{
    var filters={};if(planEl.value)filters.plan=planEl.value;if(sourceEl&&sourceEl.value.trim())filters.source=sourceEl.value.trim();if(campaignEl&&campaignEl.value.trim())filters.campaign=campaignEl.value.trim();if(adEl&&adEl.value.trim())filters.ad=adEl.value.trim();if(productEl&&productEl.value.trim())filters.product_origin=productEl.value.trim();
    var out=await c.rpc('vip_growth_admin_panel',{p_desde:r.from.toISOString(),p_hasta:r.to.toISOString(),p_filtros:filters});
    if(out.error)throw out.error;if(!out.data||out.data.ok!==true)throw new Error('No se obtuvo el panel.');
    target.className='';renderPanel(target,out.data);
  }catch(e){target.className='';target.innerHTML='<div class="myg-error">No se pudo cargar Crecimiento y Suscripciones. '+esc(e&&e.message||'')+'</div>'}
}
async function openAdmin(access){
  if(!access||access.rol!=='duena'){try{window.alert('Esta sección es exclusiva de la propietaria.')}catch(_){};return false}
  style();var old=document.getElementById(OVERLAY_ID);if(old)old.remove();var o=document.createElement('div');o.id=OVERLAY_ID;o.innerHTML=shellHtml();document.body.appendChild(o);
  var kind='today',from=o.querySelector('[data-from]'),to=o.querySelector('[data-to]'),today=new Date();from.value=localDateISO(today);to.value=localDateISO(today);
  o.querySelector('.myg-close').onclick=function(){o.remove()};o.addEventListener('click',function(e){if(e.target===o)o.remove()});
  o.querySelectorAll('[data-range]').forEach(function(b){b.onclick=function(){kind=b.dataset.range;o.querySelectorAll('[data-range]').forEach(function(x){x.classList.toggle('active',x===b)});var custom=kind==='custom';from.disabled=!custom;to.disabled=!custom;o.querySelectorAll('[data-custom-date]').forEach(function(x){x.hidden=!custom});if(!custom)loadPanel(o,kind)}});
  o.querySelector('[data-refresh]').onclick=function(){loadPanel(o,kind)};
  o.querySelector('[data-plan]').onchange=function(){loadPanel(o,kind)};
  ['[data-source]','[data-campaign]','[data-ad]','[data-product]'].forEach(function(sel){var el=o.querySelector(sel);if(el)el.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();loadPanel(o,kind)}}});
  await loadPanel(o,kind);return true;
}

function syncAdminCard(){
  var card=document.querySelector('[data-vip-growth-admin="1"]');if(!card)return;
  var a=window.__VIP_TEAM_ACCESS__;
  var owner=!!(a&&a.rol==='duena');
  card.hidden=!owner;card.style.display=owner?'':'none';
  if(owner&&!card.__myGrowthBound){card.__myGrowthBound=true;card.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openAdmin(window.__VIP_TEAM_ACCESS__)})}
}
var adminSyncQueued=false;function queueAdminSync(){if(adminSyncQueued)return;adminSyncQueued=true;setTimeout(function(){adminSyncQueued=false;syncAdminCard()},40)}
if(typeof MutationObserver!=='undefined'&&document.documentElement)new MutationObserver(queueAdminSync).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('vip-team-access-changed',queueAdminSync);

window.addEventListener('my-growth-value-action',function(e){reportValueAction(e&&e.detail)});
window.addEventListener('storage',function(e){if(e.key==='vip_member_auth')setTimeout(linkAttribution,150)});
document.addEventListener('visibilitychange',function(){if(!document.hidden)linkAttribution()});
collectAttribution();
setTimeout(linkAttribution,900);setTimeout(linkAttribution,3500);setTimeout(syncAdminCard,250);setTimeout(syncAdminCard,1200);

window.MYGrowthV196={
  getAttribution:attributionPayload,
  linkAttribution:linkAttribution,
  reportValueAction:reportValueAction,
  openAdmin:openAdmin,
  syncAdminCard:syncAdminCard
};
})();
