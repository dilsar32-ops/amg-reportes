// La lista y las imágenes provienen del archivo privado importado por el manager.
(() => {
  const normal = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const lessons=[
  {
    "preguntas": [
      "¿Ya recogieron las máquinas?",
      "¿Sí hicieron pick up o sigue secando?",
      "¿Quedó algo en la propiedad?",
      "¿Complete quiere decir que sacaron todo?",
      "¿Ya retiraron los abanicos y el dehu?",
      "¿Cómo verifico el retiro final?"
    ],
    "accion": "Lee todas las páginas del Equipment Count de la visita final. Comprueba Removed y On Site en el mismo proyecto, dirección y episodio. Con equipos pendientes, una visita parcial o evidencia ambigua, deja el retiro sin confirmar. Complete por sí solo no prueba el pickup."
  },
  {
    "preguntas": [
      "¿Cómo sigues con la lista de pickups?",
      "¿Qué haces si ya llegaste al último cliente?",
      "¿Saltarlo significa excluirlo para siempre?",
      "¿Cómo retomas el lote de recogidas?"
    ],
    "accion": "Conserva orden, último perfil, pendientes y exclusiones. Siguiente avanza dentro del lote; al llegar al final informa que terminó la lista. Un salto solo vale para esta revisión."
  },
  {
    "preguntas": [
      "¿Qué papeles pide un trabajo terminado?",
      "¿Qué miramos en el perfil?",
      "¿Con las medidas del plano basta?",
      "¿Dónde reviso las hojas sin tag?",
      "¿Qué debe traer el equipment count?"
    ],
    "accion": "Busca Floor Plan, Moisture Map, Equipment Count y Measurements & Demo Notes. Revisa galería sin filtros, Documents, páginas, fechas y retiro. Las medidas del plano no acreditan demolición."
  },
  {
    "preguntas": [
      "¿Qué hago si dice Content?",
      "¿Qué firma lleva el inventario?",
      "¿Lo marco como faltante si sigue activo?",
      "¿Una inspección lleva hoja de demolición?",
      "¿Qué reviso cuando solo movieron muebles?"
    ],
    "accion": "Active / In Progress se registra como nota mientras sigue en curso. En Contents busca Contents Inventory firmado. En inspecciones verifica si hubo trabajo parcial antes de exigir hojas de obra."
  },
  {
    "preguntas": [
      "¿Cómo comparo si el plano está de cabeza?",
      "¿Qué hago si salen dos laundry?",
      "¿Cómo sé si ese Other es hallway?",
      "¿Cómo marco el error en los dos planos?",
      "¿Dónde se cambia el nombre del cuarto?"
    ],
    "accion": "Confirma dirección y nivel. Alinea planos por puertas, escaleras y recorrido 3D. Muestra ambos lado a lado y marca discrepancias. No elimines una pared ni renombres un cuarto solo por orientación o superficie."
  },
  {
    "preguntas": [
      "¿Quien subió el plano es el encargado?",
      "¿Quién tomó más fotos aquí?",
      "¿Cómo compruebo que se guardó el label?",
      "¿Cómo dejo constancia de la corrección?"
    ],
    "accion": "Cuenta fotos por autor antes de atribuir mayoría. Distingue fotógrafo, autor de la hoja y encargado. Tras una corrección comprueba el guardado al reabrir y conserva evidencia."
  }
];
  const patterns = {
    importar: /^(?:importa|importar|carga|cargar|abre) (?:el |un )?(?:archivo |lote |json |lista )(?:de )?(?:pick ?ups|recogidas|retiros)$/,
    retomar: /^(?:(?:vamos a |vamos con |volvamos a )?(?:retoma|retomar|continua|continuar|seguir|sigue|revisa|revisemos|abre|abrir|muestra|muestrame|empezar|empecemos)(?:mos)?(?: con)? )?(?:la lista de |el lote de |los )?(?:pick ?ups|recogidas|retiros)(?: confirmados)?$/,
    saltar: /^(?:(?:ese|este) )?(?:saltalo|omitelo|dejalo pasar|dejalo pendiente|dejalo para despues|pasa de este)(?: y (?:sigue|continua|pasa al siguiente))?$/,
    avanzar: /^(?:(?:vamos|pasemos|pasa|ve|sigue|continua) (?:con |al |a )?(?:el |la )?)?(?:siguiente|proximo|proxima)(?: cliente| perfil| trabajo| pagina| hoja)?$|^(?:sigue|continua|avanza|uno mas|el que sigue|quien sigue)$/,
    salir: /^(?:sal de la revision|cierra la revision|termina la revision|sal de los pickups)$/,
    imagen: /^(?:muestra(?:me)?|ensena(?:me)?|pon(?:me)?|quiero ver|donde estan) (?:las imagenes|los dos planos|los planos lado a lado|la comparacion|el error|las fotos|donde esta el error)$/,
    pendiente: /^(?:que (?:es lo que )?(?:falta|queda|hace falta)|que quedo pendiente|que necesita|cuales son los pendientes|dime los pendientes)(?: aqui| en este perfil)?$/,
    cliente: /^(?:abre|vuelve a|ve con|vamos con|pasemos con|sigue con|regresa a|revisa) (.+)$/,
    consulta: /^(?:por que (.+?) (?:quedo|esta) fuera|(?:que paso con|y) (.+))$/
  };
  const palette={rojo:'#b82136',azul:'#125cab',amarillo:'#d79700'};
  const evidenceImage=v=>typeof v==='string'&&/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(v);
  function validatePair(pair,p){
    if(!pair)return;
    if(pair.proyecto!==p.id||pair.modelo!==p.modelo||!Array.isArray(pair.marcas))throw Error('La pareja de planos pertenece a otro trabajo.');
    for(const side of ['companycam','matterport']){
      const panel=pair[side];if(!panel)continue;
      if(!evidenceImage(panel.imagen)||!panel.nivel||typeof panel.nivel!=='string')throw Error('Falta imagen o nivel del plano.');
    }
    for(const m of pair.marcas){
      if(!['companycam','matterport'].includes(m.lado)||!pair[m.lado]||!Object.hasOwn(palette,m.color)||!m.texto||!Array.isArray(m.caja)||m.caja.length!==4||!m.caja.every(Number.isFinite))throw Error('Marca visual inválida.');
      const [x,y,w,h]=m.caja;if(x<0||y<0||w<=0||h<=0||x+w>1.001||y+h>1.001)throw Error('Marca fuera de la imagen.');
    }
  }
  function visual(p){
    const v=p.visual;
    if(v?.companycam&&v?.matterport)return {project:p,pair:v,msg:(v.marcas.length?'Comparación anotada de ':'Planos lado a lado de ')+p.nombre+'. '+(v.verificacion||'Revisar correspondencia en 3D.')};
    if(p.comparacion)return {project:p,image:p.comparacion,msg:'Comparación anotada de '+p.nombre+' guardada en la revisión.'};
    const missing=['companycam','matterport'].filter(k=>!v?.[k]).map(k=>k==='companycam'?'CompanyCam':'Matterport').join(' y ');
    return {project:p,pair:v,msg:'Pendiente de comparación: falta la captura de '+missing+'. Verifica el mismo nivel y las puertas en las fuentes del perfil.'};
  }
  function renderPair(block,pair){
    const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
    const area=el('div');area.style.cssText='overflow:auto;max-width:100%;background:#fff;color:#153647;padding:8px';block.append(area);
    const grid=el('div');grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:12px;min-width:560px';area.append(grid);
    for(const [key,title] of [['companycam','CompanyCam'],['matterport','Matterport']]){
      const panel=pair[key],column=el('section');grid.append(column);column.append(el('strong',title+(panel?' · '+panel.nivel:'')));
      if(!panel){column.append(el('p','Captura pendiente'));continue;}
      const frame=el('div');frame.style.cssText='position:relative;line-height:0;margin:8px 0';column.append(frame);
      const img=el('img');img.src=panel.imagen;img.alt=title+' · '+panel.nivel;img.style.width='100%';frame.append(img);
      for(const [i,m] of pair.marcas.entries()){
        if(m.lado!==key)continue;
        const [x,y,w,h]=m.caja.map(n=>n*100);const box=el('span');box.style.cssText='position:absolute;box-sizing:border-box;pointer-events:none;border:3px solid '+palette[m.color]+';left:'+x+'%;top:'+y+'%;width:'+w+'%;height:'+h+'%';frame.append(box);
        const badge=el('b',String(i+1));badge.style.cssText='position:absolute;top:0;left:0;background:'+palette[m.color]+';color:white;font: bold 13px sans-serif;padding:2px';box.append(badge);
      }
      const zoom=el('button','Ampliar / reducir');zoom.type='button';zoom.onclick=()=>{grid.style.minWidth=grid.style.minWidth==='1400px'?'560px':'1400px';};column.append(zoom);
    }
    for(const [i,m] of pair.marcas.entries()){const row=el('p',(i+1)+'. '+m.texto);row.style.cssText='border-left:5px solid '+palette[m.color]+';padding-left:8px';block.append(row);}
  }
  function privateRule(q,d){
    for(const rule of d.manual?.situaciones||[]){
      if(rule.frases.some(f=>normal(f)===q))return rule.accion;
    }
    if(!/^(consulta|busca|explica|lee) (?:en )?(?:la |el )?(?:guia|manual|skill)\b/.test(q))return null;
    const words=q.split(/\b(?:guia|manual|skill)\b/).pop().split(' ').filter(w=>w.length>3&& !['sobre','para','como'].includes(w));
    if(!words.length)return 'Puedes consultar el manual sobre orientación, muros, medidas, autoría, etiquetas, pickup o exclusiones.';
    const candidates=Object.values(d.manual?.referencias||{}).flatMap(t=>t.split('\n')).filter(l=>l.trim().length>30).map(l=>({l,score:words.filter(w=>normal(l).includes(w)).length})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
    return candidates.length?candidates.slice(0,2).map(r=>r.l.replace(/^[-*# ]+/,'')).join('\n'):'El manual cargado no contiene una regla específica para esa consulta.';
  }

  function validate(d){
    if(d?.version!==1 || typeof d.lote!=='string'||!Array.isArray(d.perfiles)||!d.perfiles.length)throw Error('Lote incompatible.');
    const ids=new Set();
    for(const p of d.perfiles){
      if(typeof p.id!=='string'||typeof p.nota!=='string'||!/^\d+$/.test(p.id)||ids.has(p.id)||typeof p.nombre!=='string'||!p.nombre.trim()||p.pickup!=='confirmado'||!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha))throw Error('Perfil duplicado o retiro sin confirmar.');
      ids.add(p.id);validatePair(p.visual,p);
      for(const k of ['plano','humedad','equipos','medidas'])if(!Array.isArray(p.hojas?.[k])||p.hojas[k].some(x=>!/^\d+$/.test(x)))throw Error('Referencia de hoja inválida.');
      if(p.comparacion&&!/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(p.comparacion))throw Error('Imagen de comparación inválida.');
    }
    if(!ids.has(d.ultimo)||!Array.isArray(d.fuera)||d.fuera.some(p=>!p||!/^\d+$/.test(p.id)||ids.has(p.id)||typeof p.nombre!=='string'||typeof p.nota!=='string'))throw Error('Revisa el último perfil y las exclusiones.');
    if(d.manual&&(!Array.isArray(d.manual.situaciones)||!d.manual.situaciones.every(r=>typeof r.accion==='string'&&Array.isArray(r.frases)&&r.frases.every(f=>typeof f==='string'))||!Object.values(d.manual.referencias||{}).every(t=>typeof t==='string')))throw Error('Manual de revisión inválido.');
    return d;
  }
  function route(text,d,s){
    const q=normal(text).replace(/^(?:(?:oye lumi|lumi|por favor|ok|bueno|entonces|ahora|porfa) )+/,'').replace(/ (?:por favor|porfa)$/,'').replace(/^el (siguiente|proximo)( cliente| perfil)?$/,'$1$2').replace(/^la siguiente (pagina|hoja)$/,'siguiente $1');
    if (/^(?:no |nunca )/.test(q)) return null;
    if(patterns.importar.test(q))return {action:'importar'};
    const resume=patterns.retomar.test(q)||['continuamos con los clientes y aplicando el json y el sql','retoma la auditoria de recogidas','volvamos a los perfiles con retiro','continua con la lista acordada de pickups'].includes(q);
    const lesson=lessons.find(item=>item.preguntas.some(question=>normal(question)===q));
    if(lesson)return {action:'leccion',msg:lesson.accion};
    if(!resume&&!s?.active)return null;
    if(!d)return resume?{action:'sinLote',msg:'Dime «importa el lote de pickups» para cargar la lista acordada.'}:null;
    const entries=d.perfiles;let index=entries.findIndex(p=>p.id===(s?.id||d.ultimo));if(index<0)index=0;
    const p=entries[index], result=(msg,extra={})=>({action:'respuesta',msg,state:{...s,id:p.id,active:true},...extra});
    const select=(item,extra={})=>result(item.nombre+'. '+item.nota,{...visual(item),msg:item.nombre+'. '+item.nota+' '+visual(item).msg,state:{...s,active:true,id:item.id,view:'perfil',...extra}});
    if(resume)return select(p);
    const rule=privateRule(q,d);if(rule)return result(rule);
    if(/^(?:autoevalua|autoevaluate|juzga|verifica|comprueba|revisa) (?:tu trabajo|la comparacion|si ya quedo|la evidencia)$/.test(q)){
      const a=visual(p);const pendientes=p.visual?.marcas?.filter(m=>m.color==='amarillo').map(m=>m.texto)||[];return result('',{...a,msg:[a.msg,p.nota,...pendientes].join(' ')});
    }
    if(/^(?:pon|ponme|muestra|muestrame|ensena|ensename|compara|marca|senala|quiero ver)\b/.test(q)&&/lado a lado|a la par|una (?:foto )?(?:al lado|junto) de la otra|rojo.*azul|diferencias|discrepancias|cuadros de colores/.test(q)&&!/(?:envia|manda|borra|elimina|publica)/.test(q))return result('',visual(p));
    if(patterns.salir.test(q))return result('Revisión cerrada. Conservé tu posición.',{state:{...s,active:false}});
    if(/^(?:ya |todavia )?(?:se (?:hizo|confirmo) el pickup|retiraron (?:todo|los equipos)|recogieron (?:las maquinas|todo))$/.test(q))return result(p.nombre+': retiro final confirmado en el registro del '+p.fecha+'.');
    if(patterns.pendiente.test(q)||['que nos quedo por verificar','que nos falta aqui','que le hace falta','dime como quedo este trabajo'].includes(q))return result(p.nombre+'. '+p.nota);
    if(patterns.imagen.test(q)||/^(?:ponme|pon|ensename|muestrame|quiero ver) (?:ambos|los dos) (?:mapas|planos)(?: juntos| a la par| lado a lado| uno junto al otro| con los errores)?$/.test(q))return result('',visual(p));
    const doc=/^(?:abre|muestrame|ensename|ver|quiero ver) (?:el |la |las |los )?(equipment count|conteo de equipos|hoja de equipos|medidas|measurements|moisture map|mapa de humedad|plano|floor plan)$/.exec(q);
    let kind=doc&&({medidas:'medidas',measurements:'medidas',plano:'plano','floor plan':'plano','moisture map':'humedad','mapa de humedad':'humedad'}[doc[1]]||'equipos');
    const skip=patterns.saltar.test(q), next=patterns.avanzar.test(q)||['dale con el que sigue','vamos al que sigue','continua con el proximo','pasemos al otro cliente','avanza un cliente','otra pagina','la siguiente hoja'].includes(q);
    if(kind||(next&&(s.view==='hoja'&&!/cliente|perfil|trabajo/.test(q)||/pagina|hoja/.test(q)))){
      kind=kind||(s.view==='hoja'?s.kind:null);if(!kind)return result('¿De qué documento quieres ver la siguiente hoja?');
      const page=doc?0:(s.page||0)+1, id=p.hojas[kind][page];
      if(!id)return result(doc?'El registro no tiene enlace a esa hoja.':'Llegaste a la última hoja registrada de '+kind+'.');
      return result(p.nombre+' · '+kind+' · hoja '+(page+1)+' de '+p.hojas[kind].length,{state:{...s,id:p.id,active:true,view:'hoja',kind,page},url:'https://app.companycam.com/projects/'+p.id+'/photos/'+id+'/photo'});
    }
    if(skip||next){
      const skipped=skip?[...new Set([...(s.skipped||[]),p.id])]:s.skipped||[];
      if(index+1===entries.length)return result('Fin del lote. '+p.nombre+' es el último cliente; sus pendientes quedan registrados.',{state:{...s,skipped}});
      return select(entries[index+1],{skipped});
    }
    const name=patterns.cliente.exec(q)?.[1]||patterns.consulta.exec(q)?.slice(1).find(Boolean);
    if(name){
      const matches=[...entries,...d.fuera].filter(a=>normal(a.nombre)===name||normal(a.nombre).startsWith(name+' '));
      if(matches.length>1)return result('Hay más de una coincidencia. Dime el nombre completo.');
      if(matches.length===1)return entries.includes(matches[0])?select(matches[0]):result(matches[0].nombre+'. '+matches[0].nota);
    }
    return null;
  }
  window.LumiPickups={route,validate,renderPair};
})();
