function createLumiEarHealth({now=Date.now}={}){
 let began=now(),frame=began,word=began,tries=0;
 return {begin(){began=frame=word=now();},frame(){frame=now();},text(){word=now();tries=0;},check({active,voice=false}){
  if(!active)return null;
  const t=now();let reason=null;
  if(t-began>4000&&t-frame>3500)reason='audio';
  else if(voice&&t-word>7000)reason='transcription';
  if(!reason)return null;
  tries++;began=frame=word=t;
  return {action:tries<=2?'recover':'stop',reason};
 }};
}
function lumiResolveLaborSpeech(text,{dictating=false,confirming=false}={}){
 const original=String(text||'');if(dictating||confirming)return {text:original};
 const t=original.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 // Never rewrite a dictated message, a recipient, or an ambiguous write action.
 if(/\b(?:dile|mensaje|escribe|dicta|envia|manda|borra|paga|send|message|delete|write)\b/.test(t))return {text:original};
 const query=/\b(?:tenemos|hay|algun|algunos|muestra|muestrame|ver|revisa|lee|have|any|show|check|read)\b/.test(t);
 if(query&&/\b(?:label|leibor|leiber|labor|labour)\s+(?:blogs?|locks?|logs?)\b/.test(t))return {text:original.replace(/\b(?:label|leibor|leiber|labor|labour)\s+(?:blogs?|locks?|logs?)\b/gi,'labor log')};
 if(query&&/\b(?:label|leibor|leiber)\b/.test(t))return {text:original,clarify:true};
 return {text:original};
}
if(typeof module!=='undefined')module.exports={createLumiEarHealth,lumiResolveLaborSpeech};
