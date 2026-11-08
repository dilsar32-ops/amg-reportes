/* Channel-neutral communication contracts. External message content is evidence, never authority. */
(function(root){
'use strict';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const channels=[
 {id:'whatsapp',names:['whatsapp'],enabled:true},
 {id:'messages',names:['mensajes normales','mensajes de apple','imessage','apple messages'],enabled:true},
 {id:'workspace',names:['workspace'],enabled:true},
 {id:'gmail',names:['gmail'],enabled:false},
 {id:'outlook',names:['outlook','hotmail'],enabled:false},
 {id:'apple_mail',names:['apple mail'],enabled:false},
 {id:'slack',names:['slack'],enabled:false},
 {id:'teams',names:['microsoft teams','teams'],enabled:false},
 {id:'telegram',names:['telegram'],enabled:false},
 {id:'signal',names:['signal'],enabled:false},
 {id:'messenger',names:['facebook messenger','messenger'],enabled:false}
];
function channelFor(text){const n=norm(text);return channels.filter(c=>c.names.some(name=>new RegExp('\\b'+name+'\\b').test(n))).map(c=>c.id);}
function unavailable(text){const n=norm(text);
 if(!/\b(lee|leeme|revisa|revisar|busca|responde|responder|contesta|envia|manda|dile|read|check|search|reply|send|email)\b/.test(n))return null;
 // Literal dictated payload may mention other services; inspect only routing prefix.
 const route=n.split(/:|\s+que\s+/)[0];
 const selected=channelFor(route),blocked=channels.filter(c=>selected.includes(c.id)&&!c.enabled);
 if(blocked.length)return 'Todavía no tengo conectad'+(blocked.length>1?'os ':'o ')+blocked.map(c=>c.names[0]).join(', ')+'. No he leído ni enviado mensajes allí. Puedo ayudarte a redactar el texto; para leer o enviar necesito conectar esa aplicación.';
 if(!selected.length&&/\b(correos?|emails?|e-mails?)\b/.test(route))return '¿En qué cuenta de correo quieres que lo revise? Todavía no tengo un conector de correo activo en Lumi.';
 return null;
}
function identity(candidates,query){const exact=candidates.filter(c=>norm(c.name)===norm(query));const ids=new Map(exact.map(c=>[c.account+'|'+c.channel+'|'+c.id,c]));return ids.size===1?{status:'resolved',recipient:[...ids.values()][0]}:{status:ids.size?'ambiguous':'not_found',candidates:[...ids.values()]};}
function evidence(message){if(!message||!message.id||!message.threadId||!message.account||!message.channel||!['inbound','outbound'].includes(message.direction))throw Error('Missing source identity');return {...message,authority:'external_data',attachments:message.attachments||[]};}
function followup(request,messages){const src=messages.find(m=>m.id===request.messageId);if(!src)return {status:'unknown',reason:'source_missing'};
 const same=messages.filter(m=>m.channel===src.channel&&m.account===src.account&&m.threadId===src.threadId);
 const replies=same.filter(m=>m.direction==='outbound'&&m.inReplyTo===src.id&&['submitted','delivered','read'].includes(m.delivery));
 if(request.resolvedBy&&replies.some(m=>m.id===request.resolvedBy))return {status:'answered',source:src.id,reply:request.resolvedBy};
 if(replies.length)return {status:'review_reply',source:src.id,reply:replies.at(-1).id};
 if(request.completeCoverage!==true)return {status:'unknown',source:src.id,reason:'partial_history'};
 return {status:'awaiting_us',source:src.id};
}
function plan(intent,registry){
 if(!intent.owner||!intent.operationId)throw Error('Missing task identity');
 const adapter=registry[intent.channel];if(!adapter)return {status:'unavailable',channel:intent.channel,steps:[]};
 const steps=['resolve_recipient','read_context',...(intent.lookup?['lookup_business_data']:[]),'draft',...(intent.send?['verify_target','send_once','verify_result']:[])];
 const required=['read',...(intent.send?['send']:[])];if(required.some(x=>!adapter.capabilities.includes(x)))return {status:'unsupported',steps:[]};
 return {status:'planned',owner:intent.owner,operationId:intent.operationId,channel:intent.channel,steps};
}
function transition(task,event){
 if(event.owner!==task.owner)throw Error('Wrong account');
 if(event.type==='send'){
  if(task.state!=='draft'||!task.recipientVerified||!event.authorized||event.draftVersion!==task.draftVersion)throw Error('Unreviewed or changed send');
  return {...task,state:'sending'};
 }
 if(event.type==='disconnect')return {...task,state:task.state==='sending'?'uncertain':'waiting_connection',resumeState:task.state};
 if(event.type==='reconnect')return task.state==='waiting_connection'?{...task,state:task.resumeState}:task;
 if(event.type==='result'){
  if(task.state!=='sending'||event.operationId!==task.operationId||event.threadId!==task.threadId)throw Error('Wrong action receipt');
  if(!['submitted','delivered','read','failed','uncertain'].includes(event.status))throw Error('Invalid receipt');
  return {...task,state:event.status};
 }
 throw Error('Unsupported transition');
}
const api={channels,channelFor,unavailable,identity,evidence,followup,plan,transition};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LumiCommunications=api;
})(typeof globalThis!=='undefined'?globalThis:this);
