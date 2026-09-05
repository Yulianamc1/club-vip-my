(function(){
  'use strict';
  if(window.__MY_RUNTIME_V196__) return;
  window.__MY_RUNTIME_V196__ = true;
  window.__MY_BUILD__ = 'V196-DIAMOND-CONSOLIDATED';

  function visibleBindings(){
    try{
      var body=document.body;if(!body)return [];
      var out=[];
      function has(v){return typeof v==='string'&&(v.indexOf('{{')>=0||v.indexOf('}}')>=0);}
      var walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);var n;
      while((n=walker.nextNode())){
        var p=n.parentElement;
        if(p&&/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName))continue;
        if(has(n.nodeValue)){out.push((n.nodeValue||'').trim().slice(0,120));if(out.length>=20)break;}
      }
      if(out.length<20){
        var els=body.querySelectorAll('input,textarea,select,option,*');
        for(var i=0;i<els.length&&out.length<20;i++){
          var el=els[i];if(/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName))continue;
          if('value' in el&&has(el.value))out.push(String(el.value).slice(0,120));
          for(var j=0;j<el.attributes.length&&out.length<20;j++)if(has(el.attributes[j].value))out.push(el.tagName.toLowerCase()+'@'+el.attributes[j].name);
        }
      }
      return out;
    }catch(_){return ['diagnostic_error'];}
  }
  function duplicateIds(){
    var seen=Object.create(null),dupes=[];
    try{document.querySelectorAll('[id]').forEach(function(el){var id=el.id;if(!id)return;if(seen[id]&&!dupes.includes(id))dupes.push(id);else seen[id]=1;});}catch(_){}
    return dupes;
  }
  function overflow(){
    try{
      var root=document.documentElement;
      var extra=Math.max(0,(root.scrollWidth||0)-(root.clientWidth||0));
      return {extraPx:extra,ok:extra<=1,scrollWidth:root.scrollWidth||0,clientWidth:root.clientWidth||0};
    }catch(_){return {extraPx:null,ok:false};}
  }
  function run(){
    var bindings=visibleBindings(),dupes=duplicateIds(),ov=overflow();
    var currentFinance=window.__VIP_FINANCE_CONTROL_V196__===true;
    var loadedFinanceControllers=Array.from(document.scripts||[]).map(function(x){return String(x.src||'');}).filter(function(src){return /finanzas-control-/i.test(src);});
    var uniqueFinanceControllers=Array.from(new Set(loadedFinanceControllers));
    var activeAuthorityCount=currentFinance?1:0;
    var result={
      build:'V196-DIAMOND-CONSOLIDATED',
      runtime:true,
      financeControl:currentFinance,
      financeControllerFiles:uniqueFinanceControllers,
      singleFinanceAuthority:activeAuthorityCount===1&&uniqueFinanceControllers.length<=1,
      visibleBindings:bindings,
      duplicateIds:dupes,
      overflow:ov,
      pass:bindings.length===0&&dupes.length===0&&ov.ok&&currentFinance&&uniqueFinanceControllers.length<=1
    };
    window.__MY_V196_LAST_DIAGNOSTIC__=result;
    return result;
  }
  window.vipV196RunDiagnostics=run;
  window.addEventListener('load',function(){setTimeout(run,250);},{once:true});
})();
