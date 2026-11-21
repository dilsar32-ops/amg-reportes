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
  function validate(d){
    if(d?.version!==1 || typeof d.lote!=='string'||!Array.isArray(d.perfiles)||!d.perfiles.length)throw Error('Lote incompatible.');
    const ids=new Set();
    for(const p of d.perfiles){
      if(typeof p.id!=='string'||typeof p.nota!=='string'||!/^\d+$/.test(p.id)||ids.has(p.id)||typeof p.nombre!=='string'||!p.nombre.trim()||p.pickup!=='confirmado'||!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha))throw Error('Perfil duplicado o retiro sin confirmar.');
      ids.add(p.id);
      for(const k of ['plano','humedad','equipos','medidas'])if(!Array.isArray(p.hojas?.[k])||p.hojas[k].some(x=>!/^\d+$/.test(x)))throw Error('Referencia de hoja inválida.');
      if(p.comparacion&&!/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(p.comparacion))throw Error('Imagen de comparación inválida.');
    }
    if(!ids.has(d.ultimo)||!Array.isArray(d.fuera)||d.fuera.some(p=>!p||!/^\d+$/.test(p.id)||ids.has(p.id)||typeof p.nombre!=='string'||typeof p.nota!=='string'))throw Error('Revisa el último perfil y las exclusiones.');
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
    const select=(item,extra={})=>result(item.nombre+'. '+item.nota,{state:{...s,active:true,id:item.id,view:'perfil',...extra},project:item});
    if(resume)return select(p);
    if(patterns.salir.test(q))return result('Revisión cerrada. Conservé tu posición.',{state:{...s,active:false}});
    if(/^(?:ya |todavia )?(?:se (?:hizo|confirmo) el pickup|retiraron (?:todo|los equipos)|recogieron (?:las maquinas|todo))$/.test(q))return result(p.nombre+': retiro final confirmado en el registro del '+p.fecha+'.');
    if(patterns.pendiente.test(q)||['que nos quedo por verificar','que nos falta aqui','que le hace falta','dime como quedo este trabajo'].includes(q))return result(p.nombre+'. '+p.nota);
    if(patterns.imagen.test(q)||/^(?:ponme|pon|ensename|muestrame|quiero ver) (?:ambos|los dos) (?:mapas|planos)(?: juntos| a la par| lado a lado| uno junto al otro| con los errores)?$/.test(q))return result(p.comparacion?'Comparación anotada de '+p.nombre+'.':'Todavía falta una comparación anotada de '+p.nombre+'.',{project:p,image:p.comparacion});
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
  window.LumiPickups={route,validate};
})();
