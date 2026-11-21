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
  if (!change) return {message:'Label visible: '+(field.value || '(vacío)')+'.'};
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
chrome.runtime.onMessage.addListener((request,sender,respond) => {
  if (!sender.url?.startsWith('https://dilsar32-ops.github.io/amg-reportes/')) return;
  (async()=>{
    const {project,model,action} = request;
    if (!/^\d+$/.test(project) || !/^[a-zA-Z0-9]{11}$/.test(model)) throw Error('Identificadores de proyecto incompletos.');
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
    if (tabs.length!==1) throw Error('Debe haber una sola pestaña de Matterport de este modelo para identificar el editor.');
    if(action==='renombrar' && (typeof request.before!=='string'||!request.before.trim()||typeof request.after!=='string'||!request.after.trim()||request.after.length>80||request.after===request.before)) throw Error('Indica el nombre anterior y el nuevo.');
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tabs[0].id},func:roomLabel,args:[action==='renombrar'?{before:request.before,after:request.after}:null,model]});
    return result;
  })().then(respond,error=>respond({message:error.message}));return true;
});
