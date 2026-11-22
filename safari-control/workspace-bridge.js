(() => {
  'use strict';
  if (window !== window.top || location.origin !== 'https://dilsar32-ops.github.io' ||
      !location.pathname.startsWith('/amg-reportes/')) return;
  const host = window.webkit?.messageHandlers?.lumiSafari;
  if (!host) return;

  async function execute(request) {
    const call = async (action, args = {}) => {
      const response = await host.postMessage({id:crypto.randomUUID(), project:request.project,
        model:request.model, action, ...args});
      if (!response || response.ok !== true) throw Error(response?.message || response?.error || 'Safari no confirmó la operación.');
      return response;
    };
    const open = (source, url) => call('open', url ? {source, url} : {source});
    function point() {
      return {ref:request.ref, operationId:request.operationId, x:request.x, y:request.y, evidencia:request.evidencia};
    }
    switch (request.action) {
      case 'diagnosticarConexion':
        await call('ping');
        return {message:'El controlador nativo de Safari respondió a Lumi.'};
      case 'fuentes':
      case 'abrirSafari': {
        const source = request.source || 'both';
        if (source !== 'both') return open(source, request.url);
        await open('companycam');
        return open('editor');
      }
      case 'compararSafari': {
        await call('open',{source:'companycam',photo:request.photo});
        const sheet=await call('snapshot');
        await open('report');
        const report=await call('snapshot');
        return {pairImages:[sheet.pngBase64,report.pngBase64],message:'Capturas de CompanyCam y Matterport para revisión visual.'};
      }
      case 'reabrirSafari': {
        await open('report');
        await call('refresh');
        const report=await call('snapshot');
        return {preview:report.pngBase64,message:'Informe reabierto. Comprueba el nombre del cuarto y su posición en esta vista.'};
      }
      case 'desplazarSafari':
        return call('scroll', {deltaY:request.direction==='up'?-540:540});
      case 'inspeccionarTrazado': {
        const connection = await call('ping');
        if (!connection.session) await open('editor');
        const snapshot = await call('snapshot');
        if (!snapshot.ref) throw Error('Safari no devolvió la referencia de la vista.');
        return {ref:snapshot.ref,preview:snapshot.pngBase64,message:'Lumi capturó la vista de Safari. Coteja el plano antes del siguiente gesto.'};
      }
      case 'activarMuro':
      case 'activarSeleccion':
        return call('tool',{name:request.action==='activarMuro'?'Wall':'Select',ref:request.ref,operationId:request.id});
      case 'trazarVertice':
        return call('click',{...point(),tool:'Wall'});
      case 'leer':
        { const read = await call('readLabel'); return {message:'Label seleccionado: '+(read.label || '(vacío)')+'.'}; }
      case 'renombrar':
        return call('writeLabel',{before:request.before,after:request.after,ref:request.ref,
          evidencia:request.evidencia,operationId:request.id});
      case 'moverPunteroSafari':
      case 'clicSafari':
      case 'arrastrarSafari': {
        const action={moverPunteroSafari:'move',clicSafari:'click',arrastrarSafari:'drag'}[request.action];
        return call(action,{...point(),hastaX:request.hastaX,hastaY:request.hastaY,tool:request.tool});
      }
      default:
        throw Error('Esta orden aún no está conectada al controlador de Safari.');
    }
  }

  let running = false;
  function emit(type, detail) {
    document.dispatchEvent(new CustomEvent(type,{detail}));
  }
  document.addEventListener('lumi-editor-request', async event => {
    const request = event.detail;
    if (!request || typeof request.id !== 'string') return;
    const finish = values => emit('lumi-editor-result',{...values,id:request.id,bridge:true});
    if (request.action === 'diagnosticarConexion') emit('lumi-editor-bridge-ack',{id:request.id,bridge:true});
    if (running) { finish({ok:false,message:'Safari tiene una orden en curso.'}); return; }
    running = true;
    try {
      const result = await execute(request);
      finish({ok:true,worker:true,...result,message:result.message || (result.estado==='gesto_enviado'?'Lumi envió el gesto en Safari. Pendiente de comprobación en el editor.':'Safari completó la orden.')});
    } catch (error) {
      finish({ok:false,message:String(error.message || error)});
    } finally {
      running = false;
    }
  });
})();
