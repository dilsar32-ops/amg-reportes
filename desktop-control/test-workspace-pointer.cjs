const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function fixture(postMessage) {
  const document = new EventTarget();
  const window = {webkit:{messageHandlers:{lumiSafari:{postMessage}}}};
  window.top = window;
  const context = vm.createContext({window, document, crypto, CustomEvent,
    location:new URL('https://dilsar32-ops.github.io/amg-reportes/index.html')});
  for (const file of ['lumi-pickups.js', 'safari-control/workspace-bridge.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), context);
  }
  const route = text => window.LumiPickups.route(text,null,null);
  async function send(text) {
    const result = new Promise(resolve => document.addEventListener('lumi-editor-result',
      event => resolve(event.detail), {once:true}));
    document.dispatchEvent(new CustomEvent('lumi-editor-request',{
      detail:{id:crypto.randomUUID(), ...route(text).editor}}));
    return await result;
  }
  return {route,send};
}

test('Una orden explícita entrega el gesto y sus coordenadas al controlador', async () => {
  const sent=[];
  const {send} = fixture(async value=>{sent.push(value);return {ok:true,message:'recibido'};});
  for(const text of ['prueba tu mouse','comprueba tu puntero','¿Dónde está tu ratón?',
    'mueve tu mouse a -300, 248','haz clic con tu mouse en 60, 80',
    'arrastra con tu mouse desde 120, 200 hasta 145, 230']) {
    assert.equal((await send(text)).ok,true);
  }
  assert.deepEqual(sent.map(c=>c.gesture),['test','status','position','move','click','drag']);
  assert.ok(sent.every(c=>c.action==='desktopPointer' && !('project' in c)));
  assert.deepEqual([sent[3].x,sent[3].y],[-300,248]);
  assert.deepEqual([sent[5].x,sent[5].y,sent[5].hastaX,sent[5].hastaY],[120,200,145,230]);
});

test('Preguntas y negaciones no accionan el ratón', () => {
  const {route} = fixture(()=>assert.fail('No hay llamada nativa esperada'));
  for(const text of ['No hagas clic con tu mouse en 60, 80','¿Cómo doy un clic con tu mouse?',
    'haz clic con tu mouse en 15,','arrastra con tu mouse desde 3, 5']) {
    assert.notEqual(route(text)?.editor?.action,'mouseEscritorio');
  }
});

test('Una denegación nativa se conserva como error', async () => {
  const {send} = fixture(async ()=>({ok:false,message:'Accesibilidad pendiente'}));
  const result=await send('prueba tu mouse');
  assert.equal(result.ok,false);
  assert.equal(result.message,'Accesibilidad pendiente');
});
