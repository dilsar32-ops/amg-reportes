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
  function renderPair(block,pair,overlay=false){
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
    if(overlay && pair.companycam && pair.matterport){
      const view=el('div');view.style.cssText='position:relative;height:440px;overflow:hidden;background:white';area.append(el('strong','Superposición · referencias pendientes de verificar'),view);
      const layers=[];
      for(const key of ['matterport','companycam']){
        const img=el('img');img.alt=key;img.src=pair[key].imagen;img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain';view.append(img);layers.push(img);
        const label=el('label','Usar captura actual de '+key+' '),input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';label.append(input);area.append(label);
        input.onchange=()=>{const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{img.src=reader.result;};reader.readAsDataURL(file);};
      }
      const controls={};
      const update=()=>{const v=k=>Number(controls[k].value);layers[1].style.opacity=v('Opacidad')/100;layers[1].style.transform='translate('+v('Horizontal')+'%, '+v('Vertical')+'%) rotate('+v('Giro')+'deg) scale('+v('Escala')/100+') scaleX('+(flip.checked?-1:1)+')';};
      const flip=el('input');flip.type='checkbox';const reflection=el('label','Reflejar copia ');reflection.append(flip);area.append(reflection);flip.onchange=update;
      for(const [name,min,max,value] of [['Opacidad',0,100,45],['Horizontal',-100,100,0],['Vertical',-100,100,0],['Giro',-180,270,0],['Escala',10,300,100]]){
        const label=el('label',name+' '),input=el('input');label.style.display='block';input.type='range';input.min=min;input.max=max;input.value=value;controls[name]=input;input.oninput=update;label.append(input);area.append(label);
      }
      update();
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
      if(p.murosParaRetirar!==undefined&&(!Array.isArray(p.murosParaRetirar)||!p.murosParaRetirar.every(m=>m&&typeof m.id==='string'&&/^[a-z0-9_-]{1,48}$/i.test(m.id)&&p.hojas.plano.includes(m.hoja))))throw Error('Muro para retirar sin identificador u hoja del perfil.');
      if(p.comparacion&&!/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(p.comparacion))throw Error('Imagen de comparación inválida.');
    }
    if(!ids.has(d.ultimo)||!Array.isArray(d.fuera)||d.fuera.some(p=>!p||!/^\d+$/.test(p.id)||ids.has(p.id)||typeof p.nombre!=='string'||typeof p.nota!=='string'))throw Error('Revisa el último perfil y las exclusiones.');
    if(d.manual&&(!Array.isArray(d.manual.situaciones)||!d.manual.situaciones.every(r=>typeof r.accion==='string'&&Array.isArray(r.frases)&&r.frases.every(f=>typeof f==='string'))||!Object.values(d.manual.referencias||{}).every(t=>typeof t==='string')))throw Error('Manual de revisión inválido.');
    return d;
  }
  // El expediente privado identifica el modelo. Nunca conservar una coordenada de otro cuarto o sesión.
  function laundryRoute(text,q,d,s){
    const inspect=q==='inspecciona el trazado de la lavanderia';
    const wall=q==='activa la herramienta de muro para la lavanderia';
    const point=/^traza v[eé]rtice ([a-z0-9_-]{1,48}) en (\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?) con hoja (\d+)$/i.exec(text.trim());
    const drawing=/\b(?:dibuja(?:r|le)?|recrea(?:r|le)?|reconstru(?:ye|ir)|traza(?:r)?|constru(?:ye|ir))\b/.test(q);
    const tour=/\b(?:entra|abre|recorre|verifica)\b/.test(q)&&/\b(?:3d|recorrido|tour)\b/.test(q);
    if(!point&&!inspect&&!wall&&(!/\b(?:lavanderia|laundry)\b/.test(q)||!(drawing||tour)))return null;
    if(/\b(?:no|nunca) (?:lo |la |le )?(?:dibuj|trac|traz|constru|recre|entr|abr)/.test(q))return {action:'respuesta',msg:'La orden excluye ese paso. Conservé el plano.'};
    const profiles=d?.perfiles||[];
    const named=profiles.filter(p=>{const name=normal(p.nombre);return [name,name.split(' ')[0]].some(n=>n.length>=3&&(' '+q+' ').includes(' '+n+' '));});
    const current=profiles.find(p=>p.id===s?.id&&s?.active);
    const p=named.length===1?named[0]:named.length?null:current;
    if(!p||!p.modelo)return {action:'respuesta',msg:'Necesito el perfil y modelo del lote privado. Abre el perfil correspondiente en la revisión y vuelve a la lavandería.'};
    const result=(msg,extra={})=>({action:'respuesta',msg,state:{active:true,id:p.id,view:'trazadoLaundry',laundryOnly:true},...extra});
    const editor={project:p.id,model:p.modelo};
    if(wall){
      if(s?.id!==p.id||s?.view!=='trazadoLaundry'||!s.trazado?.ref)return result('Inspecciona el trazado de la lavandería antes de activar la herramienta de muro.');
      return result('Seleccionando la herramienta de muro.',{editor:{...editor,action:'activarMuro',ref:s.trazado.ref}});
    }
    if(point){
      const ref=s?.id===p.id&&s?.view==='trazadoLaundry'&&s.trazado?.ref;
      if(!ref)return result('Inspecciona el trazado de la lavandería para obtener la vista actual antes de enviar el vértice.');
      if(!p.hojas.plano.includes(point[4]))return result('La hoja indicada debe ser un plano de este perfil. Revisa la fuente y vuelve a inspeccionar el trazado.');
      return result('Aplicando un vértice cotejado.',{editor:{...editor,action:'trazarVertice',operationId:point[1],x:Number(point[2]),y:Number(point[3]),ref,evidencia:'https://app.companycam.com/projects/'+p.id+'/photos/'+point[4]+'/photo'}});
    }
    return result('Inspeccionando el editor.',{editor:{...editor,action:'inspeccionarTrazado'},drawingScope:'Reconstruir únicamente la lavandería omitida. Ubicar sus accesos en la hoja de campo del perfil y cotejarlos con las fotos. Confirmar la puerta del baño, el giro del pasillo y el descanso en el recorrido. Reutilizar muros compartidos. Tras cerrar el recinto, guardar Laundry Room y verificarlo al reabrir.'});
  }
  function wallRoute(text,q,d,s){
    const inspect=q==='inspecciona el muro en el editor';
    const activate=q==='activa seleccion de muros';
    const select=/^selecciona muro ([a-z0-9_-]{1,48}) en (\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?) con hoja (\d+)$/i.exec(text.trim());
    const move=/^mueve el muro seleccionado ([a-z0-9_-]{1,48}) hasta (\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?) con operaci[oó]n ([a-z0-9_-]{1,48})$/i.exec(text.trim());
    const remove=/^elimina el muro seleccionado ([a-z0-9_-]{1,48}) con operaci[oó]n ([a-z0-9_-]{1,48}) y hoja (\d+)$/i.exec(text.trim());
    if(!inspect&&!activate&&!select&&!move&&!remove)return null;
    const answer=msg=>({action:'respuesta',msg});
    const p=s?.active&&d?.perfiles?.find(p=>p.id===s.id);
    if(!p?.modelo)return answer('Selecciona el perfil y su modelo en la revisión para inspeccionar un muro.');
    if(s.view==='trazadoLaundry'||s.laundryOnly)return answer('El alcance actual es reconstruir la lavandería con sus muros nuevos. Los demás muros están fuera de ese ajuste.');
    const wall=s.view==='ajusteMuro'?s.muro:null;
    const result=(msg,action,params={},selected=null)=>({
      action:'respuesta',msg,state:{active:true,id:p.id,view:'ajusteMuro',muro:selected?{selected}:{}},
      editor:{project:p.id,model:p.modelo,action,...params}
    });
    if(inspect)return result('Inspeccionando el muro.', 'inspeccionarTrazado',{},wall?.selected);
    if(!wall?.ref)return answer('Inspecciona el muro en el editor para cotejar la vista actual.');
    if(activate)return result('Activando la herramienta de selección.','activarSeleccion',{ref:wall.ref});
    if(select){
      if(!p.hojas.plano.includes(select[4]))return answer('Selecciona una hoja de plano del perfil actual.');
      return result('Seleccionando el muro indicado.','seleccionarMuro',{ref:wall.ref,operationId:select[1],x:Number(select[2]),y:Number(select[3]),evidencia:'https://app.companycam.com/projects/'+p.id+'/photos/'+select[4]+'/photo'});
    }
    const selected=wall.selected;
    if(!selected||selected.id!==(move||remove)[1])return answer('La selección del editor debe coincidir con el muro identificado. Selecciónalo y vuelve a inspeccionarlo.');
    const common={ref:wall.ref,seleccionId:selected.id,x:selected.x,y:selected.y,evidencia:selected.evidencia};
    if(move)return result('Moviendo el muro seleccionado.','moverMuro',{...common,operationId:move[4],hastaX:Number(move[2]),hastaY:Number(move[3])});
    // Autorizar únicamente el tramo respaldado por el expediente privado importado.
    if(!p.murosParaRetirar?.some?.(m=>m.id===selected.id&&m.hoja===remove[3])||!p.hojas.plano.includes(remove[3])||
       selected.evidencia!=='https://app.companycam.com/projects/'+p.id+'/photos/'+remove[3]+'/photo')return answer('El expediente debe identificar este muro y esta hoja entre los tramos autorizados para retirar.');
    return result('Retirando el muro individual autorizado.','eliminarMuro',{...common,operationId:remove[2],confirmacion:'eliminar muro seleccionado'});
  }
  function route(text,d,s){
    const q=normal(text).replace(/^(?:(?:oye lumi|lumi|por favor|ok|bueno|entonces|ahora|porfa) )+/,'').replace(/ (?:por favor|porfa)$/,'').replace(/^el (siguiente|proximo)( cliente| perfil)?$/,'$1$2').replace(/^la siguiente (pagina|hoja)$/,'siguiente $1');
    if (/^(?:no |nunca )/.test(q)) return null;
    const safari=/^(?:abre|abrir) (companycam|matterport|el recorrido 3d|el editor de matterport|las fuentes)(?: de (.+?))? en safari$/.exec(q);
    const website=/^abre (https:\/\/[^\s]+) en safari$/i.exec(text.trim());
    const scrollSafari=/^(?:desplaza|mueve) (?:la pagina|la vista) (?:hacia )?(arriba|abajo) en safari$/.exec(q);
    if(safari||website||scrollSafari){
      const profiles=d?.perfiles||[];
      const name=safari?.[2];
      const matches=name?profiles.filter(p=>normal(p.nombre)===name||normal(p.nombre).startsWith(name+' ')):profiles.filter(p=>p.id===(s?.id||d?.ultimo));
      if(matches.length!==1||!matches[0].modelo)return {action:'respuesta',msg:'Abre el perfil de la revisión o indica su nombre para iniciar la sesión de Safari.'};
      const p=matches[0],editor={project:p.id,model:p.modelo,action:'abrirSafari'};
      if(website){editor.source='website';editor.url=website[1];}
      else if(scrollSafari){editor.action='desplazarSafari';editor.direction=scrollSafari[1]==='arriba'?'up':'down';}
      else editor.source=({'companycam':'companycam','matterport':'tour','el recorrido 3d':'tour','el editor de matterport':'editor','las fuentes':'both'})[safari[1]];
      return {action:'respuesta',msg:'Conectando con Safari.',state:{...s,active:true,id:p.id,view:s?.view||'perfil'},editor};
    }
    const pairSafari=/^(?:muestra|compara) (?:los |ambos )?planos lado a lado en safari(?: con hoja (\d+))?$/.exec(q);
    if(pairSafari||q==='reabre el plano en safari para verificar el guardado'){
      const p=s?.active&&d?.perfiles?.find(p=>p.id===s.id);
      if(!p?.modelo)return {action:'respuesta',msg:'Selecciona el perfil para cotejar el plano en Safari.'};
      const photo=pairSafari&&(pairSafari[1]||(p.hojas.plano.length===1?p.hojas.plano[0]:null));
      if(pairSafari&&!p.hojas.plano.includes(photo))return {action:'respuesta',msg:'Indica la hoja de plano de este nivel.'};
      return {action:'respuesta',safariOnly:true,state:{...s},msg:'Consultando las vistas actuales.',editor:{project:p.id,model:p.modelo,action:pairSafari?'compararSafari':'reabrirSafari',photo}};
    }
    const gesture=/^(mueve el puntero|haz clic|arrastra) en safari (?:a |en |desde )?(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?: hasta (\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?))? con hoja (\d+) y operaci[oó]n ([a-z0-9_-]{1,48})$/i.exec(text.trim());
    const labelSafari=/^en safari cambia el label de (.+?) a (.+?) con hoja (\d+)$/i.exec(text.trim());
    if(gesture||labelSafari){
      const profile=s?.active&&d?.perfiles?.find(p=>p.id===s.id);
      const ref=s?.trazado?.ref||s?.muro?.ref;
      if(!profile||!ref)return {action:'respuesta',msg:'Inspecciona el trazado en Safari para identificar el modelo y la vista actual.'};
      const sheet=gesture?gesture[6]:labelSafari[3];
      if(!profile.hojas.plano.includes(sheet))return {action:'respuesta',msg:'La hoja de respaldo debe pertenecer al proyecto seleccionado.'};
      const editor={project:profile.id,model:profile.modelo,ref,evidencia:'https://app.companycam.com/projects/'+profile.id+'/photos/'+sheet+'/photo'};
      if(gesture){
        const kind=normal(gesture[1]);
        if((kind==='arrastra')!==Boolean(gesture[4]))return {action:'respuesta',msg:'Para arrastrar indica los puntos inicial y final.'};
        if(kind==='arrastra'&&s.laundryOnly)return {action:'respuesta',msg:'Este encargo permite agregar los muros de la lavandería. Los muros existentes se conservan.'};
        Object.assign(editor,{action:({'mueve el puntero':'moverPunteroSafari','haz clic':'clicSafari','arrastra':'arrastrarSafari'})[kind],x:Number(gesture[2]),y:Number(gesture[3]),operationId:gesture[7]});
        if(gesture[4])Object.assign(editor,{hastaX:Number(gesture[4]),hastaY:Number(gesture[5])});
      }else{
        if(s.laundryOnly&&labelSafari[2]!=='Laundry Room')return {action:'respuesta',msg:'El Label autorizado para esta lavandería es Laundry Room.'};
        Object.assign(editor,{action:'renombrar',before:labelSafari[1]==='(vacío)'?'':labelSafari[1],after:labelSafari[2]});
      }
      return {action:'respuesta',state:{...s,trazado:undefined,muro:undefined},safariOnly:true,msg:'Conectando con el puntero de Safari.',editor};
    }
    const connection=/^(?:(?:diagnostica|revisa|verifica|comprueba|prueba) (?:la )?conexion (?:con |al |del )?(?:el )?editor(?: de matterport)?|diagnostico (?:de )?(?:la )?conexion (?:con |al |del )?(?:el )?editor(?: de matterport)?)(?: (?:para|de) (.+))?$/.exec(q);
    if(connection){
      const profiles=d?.perfiles||[];
      if(!profiles.length&&!connection[1])return {action:'respuesta',msg:'Comprobando la extensión de Lumi.',editor:{action:'diagnosticarConexion'}};
      const candidates=connection[1]?profiles.filter(p=>normal(p.nombre)===connection[1]||normal(p.nombre).startsWith(connection[1]+' ')):profiles.filter(p=>p.id===(s?.id||d?.ultimo));
      if(candidates.length!==1||!candidates[0].modelo)return {action:'respuesta',msg:'Carga el lote de pickups y especifica el nombre del proyecto para comprobar su editor.'};
      const p=candidates[0];
      return {action:'respuesta',state:{active:true,id:p.id,view:'diagnosticoEditor'},msg:'Comprobando la conexión al editor.',editor:{action:'diagnosticarConexion',project:p.id,model:p.modelo}};
    }
    const wall=wallRoute(text,q,d,s);if(wall)return wall;
    const laundry=laundryRoute(text,q,d,s);if(laundry)return laundry;
    if(patterns.importar.test(q))return {action:'importar'};
    const resume=patterns.retomar.test(q)||['continuamos con los clientes y aplicando el json y el sql','retoma la auditoria de recogidas','volvamos a los perfiles con retiro','continua con la lista acordada de pickups'].includes(q);
    const lesson=lessons.find(item=>item.preguntas.some(question=>normal(question)===q));
    if(lesson)return {action:'leccion',msg:lesson.accion};
    const compare=/^(?:abre el comparador|superpon los planos) de (.+)$/.exec(q);
    if(compare){
      const matches=(d?.perfiles||[]).filter(item=>normal(item.nombre)===compare[1]||normal(item.nombre).startsWith(compare[1]+' '));
      if(matches.length!==1)return {action:'respuesta',msg:'Comprueba el lote cargado y el nombre completo del cliente.'};
      const item=matches[0];
      return {...visual(item),action:'respuesta',overlay:true,state:{active:true,id:item.id,view:'perfil'},msg:'Comparador de '+item.nombre+'. Fuentes iniciales del lote. Comprueba las capturas actuales y verifica puerta, pasillo y escalera antes de editar.'};
    }
    if(!resume&&!s?.active)return null;
    if(!d)return resume?{action:'sinLote',msg:'Dime «importa el lote de pickups» para cargar la lista acordada.'}:null;
    const entries=d.perfiles;let index=entries.findIndex(p=>p.id===(s?.id||d.ultimo));if(index<0)index=0;
    const p=entries[index], result=(msg,extra={})=>({action:'respuesta',msg,state:{...s,id:p.id,active:true},...extra});
    const select=(item,extra={})=>result(item.nombre+'. '+item.nota,{...visual(item),msg:item.nombre+'. '+item.nota+' '+visual(item).msg,state:{...s,active:true,id:item.id,view:'perfil',...extra}});
    if(resume)return select(p);
    const commands={'abre las fuentes':'fuentes','abre companycam y matterport':'fuentes','lee el label seleccionado':'leer'};
    const rename=/^cambia el label seleccionado de (.+?) a (.+)$/i.exec(text.trim());
    if(commands[q]||rename)return result('Conectando con el editor…',{editor:{action:rename?'renombrar':commands[q],project:p.id,model:p.modelo,...(rename?{before:rename[1],after:rename[2]}:{})}});

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
