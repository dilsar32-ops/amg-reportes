(function(root){
'use strict';
function createSync({backend,session,owner,call,uuid=()=>crypto.randomUUID(),now=Date.now}){
 let busy=false,last=0;
 return async function sync(anchors,{force=false}={}){
  const scope=owner(),s={...session()};if(!scope||s.role!=='manager'||busy||(!force&&now()-last<15000))return false;
  busy=true;last=now();const same=()=>owner()===scope;const prefix=s.company_id+'/'+s.user_id+'/';
  try{
   const local=await backend.list(scope);if(!same())return false;
   for(const row of local.filter(r=>anchors.includes(r.anchor)&&!r.cloud)){
    if(row.owner!==scope||!/^[-a-f0-9]{36}$/i.test(row.anchor)||!Array.isArray(row.images)||!row.images.length||row.images.length>10||row.images.some(i=>typeof i.src!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(i.src)||i.src.length>6000000))throw Error('Invalid local attachment');
    if(!row.remoteIds){row.remoteIds=row.images.map(()=>uuid());await backend.put(row);}
    if(row.remoteIds.length!==row.images.length||row.remoteIds.some(id=>!/^[-a-f0-9]{36}$/i.test(id)))throw Error('Invalid attachment ids');
    const exists=await call('/rest/v1/lumi_conversation_entries?id=eq.'+row.anchor+'&select=id');if(!same())return false;if(!exists.length)continue;
    for(let i=0;i<row.images.length;i++){
     const image=row.images[i],id=row.remoteIds[i],path=prefix+id,mime=image.src.slice(5,image.src.indexOf(';'));
     if(!same())return false;
     await call('/storage/v1/object/lumi-chat-attachments/'+path,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:image.src,kind:'upload',allowDuplicate:true});
     if(!same())return false;
     await call('/rest/v1/lumi_conversation_attachments?on_conflict=id',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id,entry_id:row.anchor,user_id:s.user_id,company_id:s.company_id,sandbox:!!s.sandbox,path,mime,label:row.label,alt:image.alt}),allowDuplicate:true});
    }
    if(!same())return false;row.cloud=true;await backend.put(row);
   }
   const remote=await call('/rest/v1/lumi_conversation_attachments?select=*&user_id=eq.'+s.user_id+'&company_id=eq.'+s.company_id+'&sandbox=eq.'+!!s.sandbox+'&order=created_at.desc&limit=60');if(!same())return false;
   if(!Array.isArray(remote)||remote.some(r=>r.user_id!==s.user_id||r.company_id!==s.company_id||r.sandbox!==!!s.sandbox||!/^[-a-f0-9]{36}$/i.test(r.id)||!/^[-a-f0-9]{36}$/i.test(r.entry_id)||r.path!==prefix+r.id||!['image/jpeg','image/png','image/webp'].includes(r.mime)))throw Error('Invalid private attachment metadata');
   const groups=new Map();for(const r of remote){if(!anchors.includes(r.entry_id))continue;if(!groups.has(r.entry_id))groups.set(r.entry_id,[]);if(groups.get(r.entry_id).length<10)groups.get(r.entry_id).push(r);}
   const fresh=await backend.list(scope);if(!same())return false;
   for(const [anchor,rows] of groups){const cached=fresh.find(r=>r.anchor===anchor);if(cached&&rows.every(r=>cached.remoteIds?.includes(r.id)))continue;
    const images=[];let total=0;for(const r of rows.reverse()){
     if(!same())return false;const src=await call('/storage/v1/object/authenticated/lumi-chat-attachments/'+r.path,{kind:'image',mime:r.mime});if(!same())return false;
     total+=src.length;if(total>12000000)throw Error('Attachment group too large');images.push({src,alt:String(r.alt||'Hoja').slice(0,200)});
    }
    await backend.put({owner:scope,anchor,images,label:String(rows[0].label||'Documento').slice(0,300),at:Date.parse(rows[0].created_at),cloud:true,remoteIds:rows.map(r=>r.id)});
   }
   last=now();return true;
  }finally{busy=false;}
 };
}
const api={createSync};if(typeof module!=='undefined')module.exports=api;else root.LumiAttachmentCloud=api;
})(typeof window!=='undefined'?window:globalThis);
