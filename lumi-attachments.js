(function(root){
'use strict';
function validRecord(r){return r&&typeof r.owner==='string'&&typeof r.anchor==='string'&&/^[a-f0-9-]{36}$/i.test(r.anchor)&&Array.isArray(r.images)&&r.images.length>0&&r.images.length<=10&&r.images.every(i=>typeof i.src==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(i.src)&&i.src.length<=6000000&&typeof i.alt==='string'&&i.alt.length<=200)&&r.images.reduce((n,i)=>n+i.src.length,0)<=12000000&&typeof r.label==='string'&&r.label.length<=300&&Number.isFinite(r.at);}
function createStore({backend,owner,now=Date.now}){return{
 async put(anchor,images,label=''){const scope=owner();if(!scope)return false;const record={owner:scope,anchor,images,label,at:now()};if(!validRecord(record))throw Error('Invalid attachment');await backend.put(record);return owner()===scope;},
 async list(anchors){const scope=owner();if(!scope)return[];const rows=await backend.list(scope);if(owner()!==scope)return[];return rows.filter(r=>validRecord(r)&&r.owner===scope&&anchors.includes(r.anchor));}
};}
function indexedBackend(indexedDB){let pending;
 const open=()=>pending||(pending=new Promise((resolve,reject)=>{const req=indexedDB.open('lumi.attachments.v1',1);req.onupgradeneeded=()=>{req.result.createObjectStore('cards',{keyPath:['owner','anchor']}).createIndex('owner','owner');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>{pending=null;reject(req.error);};}));
 return{async put(row){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('cards','readwrite'),store=tx.objectStore('cards');store.put(row);const q=store.index('owner').getAll(row.owner);q.onsuccess=()=>{const rows=q.result.sort((a,b)=>b.at-a.at);let bytes=0;for(let i=0;i<rows.length;i++){bytes+=rows[i].images.reduce((sum,img)=>sum+img.src.length,0);if(i>=30||bytes>24000000)store.delete([row.owner,rows[i].anchor]);}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Attachment storage aborted'));});},async list(owner){const db=await open();return new Promise((resolve,reject)=>{const q=db.transaction('cards').objectStore('cards').index('owner').getAll(owner);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}};
}
const api={createStore,indexedBackend,validRecord};if(typeof module!=='undefined')module.exports=api;else root.LumiAttachments=api;
})(typeof window!=='undefined'?window:globalThis);
