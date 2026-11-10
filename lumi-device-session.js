/* One speaking session per manager. The shared transcript never owns the microphone.
 * No credentials, conversation text or audio are stored in this lease.
 */
function createLumiDeviceSession({session, call, device, uuid=()=>crypto.randomUUID(), now=Date.now, onHandoff=()=>{}}){
 const id=uuid();let local=null,pending=Promise.resolve(),epoch=0,checking=null;
 const scope=()=>{const s=session();return s?.role==='manager'&&s.user_id&&s.company_id&&!s.sandbox?{user:s.user_id,company:s.company_id,key:s.user_id+'|'+s.company_id}:null;};
 const route=s=>'/rest/v1/asistente_ajustes?company_id=eq.'+encodeURIComponent(s.company)+'&clave=eq.'+encodeURIComponent('lumi_voice_focus_'+s.user);
 const active=()=>!!local&&local.owner===scope()?.key&&local.expires>now();
 function lose(){const had=!!local;local=null;if(had)onHandoff();return false;}
 function valid(value,s){return value?.userId===s.user&&value?.sessionId===id&&value?.active===true&&Number.isFinite(value.expiresAt)&&value.expiresAt>now()&&value.expiresAt-now()<=120000;}
 async function read(s){const rows=await call(route(s)+'&select=valor');return rows?.[0]?.valor;}
 function activate(){
  const s=scope(),e=++epoch;checking=null;if(!s)return Promise.resolve(lose());
  // Serialize local taps; only explicit user interaction can take ownership.
  const run=pending.catch(()=>{}).then(async()=>{
   await read(s); // also samples the server clock before writing expiration
   if(e!==epoch||s.key!==scope()?.key)return false;
   const value={userId:s.user,sessionId:id,device,active:true,updatedAt:now(),expiresAt:now()+90000};
   await call('/rest/v1/asistente_ajustes?on_conflict=company_id,clave',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({company_id:s.company,clave:'lumi_voice_focus_'+s.user,valor:value})});
   if(e!==epoch||s.key!==scope()?.key)return false;
   const saved=await read(s);if(!valid(saved,s))return lose();
   local={owner:s.key,expires:saved.expiresAt};return true;
  }).catch(()=>lose());pending=run;return run;
 }
 async function owns(renew=false){
  await pending;const s=scope(),e=epoch;if(!s||!local||local.owner!==s.key)return lose();
  if(checking)return checking;
  const run=(async()=>{try{
   let saved=await read(s);if(e!==epoch||scope()?.key!==s.key)return false;
   if(!valid(saved,s))return lose();
   if(renew&&saved.expiresAt-now()<65000){
    // A previous device cannot overwrite a newer claim while renewing or closing.
    const rows=await call(route(s)+'&valor->>sessionId=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({valor:{...saved,updatedAt:now(),expiresAt:now()+90000}})});
    if(e!==epoch||scope()?.key!==s.key)return false;
    saved=rows?.[0]?.valor;if(!valid(saved,s))return lose();
   }
   local={owner:s.key,expires:saved.expiresAt};return true;
  }catch{return e===epoch&&scope()?.key===s.key?lose():false;}})();checking=run;try{return await run;}finally{if(checking===run)checking=null;}
 }
 async function release(){const s=scope(),e=++epoch;local=null;await pending;if(!s||scope()?.key!==s.key||e!==epoch)return;try{await call(route(s)+'&valor->>sessionId=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({valor:{userId:s.user,sessionId:id,device,active:false,expiresAt:now()}})});}catch{}}
 return {activate,owns,release,active,identity:()=>({device,sessionId:id})};
}
function lumiDeviceKind(navigator,platform=''){
 return platform==='ios'||platform==='android'||/iPhone|iPad|iPod|Android/.test(navigator.userAgent||'')||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?'mobile':'desktop';
}
function lumiDeviceAnswer(text,device){
 const t=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?!.]/g,'').trim();
 if(!/^(?:lumi[, ]*)?(?:(?:desde |en )?(?:donde|que (?:dispositivo|aparato)) (?:estoy|estamos)(?: hablando| conectado| conectada| usando lumi)?|estoy (?:en|usando) (?:el|la|mi) (?:telefono|iphone|mac|computadora)(?: o (?:el|la|mi) (?:telefono|iphone|mac|computadora))?|(?:which|what) device am i (?:on|using)|am i on (?:my |the )?(?:phone|mac|computer)|estoy en (?:el |la |my )?(?:phone|computer|mac))$/.test(t))return null;
 const en=/^(?:which|what|am i)/.test(t),mobile=device==='mobile';
 return en?(mobile?'You’re talking to me on your phone or tablet. I’ll play my replies here.':'You’re talking to me on the computer. I’ll play my replies here.'):(mobile?'Me está hablando desde el teléfono o la tablet. Mi voz se escucha aquí.':'Me está hablando desde la computadora. Mi voz se escucha aquí.');
}
if(typeof module!=='undefined')module.exports={createLumiDeviceSession,lumiDeviceKind,lumiDeviceAnswer};
