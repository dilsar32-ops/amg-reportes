document.addEventListener('lumi-editor-request', async event => {
  const request = event.detail;
  if (!request || typeof request.id !== 'string' || !request.id) return;
  const send = (type, fields) => document.dispatchEvent(new CustomEvent(type,{
    detail:{...fields,id:request.id,bridge:true}
  }));
  const diagnostic = request.action === 'diagnosticarConexion';
  let version;
  try { version = chrome.runtime.getManifest().version; } catch { /* extension reloaded */ }
  if (diagnostic) send('lumi-editor-bridge-ack',{version});
  try {
    const result = await chrome.runtime.sendMessage(request);
    if (!result || typeof result.message !== 'string') throw Error('Sin respuesta del controlador');
    send('lumi-editor-result',{...result,worker:true});
  } catch {
    send('lumi-editor-result',{version,worker:false,ok:false,
      message:'El puente de Lumi respondió, pero no recibió respuesta del controlador de Chrome. Recarga Workspace y comprueba la extensión.'});
  }
});
