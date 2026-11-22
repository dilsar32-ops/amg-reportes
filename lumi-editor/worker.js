function matchesModel(raw, model) {
  const url = new URL(raw);
  return url.origin === 'https://my.matterport.com' &&
    (url.searchParams.get('m') === model || url.pathname.split('/').includes(model));
}
function roomLabel(change,model) {
  const url=new URL(location.href);
  if(url.origin!=='https://my.matterport.com'||!(url.searchParams.get('m')===model||url.pathname.split('/').includes(model))) return {message:'La pestaña cambió de modelo.'};
  const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const fields = [...document.querySelectorAll('input,textarea')].filter(field =>
    visible(field) && !field.disabled && !field.readOnly &&
    [field.getAttribute('aria-label'), ...Array.from(field.labels || [], label => label.textContent.trim())].includes('Label'));
  if (fields.length !== 1) return {message:'Pendiente. Abre Edit Layout y selecciona el cuarto verificado para que aparezca un único campo Label.'};
  const field = fields[0];
  if (!change) return {fieldFound:true,message:'Label visible: '+(field.value || '(vacío)')+'.'};
  if (field.value !== change.before) return {message:'El Label actual cambió. Revisa el cuarto antes de reintentar.'};
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field),'value')?.set;
  if (!setter) return {message:'El editor cambió de formato. La edición queda pendiente.'};
  field.focus();
  setter.call(field,change.after);
  field.dispatchEvent(new Event('input',{bubbles:true}));
  field.dispatchEvent(new Event('change',{bubbles:true}));
  field.blur();
  return {message:'Se escribió el Label del cuarto seleccionado. Pendiente comprobar el guardado al reabrir el cuarto.'};
}
// Injected in the editor frame's isolated world. Coordinates are frame-local CSS pixels.
async function layoutFrame(model, request) {
  const url = new URL(location.href);
  if (url.origin !== 'https://my.matterport.com' || url.pathname !== '/work' ||
      url.searchParams.get('m') !== model || url.searchParams.get('cloudEdit') !== '1') return null;

  const fail = message => ({ok: false, message});
  const controls = Array.from(document.querySelectorAll('button,[role="button"]'));
  const name = el => (el.getAttribute('aria-label') || el.title || el.textContent || '').trim();
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const walls = controls.filter(el => visible(el) && name(el) === 'Wall');
  if (walls.length !== 1 || !controls.some(el => visible(el) && name(el) === 'Invisible Wall')) {
    return fail('Abre Property Layout. Faltan los controles visibles Wall e Invisible Wall.');
  }
  if (request.action === 'sondearEditor') return {ok:true};
  const wall = walls[0];
  if (request.action === 'activarMuro') {
    if (wall.disabled || wall.getAttribute('aria-disabled') === 'true') return fail('Wall está deshabilitado.');
    wall.click();
    return {ok:true,message:'Lumi pulsó Wall. Comprueba la herramienta y el plano antes de dibujar.'};
  }

  // Read pixels to bind the confirmed point to this exact view, including camera and zoom.
  // A protected, cleared or ambiguous drawing surface must not receive a speculative click.
  const canvases = Array.from(document.querySelectorAll('canvas')).filter(el => {
    const box = el.getBoundingClientRect();
    return visible(el) && box.width > 150 && box.height > 150;
  });
  if (canvases.length !== 1) return fail('No se identificó un único lienzo visible de Property Layout.');
  const canvas = canvases[0];
  const box = canvas.getBoundingClientRect();
  const bounds = {x:box.x,y:box.y,width:box.width,height:box.height};
  const viewport = {width:innerWidth,height:innerHeight};
  const scratch = document.createElement('canvas');
  scratch.width = 128;
  scratch.height = 96;
  const ctx = scratch.getContext('2d',{willReadFrequently:true});
  let pixels;
  try {
    ctx.drawImage(canvas, 0, 0, scratch.width, scratch.height);
    pixels = ctx.getImageData(0,0,scratch.width,scratch.height).data;
  } catch {
    return fail('El visor impide leer los píxeles para verificar las coordenadas del lienzo.');
  }
  let varied = 0;
  for(let i = 4; i < pixels.length; i += 4) {
    if (pixels[i+3] && Math.abs(pixels[i]-pixels[0])+Math.abs(pixels[i+1]-pixels[1])+Math.abs(pixels[i+2]-pixels[2]) > 36) varied++;
  }
  if (varied < 30) return fail('El lienzo no produjo una imagen verificable. No se aplicó un vértice.');
  const meta = new TextEncoder().encode(JSON.stringify([url.href,bounds,viewport,devicePixelRatio,
    wall.getAttribute('aria-pressed'),wall.getAttribute('class'),wall.getAttribute('data-state')]));
  const data = new Uint8Array(meta.length+pixels.length);
  data.set(meta); data.set(pixels,meta.length);
  const digest = await crypto.subtle.digest('SHA-256',data);
  const ref = Array.from(new Uint8Array(digest),v => v.toString(16).padStart(2,'0')).join('');
  if (request.action === 'inspeccionarTrazado') {
    return {ok:true,ref,bounds,viewport,message:'Vista de trazado identificada en el marco del editor.'};
  }
  if (request.ref !== ref) return fail('Cambió la vista del editor. Vuelve a cotejar antes del siguiente punto.');
  if (!(wall.matches('[aria-pressed=true],[aria-selected=true],[data-state=on],[data-state=active]') ||
        Array.from(wall.classList).some(cl => /^(?:active|selected|is-active|is-selected)$/.test(cl)))) {
    return fail('No pude confirmar que Wall esté seleccionada en el editor.');
  }
  const {x,y,operationId} = request;
  if (x <= box.left || y <= box.top || x >= box.right || y >= box.bottom ||
      x >= innerWidth || y >= innerHeight || document.elementFromPoint(x,y) !== canvas) {
    return fail('El vértice está fuera del lienzo visible o hay un control sobre él.');
  }
  const key = 'lumi.trazo.'+model+'.'+operationId;
  if (sessionStorage.getItem(key)) return fail('Este vértice ya se intentó. Revisa el resultado antes de continuar.');
  sessionStorage.setItem(key,'intentado');
  const init = {clientX:x,clientY:y,bubbles:true,cancelable:true,view:window,button:0};
  for (const [type,buttons] of [['pointermove',0],['mousemove',0],['pointerdown',1],['mousedown',1],['pointerup',0],['mouseup',0],['click',0]]) {
    const pointer = type.startsWith('pointer');
    const Ctor = pointer ? PointerEvent : MouseEvent;
    canvas.dispatchEvent(new Ctor(type,{...init,buttons,...(pointer?{pointerId:1,pointerType:'mouse',isPrimary:true}:{})}));
  }
  return {ok:true,estado:'gesto_enviado',operationId,message:'Gesto enviado. Verifica el vértice en el plano antes del siguiente; falta comprobar el guardado.'};
}
async function routeDrawing(request) {
  if (request.action === 'trazarVertice') {
    let source;
    try { source = new URL(request.evidencia); } catch { throw Error('Se necesita el enlace de evidencia en CompanyCam.'); }
    const parts = source.pathname.split('/');
    if (source.origin !== 'https://app.companycam.com' || parts[1] !== 'projects' || parts[2] !== request.project ||
        parts[3] !== 'photos' || !/^\d+$/.test(parts[4] || '')) throw Error('La evidencia debe ser una foto del proyecto activo.');
  }
  if (request.action === 'trazarVertice' && (!Number.isFinite(request.x) || !Number.isFinite(request.y) ||
      !/^[a-f0-9]{64}$/.test(request.ref||'') || !/^[a-zA-Z0-9_-]{1,80}$/.test(request.operationId||'') ||
      typeof request.evidencia !== 'string' || !request.evidencia.trim())) throw Error('Faltan referencia visual, punto confirmado, evidencia o identificador del vértice.');
  const tabs = (await chrome.tabs.query({url:'https://my.matterport.com/*'})).filter(tab => matchesModel(tab.url,request.model));
  const found = [];
  const blockers = [];
  for (const tab of tabs) {
    const frames = await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:layoutFrame,args:[request.model,{action:'sondearEditor'}]});
    for (const frame of frames) {
      if (frame.result?.ok) found.push({tabId:tab.id,documentIds:[frame.documentId]});
      else if (frame.result?.message) blockers.push(frame.result.message);
    }
  }
  if (found.length !== 1) throw Error(found.length ? 'Hay más de un editor del modelo abierto.' : blockers[0] || 'Abre Property Layout del modelo activo en Chrome.');
  const [frame] = await chrome.scripting.executeScript({target:found[0],func:layoutFrame,args:[request.model,request]});
  if (!frame?.result) throw Error('El editor cambió durante la operación.');
  return frame.result;
}
chrome.runtime.onMessage.addListener((request,sender,respond) => {
  if (!sender.url?.startsWith('https://dilsar32-ops.github.io/amg-reportes/')) return;
  (async()=>{
    const {project,model,action} = request;
    if (!/^\d+$/.test(project) || !/^[a-zA-Z0-9]{11}$/.test(model)) throw Error('Identificadores de proyecto incompletos.');
    if (['inspeccionarTrazado','activarMuro','trazarVertice'].includes(action)) return routeDrawing(request);
    if (action==='fuentes') {
      const tabs=await chrome.tabs.query({});
      for(const [match,url] of [
        [s=>s.startsWith('https://app.companycam.com/projects/'+project+'/') || s==='https://app.companycam.com/projects/'+project,'https://app.companycam.com/projects/'+project],
        [s=>matchesModel(s,model),'https://my.matterport.com/show/?m='+model]
      ]){
        if(!tabs.some(tab=>tab.url && match(tab.url))) await chrome.tabs.create({url,active:false});
      }
      return {message:'Fuentes del proyecto abiertas en Chrome.'};
    }
    if (!['leer','renombrar'].includes(action)) throw Error('Comando desconocido.');
    const tabs=(await chrome.tabs.query({url:'https://my.matterport.com/*'})).filter(tab=>matchesModel(tab.url,model));

    if(action==='renombrar' && (typeof request.before!=='string'||!request.before.trim()||typeof request.after!=='string'||!request.after.trim()||request.after.length>80||request.after===request.before)) throw Error('Indica el nombre anterior y el nuevo.');
    const matches=[];
    for(const tab of tabs){
      const frames=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:roomLabel,args:[null,model]});
      for(const frame of frames) if(frame.result?.fieldFound) matches.push({tab,frame});
    }
    if(matches.length!==1) throw Error(matches.length ? 'Hay varios campos Label del modelo; selecciona un único cuarto.' : 'Abre Edit Layout del modelo y selecciona el cuarto para mostrar su Label.');
    const {tab,frame}=matches[0];
    if(action==='leer') return frame.result;
    const before=request.before==='(vacío)'?'':request.before;
    const [edited]=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[frame.documentId]},func:roomLabel,args:[{before,after:request.after},model]});
    return edited.result;
  })().then(respond,error=>respond({message:error.message}));return true;
});
