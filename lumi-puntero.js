(() => {
  'use strict';
  const simplify = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const selector = 'button,a[href],[role="button"],[role="tab"],input[type="button"],input[type="submit"],summary';
  let cursor, timer, busy=false;
  function parse(text) {
    const input=text.trim().replace(/^(?:oye\s+)?lumi[, ]+/i,'').replace(/^(?:por favor[, ]+)/i,'').replace(/[.!]+$/,'');
    if(/^(?:prueba|ensaya) (?:tu |el )?(?:mouse|raton|puntero)$/.test(simplify(input)))return {test:true};
    const match=/^(haz clic|haz click|da clic|dale clic|pulsa|presiona|señala|mueve tu (?:mouse|puntero))\s+(?:(?:en|a|sobre)\s+)?(?:el bot[oó]n\s+)?(.+)$/i.exec(input);
    if (!match || /^(?:con (?:tu|el) (?:mouse|puntero)|[-+]?\d+\s*,|safari\b)/i.test(match[2])) return null;
    const target=match[2].trim().replace(/^[«“"]|[»”"]$/g,'');
    return target.length && target.length<=120 ? {target,point:/^(señala|mueve)/i.test(match[1])} : null;
  }
  function candidates(target) {
    const wanted=simplify(target);
    return [...document.querySelectorAll(selector)].filter(el=>{
      if(el.closest('#asPanel,[hidden],[inert],[aria-hidden="true"]')||el.matches(':disabled,[aria-disabled="true"]')||!el.getClientRects().length)return false;
      const style=getComputedStyle(el);
      if(style.visibility!=='visible'||style.display==='none')return false;
      return [el.getAttribute('aria-label'),el.title,el.innerText,el.value].some(s=>s&&simplify(s)===wanted);
    });
  }
  function show(x,y) {
    if(!cursor){
      cursor=document.createElement('span');cursor.setAttribute('aria-hidden','true');
      cursor.style.cssText='position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;color:#fff;background:#20488d;border:2px solid white;border-radius:0 12px 12px;padding:3px 8px;font:bold 13px system-ui;box-shadow:0 2px 6px #0006;transition:transform 180ms ease-out';
      cursor.textContent='↖ Lumi';document.body.append(cursor);
    }
    clearTimeout(timer);cursor.hidden=false;cursor.style.transform='translate('+x+'px,'+y+'px)';
    timer=setTimeout(()=>{cursor.hidden=true;},1800);
  }
  async function run(command,closePanel) {
    if(busy)return 'El puntero de Lumi está en movimiento.';
    if(command.test){
      busy=true;
      const target=document.createElement('button');
      target.type='button';target.textContent='Prueba del puntero';target.style.cssText='position:fixed;left:50%;top:45%;transform:translateX(-50%);z-index:2147483646;padding:12px 20px';
      let received=false;target.addEventListener('click',()=>{received=true;},{once:true});document.body.append(target);
      try{
        const r=target.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
        show(x,y);await new Promise(resolve=>setTimeout(resolve,350));
        if(document.elementFromPoint(x,y)===target)target.click();
        return received?'El botón de prueba de Workspace recibió mi clic.':'El botón de prueba estaba cubierto.';
      }finally{target.remove();busy=false;}
    }
    const matches=candidates(command.target);
    if(!matches.length)return 'No encuentro un botón visible llamado «'+command.target+'» en esta pantalla.';
    if(matches.length>1)return 'Hay varios controles llamados «'+command.target+'». Abre la sección que quieres usar.';
    const el=matches[0];busy=true;
    try{
      closePanel();
      el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      const hit=()=>{
        if(!el.isConnected||el.matches(':disabled,[aria-disabled="true"]'))return null;
        const r=el.getBoundingClientRect(),x=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2;
        return el.contains(document.elementFromPoint(x,y))?{x,y}:null;
      };
      const point=hit();if(!point)return 'El control está cubierto o ya cambió la pantalla.';
      show(point.x,point.y);await new Promise(resolve=>setTimeout(resolve,230));
      const final=hit();if(!final||Math.hypot(final.x-point.x,final.y-point.y)>4)return 'El control cambió de posición. Repite la orden en la pantalla actual.';
      if(!command.point)el.click();
      return (command.point?'Señalé «':'Pulsé «')+command.target+'».';
    }finally{busy=false;}
  }
  window.LumiPuntero={parse,run};
})();
