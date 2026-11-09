/* Temporary bounded timing diagnostics. Never records text, audio, URLs or errors. */
function createLumiVoiceDiagnostics({session,device,native,version,send,now=Date.now}){
 if(!['mobile','desktop'].includes(device))return ()=>{};
 let currentTrace=null,owner=null,events=[],pending=null,running=false,started=0,queued=false;
 const scope=s=>s?.role==='manager'&&s.user_id&&s.company_id?s.user_id+'|'+s.company_id:null;
 function flush(){
  if(running||!pending)return;
  running=true;
  (async()=>{while(pending){const item=pending;pending=null;if(scope(session())!==item.owner)continue;try{await send(item.record);}catch{}}})().finally(()=>{running=false;if(pending)flush();});
 }
 return event=>{
  const s=session(),current=scope(s);if(!current)return;
  if(event.stage==='start'){currentTrace=event.trace??0;owner=current;events=[];started=now();queued=false;}
  if(current!==owner||(event.trace??0)!==currentTrace)return;
  const allowed=['start','device','capability','queued','audio_downloaded','playback_requested','completed','cancelled','failed'];
  if(!allowed.includes(event.stage)||!Number.isFinite(event.ms))return;
  const item={stage:event.stage,ms:Math.max(0,Math.min(300000,Math.round(event.ms)))};
  if(typeof event.cached==='boolean')item.cached=event.cached;
  if(Number.isFinite(event.beforeSpeechMs))item.beforeSpeechMs=Math.max(0,Math.min(300000,Math.round(event.beforeSpeechMs)));
  if(typeof event.ready==='boolean')item.ready=event.ready;
  if(typeof event.stream==='boolean')item.stream=event.stream;
  if(Number.isFinite(event.engineMs))item.engineMs=Math.max(0,Math.min(300000,Math.round(event.engineMs)));
  if(event.stage==='queued'&&queued)return;
  if(event.stage==='queued')queued=true;
  events.push(item);events=events.slice(-10);
  if(!['queued','audio_downloaded','playback_requested','completed','cancelled','failed'].includes(event.stage)&&!(event.stage==='device'&&!event.ready))return;
  pending={owner,record:{company_id:s.company_id,clave:'lumi_voice_diagnostic_'+s.user_id+'_'+device,valor:{userId:s.user_id,device,native:!!native,version:String(version).slice(0,40),startedAt:new Date(started).toISOString(),updatedAt:new Date(now()).toISOString(),events:events.slice()}}};flush();
 };
}
if(typeof module!=='undefined')module.exports={createLumiVoiceDiagnostics};
