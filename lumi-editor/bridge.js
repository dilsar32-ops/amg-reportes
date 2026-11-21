document.addEventListener('lumi-editor-request', async event => {
  const request = event.detail;
  try {
    const result = await chrome.runtime.sendMessage(request);
    document.dispatchEvent(new CustomEvent('lumi-editor-result',{detail:{id:request.id,...result}}));
  } catch {
    document.dispatchEvent(new CustomEvent('lumi-editor-result',{detail:{id:request.id,message:'La extensión perdió la conexión. Recarga Workspace.'}}));
  }
});
