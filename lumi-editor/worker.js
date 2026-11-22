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
  const select = controls.find(el => visible(el) && name(el) === 'Select');
  if (request.action === 'activarMuro' || request.action === 'activarSeleccion') {
    const tool = request.action === 'activarMuro' ? wall : select;
    if (!tool || tool.disabled || tool.getAttribute('aria-disabled') === 'true') return fail('La herramienta está deshabilitada.');
    tool.click();
    return {ok:true,message:'Lumi pulsó '+name(tool)+'. Comprueba la herramienta y el plano antes de seguir.'};
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
  const drawing = request.action === 'trazarVertice';
  const tool = drawing ? wall : select;
  const active = tool && (tool.matches('[aria-pressed=true],[aria-selected=true],[data-state=on],[data-state=active]') ||
    Array.from(tool.classList).some(cl => /^(?:active|selected|is-active|is-selected)$/.test(cl)));
  if (!active) return fail('No pude confirmar la herramienta activa en el editor.');
  const {x,y,operationId} = request;
  const onSurface = (px,py) => px > box.left && py > box.top && px < box.right && py < box.bottom &&
    px < innerWidth && py < innerHeight && document.elementFromPoint(px,py) === canvas;
  if (!onSurface(x,y)) return fail('El punto está fuera del lienzo visible o hay un control sobre él.');
  const key = 'lumi.trazo.'+model+'.'+operationId;
  if (sessionStorage.getItem(key)) return fail('La operación ya se intentó. Revisa el plano antes de continuar.');
  const dispatch = (type,px,py,buttons) => {
    const pointer = type.startsWith('pointer');
    const Ctor = pointer ? PointerEvent : MouseEvent;
    canvas.dispatchEvent(new Ctor(type,{clientX:px,clientY:py,bubbles:true,cancelable:true,view:window,
      button:0,buttons,...(pointer?{pointerId:1,pointerType:'mouse',isPrimary:true}:{})}));
  };
  const pair = (suffix,px,py,buttons) => {
    dispatch('pointer'+suffix,px,py,buttons);
    dispatch('mouse'+suffix,px,py,buttons);
  };
  const tap = () => { pair('move',x,y,0); pair('down',x,y,1); pair('up',x,y,0); dispatch('click',x,y,0); };
  if (drawing) {
    sessionStorage.setItem(key,'intentado');
    tap();
    return {ok:true,estado:'gesto_enviado',operationId,message:'Gesto enviado. Comprueba el vértice. Si el visor ignora eventos sintéticos, no lo repitas sin verificar.'};
  }
  // Only accept an actual wall-properties panel, never the Wall toolbar button.
  const panel = () => {
    const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,[role=heading],label,legend'))
      .filter(el => visible(el) && !el.closest('button,[role="button"]') &&
        /^(wall|wall properties|wall type)$/i.test(el.textContent.trim()));
    return candidates.length ? candidates[0] : null;
  };
  // Per-document isolated-world state dies with the editor. Trusted user gestures
  // cancel a pending selection even if the new wall happens to have the same dimensions.
  const memoryKey = Symbol.for('lumi.layout.wall-selection');
  if (!globalThis[memoryKey]) {
    const memory = {wall:null,revision:0};
    const invalidate = () => { memory.wall=null; memory.revision++; };
    for (const evt of ['pointerdown','keydown','wheel']) document.addEventListener(evt,e=>{if(e.isTrusted) invalidate();},true);
    window.addEventListener('resize',invalidate);
    globalThis[memoryKey]=memory;
  }
  const memory = globalThis[memoryKey];
  if (request.action === 'seleccionarMuro') {
    memory.wall = null;
    if (panel()) return fail('Ya existe una selección de muro. Deselecciónala antes de identificar otro muro.');
    const revision = memory.revision;
    sessionStorage.setItem(key,'intentado');
    tap();
    for (let i=0; i<10 && !panel(); i++) await new Promise(resolve=>setTimeout(resolve,60));
    const selected = panel();
    if (!selected || memory.revision!==revision) return fail('El gesto no produjo un panel Wall verificable; Matterport puede ignorar los eventos sintéticos.');
    memory.wall = {id:operationId,x,y,model,project:request.project,evidencia:request.evidencia,panel:selected};
    return {ok:true,estado:'muro_seleccionado',seleccionId:operationId,message:'El editor mostró el panel de muro después de la selección. Coteja el segmento resaltado.'};
  }
  const current = memory.wall;
  if (!current || current.id !== request.seleccionId || current.x !== x || current.y !== y ||
      current.model !== model || current.project !== request.project || current.evidencia !== request.evidencia ||
      current.panel !== panel()) return fail('La selección de muro ya no es verificable. Revisa el tramo resaltado.');
  if (request.action === 'eliminarMuro') {
    const buttons = controls.filter(el=>visible(el)&&name(el)==='Delete'&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    if (buttons.length!==1 || request.confirmacion!=='eliminar muro seleccionado') return fail('El editor no confirma un único control Delete habilitado para el muro.');
    memory.wall=null;
    sessionStorage.setItem(key,'intentado');
    buttons[0].click();
    return {ok:true,estado:'gesto_enviado',operationId,message:'Lumi pulsó Delete para el muro seleccionado. Verifica su retirada, las paredes contiguas y el guardado.'};
  }
  const {hastaX,hastaY}=request;
  const steps=12;
  const path=Array.from({length:steps},(_,i)=>[x+(hastaX-x)*(i+1)/steps,y+(hastaY-y)*(i+1)/steps]);
  if (!path.every(([px,py])=>onSurface(px,py))) return fail('El recorrido sale del lienzo o atraviesa un control.');
  memory.wall=null;
  sessionStorage.setItem(key,'intentado');
  pair('move',x,y,0); pair('down',x,y,1);
  let last=[x,y];
  try {
    for(const [px,py] of path) {
      pair('move',px,py,1);
      last=[px,py];
    }
  } finally { pair('up',last[0],last[1],0); }
  return {ok:true,estado:'gesto_enviado',operationId,message:'Arrastre enviado. Verifica el tramo, sus vecinos y el guardado; Matterport puede ignorar eventos sintéticos.'};
}
async function routeDrawing(request) {
  const needsPoint = ['trazarVertice','seleccionarMuro','moverMuro','eliminarMuro'].includes(request.action);
  if (needsPoint) {
    let source;
    try { source = new URL(request.evidencia); } catch { throw Error('Se necesita el enlace de evidencia en CompanyCam.'); }
    const parts = source.pathname.split('/');
    if (source.origin !== 'https://app.companycam.com' || parts[1] !== 'projects' || parts[2] !== request.project ||
        parts[3] !== 'photos' || !/^\d+$/.test(parts[4] || '')) throw Error('La evidencia debe ser una foto del proyecto activo.');
  }
  if (needsPoint && (!Number.isFinite(request.x) || !Number.isFinite(request.y) ||
      !/^[a-f0-9]{64}$/.test(request.ref||'') || !/^[a-zA-Z0-9_-]{1,80}$/.test(request.operationId||'') ||
      typeof request.evidencia !== 'string' || !request.evidencia.trim())) throw Error('Faltan referencia visual, punto confirmado, evidencia o identificador del vértice.');
  if (['moverMuro','eliminarMuro'].includes(request.action) && !/^[a-zA-Z0-9_-]{1,80}$/.test(request.seleccionId||'')) throw Error('Falta la selección verificada del muro.');
  if (request.action==='eliminarMuro' && request.confirmacion!=='eliminar muro seleccionado') throw Error('Falta la confirmación explícita para retirar este muro.');
  if (request.action==='moverMuro' && (!Number.isFinite(request.hastaX) || !Number.isFinite(request.hastaY) ||
      (request.x===request.hastaX && request.y===request.hastaY))) throw Error('Falta un destino distinto y verificado en el lienzo.');
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
function diagnoseFrame(model) {
  const url = new URL(location.href);
  if (url.origin !== 'https://my.matterport.com' ||
      !(url.searchParams.get('m') === model || url.pathname.split('/').includes(model))) return null;
  const esEditor = url.pathname === '/work';
  const cloudEdit = url.searchParams.get('cloudEdit') === '1';
  const names = Array.from(document.querySelectorAll('button,[role="button"]'))
    .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    .map(el => (el.getAttribute('aria-label') || el.title || el.textContent || '').trim());
  const layout = names.includes('Wall') && names.includes('Invisible Wall');
  return {path:url.pathname,esEditor,cloudEdit,layout,readyState:document.readyState};
}
async function diagnoseConnection(request) {
  const version = chrome.runtime.getManifest().version;
  const base = {worker:true,version,vistas:[]};
  if (!request.project && !request.model) return {...base,ok:true,editorPresente:null,message:'El controlador de Chrome responde (v'+version+'). Selecciona el proyecto para inspeccionar su editor.'};
  if (!/^\d+$/.test(request.project) || !/^[a-zA-Z0-9]{11}$/.test(request.model)) {
    return {...base,ok:false,editorPresente:null,message:'El controlador responde. El proyecto o el modelo están incompletos.'};
  }
  const tabs = (await chrome.tabs.query({url:'https://my.matterport.com/*'})).filter(tab => matchesModel(tab.url,request.model));
  let incomplete = false;
  for(const tab of tabs) {
    try {
      const frames = await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:diagnoseFrame,args:[request.model]});
      const marcos = frames.map(frame => frame.result).filter(Boolean);
      if (!marcos.length) incomplete = true;
      base.vistas.push({tabId:tab.id,marcos});
    } catch {
      incomplete = true;
      base.vistas.push({tabId:tab.id,marcos:[],error:'No se pudo consultar esta vista.'});
    }
  }
  const marcos = base.vistas.flatMap(vista => vista.marcos);
  const editorPresente = marcos.some(frame => frame.esEditor) ? true : incomplete ? null : false;
  const state = editorPresente ? 'Detecté /work. '+(marcos.some(f=>f.esEditor && f.layout)?'Property Layout está abierto.':'Property Layout no está visible.') :
    incomplete ? 'No se pudo verificar el editor en todas las vistas.' : 'No se detectó /work del modelo en Chrome.';
  return {...base,ok:!incomplete,editorPresente,message:'Controlador v'+version+' conectado. Vistas del modelo: '+tabs.length+'. '+state};
}
chrome.runtime.onMessage.addListener((request,sender,respond) => {
  if (!sender.url?.startsWith('https://dilsar32-ops.github.io/amg-reportes/')) return;
  (async()=>{
    const {project,model,action} = request;
    if (action === 'diagnosticarConexion') return diagnoseConnection(request);
    if (!/^\d+$/.test(project) || !/^[a-zA-Z0-9]{11}$/.test(model)) throw Error('Identificadores de proyecto incompletos.');
    if (['inspeccionarTrazado','activarMuro','activarSeleccion','trazarVertice','seleccionarMuro','moverMuro','eliminarMuro'].includes(action)) return routeDrawing(request);
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
  })().then(respond,error=>respond({worker:true,ok:false,message:error.message}));return true;
});
