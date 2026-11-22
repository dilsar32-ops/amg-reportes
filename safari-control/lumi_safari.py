"""Local stdin/stdout controller for Lumi. No HTTP server is exposed by this program."""
import argparse
import base64
import hashlib
import http.client
import json
import ipaddress
import math
import os
import re
import socket
import subprocess
import sys
import time
from urllib.parse import quote, urlsplit, parse_qs


class Blocked(Exception):
    pass


class SafariDriver:
    """Only Apple's loopback-only driver is spawned; never enable Remote Automation here."""
    def __init__(self):
        self.process = None
        self.session = None
        self.port = None

    def http(self, method, path, body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=35)
        try:
            connection.request(method, path, None if body is None else json.dumps(body),
                               headers={'Content-Type': 'application/json'})
            response = connection.getresponse()
            value = json.loads(response.read())['value']
            if response.status >= 400 or (isinstance(value, dict) and value.get('error')):
                raise Blocked(str(value.get('message', value.get('error')))[:650])
            return value
        finally:
            connection.close()

    def start(self):
        if self.session:
            return
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.process = subprocess.Popen(['/usr/bin/safaridriver', '-p', str(self.port)],
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        try:
            deadline = time.monotonic()+5
            while self.process.poll() is None:
                try:
                    self.http('GET', '/status')
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise Blocked('SafariDriver no respondió en localhost.')
                    time.sleep(0.05)
            if self.process.poll() is not None:
                raise Blocked('SafariDriver terminó antes de abrir la sesión.')
            result = self.http('POST', '/session', {
                'capabilities': {'alwaysMatch': {'browserName': 'safari', 'platformName': 'macOS'}}})
            self.session = result['sessionId']
        except Exception:
            self.close()
            raise

    def command(self, method, route, body=None):
        if not self.session:
            raise Blocked('Abre primero una fuente con Lumi.')
        return self.http(method, '/session/'+quote(self.session, safe='')+route, body)

    def close(self):
        try:
            if self.session:
                self.command('DELETE', '')
        finally:
            self.session = None
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.process = None


# Read-only script. W3C pointer coordinates refer to the top-level viewport.
# Only look through visible same-origin frames of this model. Stop at overlays.
OBSERVE = r"""
const [model, points, requestedControl] = arguments;
const visible = el => {const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&
  el.ownerDocument.defaultView.getComputedStyle(el).visibility!=='hidden'};
const frames=[], queue=[{win:window,ancestor:[]}];
for(let i=0;i<queue.length;i++){
  const {win,ancestor}=queue[i], u=new URL(win.location.href);
  if(u.origin!=='https://my.matterport.com') continue;
  const isModel=u.searchParams.get('m')===model || u.pathname.split('/').includes(model);
  if(!isModel) continue;
  const mode=u.pathname==='/work'&&u.searchParams.get('cloudEdit')==='1'?'editor':u.pathname==='/show/'?'tour':'report';
  const btns=[...win.document.querySelectorAll('button,[role=button],[role=radio],[role=tab]')].filter(visible);
  const label=el=>(el.getAttribute('aria-label')||el.title||el.textContent||'').trim();
  const active=el=>el.matches('[aria-pressed=true],[aria-checked=true],[aria-selected=true],[data-state=on],[data-state=active]')||
     [...el.classList].some(c=>['active','selected','is-active','is-selected'].includes(c));
  const canvas=[...win.document.querySelectorAll('canvas')].filter(el=>{const r=el.getBoundingClientRect();
     return visible(el)&&r.width>150&&r.height>150});
  const named=btns.filter(el=>label(el)===requestedControl);
  const toFrame=(x,y)=>{
    for(const frame of ancestor){
      if(frame.ownerDocument.elementFromPoint(x,y)!==frame)return null;
      const r=frame.getBoundingClientRect(), sx=r.width/frame.offsetWidth, sy=r.height/frame.offsetHeight;
      if(!(sx>0&&sy>0))return null;
      x=(x-r.left)/sx-frame.clientLeft; y=(y-r.top)/sy-frame.clientTop;
    }
    return {x,y};
  };
  const toTop=(x,y)=>{
    for(const frame of [...ancestor].reverse()){
      const r=frame.getBoundingClientRect();
      x=r.left+(x+frame.clientLeft)*r.width/frame.offsetWidth;
      y=r.top+(y+frame.clientTop)*r.height/frame.offsetHeight;
    }return {x,y};
  };
  const hits=canvas.length===1&&points.every(({x,y})=>{const p=toFrame(x,y);
     return p&&win.document.elementFromPoint(p.x,p.y)===canvas[0]});
  let target=null;
  if(named.length===1&&!named[0].disabled&&named[0].getAttribute('aria-disabled')!=='true'){
    const r=named[0].getBoundingClientRect(), xy=toTop(r.left+r.width/2,r.top+r.height/2);
    const p=toFrame(Math.round(xy.x),Math.round(xy.y));
    if(p&&named[0].contains(win.document.elementFromPoint(p.x,p.y)))target=xy;
  }
  let bounds=null;
  if(canvas.length===1){const r=canvas[0].getBoundingClientRect();bounds={start:toTop(r.left,r.top),end:toTop(r.right,r.bottom)};}
  const tools=btns.map(label).filter(t=>['Wall','Select','Invisible Wall','Door','Opening','Window','Property Layout','Edit Layout'].includes(t));
  const labels=[...win.document.querySelectorAll('input,textarea')].filter(el=>visible(el)&&!el.disabled&&!el.readOnly&&
    [el.getAttribute('aria-label'),el.getAttribute('placeholder'),...Array.from(el.labels||[],l=>l.textContent.trim())]
      .some(v=>['Label','Add custom label'].includes(v)));
  const framePath=ancestor.map(el=>[...el.ownerDocument.querySelectorAll('iframe')].indexOf(el));
  frames.push({mode,framePath,labelCount:labels.length,tools,activeTools:btns.filter(active).map(label).filter(n=>tools.includes(n)),bounds,hits,target});
  for(const frame of win.document.querySelectorAll('iframe')){
    if(!visible(frame))continue;
    try {if(frame.contentWindow.location.origin===u.origin)queue.push({win:frame.contentWindow,ancestor:[...ancestor,frame]});} catch{}
  }
}
return {viewport:{width:innerWidth,height:innerHeight},frames};
"""


def source_urls(project, model):
    return {
        'companycam': 'https://app.companycam.com/projects/'+project,
        'tour': 'https://my.matterport.com/show/?m='+model,
        'editor': 'https://my.matterport.com/work?m='+model+'&cloudEdit=1&play=0#room_bounds-tool',
        'report': 'https://my.matterport.com/models/'+model+'?section=insights',
    }


def current_source(raw, project, model):
    u = urlsplit(raw)
    if u.scheme != 'https':
        return None
    if u.netloc == 'app.companycam.com' and re.fullmatch(r'/projects/'+project+r'(?:/photos/\d+/photo)?/?', u.path):
        return 'companycam'
    if u.netloc != 'my.matterport.com':
        return None
    if u.path.rstrip('/') == '/models/'+model:
        return 'report'
    q = parse_qs(u.query)
    if q.get('m') == [model]:
        if u.path.rstrip('/') == '/show':
            return 'tour'
        if u.path == '/work' and q.get('cloudEdit') == ['1']:
            return 'editor'
    return None


def point(x,y):
    if any(type(n) not in (int,float) or not math.isfinite(n) or n<0 for n in [x,y]):
        raise Blocked('Falta un punto válido en el viewport.')
    return {'x':round(x),'y':round(y)}


def pointer_actions(kind, start, end=None):
    def move(p,duration):
        return {'type':'pointerMove','duration':duration,'origin':'viewport',**p}
    moves=[move(start,0)]
    if kind != 'move':
        moves.append({'type':'pointerDown','button':0})
        if kind == 'drag':
            moves.append(move(end,360))
        moves.append({'type':'pointerUp','button':0})
    return {'actions':[{'type':'pointer','id':'lumi-mouse','parameters':{'pointerType':'mouse'},'actions':moves}]}


def public_website(raw):
    if not isinstance(raw,str) or len(raw)>2048 or any(ord(c)<33 for c in raw) or '\\' in raw:
        raise Blocked('Se necesita la URL HTTPS pública que solicitó el usuario.')
    u=urlsplit(raw)
    if (u.scheme!='https' or not u.hostname or u.username is not None or u.password is not None or
        u.port not in (None,443) or u.hostname.lower().endswith(('.localhost','.local')) or
        '.' not in u.hostname or u.hostname.endswith('.')):
        raise Blocked('Solo se permite abrir una página HTTPS pública sin credenciales.')
    try:
        hosts=socket.getaddrinfo(u.hostname,443,type=socket.SOCK_STREAM)
        addresses=[ipaddress.ip_address(host[4][0].split('%')[0]) for host in hosts]
    except (OSError,ValueError) as exc:
        raise Blocked('No se pudo verificar un destino público.') from exc
    if not addresses or not all(a.is_global and not a.is_multicast for a in addresses):
        raise Blocked('No se permite un destino de red privada o reservada.')
    return raw


LABEL_FIELD = r"""
const fields=[...document.querySelectorAll('input,textarea')].filter(el=>{
  const r=el.getBoundingClientRect();
  return r.width&&r.height&&getComputedStyle(el).visibility!=='hidden'&&!el.disabled&&!el.readOnly&&
    [el.getAttribute('aria-label'),el.getAttribute('placeholder'),...Array.from(el.labels||[],l=>l.textContent.trim())]
       .some(v=>['Label','Add custom label'].includes(v));
});
return fields.length===1 ? {element:fields[0],label:fields[0].value} : null;
"""
ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'


class Controller:
    def __init__(self, driver, project, model):
        if not re.fullmatch(r'\d+',project) or not re.fullmatch(r'[A-Za-z0-9]{11}',model):
            raise ValueError('Identificadores de proyecto o modelo inválidos.')
        self.driver, self.project, self.model = driver, project, model
        self.urls = source_urls(project,model)
        self.seen=set()
        self.tabs={}
        self.active=None

    def scene(self, points=(), name=None):
        url=self.driver.command('GET','/url')
        if self.active=='website':
            target=self.tabs.get('website',{}).get('requested')
            # Browsers append '/' to a naked origin.
            approved=urlsplit(target or '')
            actual=urlsplit(url)
            if (actual.scheme,actual.netloc.lower(),actual.path or '/',actual.query,actual.fragment)!=(approved.scheme,approved.netloc.lower(),approved.path or '/',approved.query,approved.fragment): raise Blocked('La página redirigió a otro destino; la nueva URL debe ser solicitada antes de interactuar.')
            return {'source':'website','frames':[],'url':url}
        source=current_source(url,self.project,self.model)
        if not source:
            raise Blocked('La sesión no muestra el proyecto o modelo solicitado. Si Safari pide acceso, inicia sesión en su ventana de automatización.')
        if source=='companycam':
            return {'source':source,'frames':[],'url':url}
        state=self.driver.command('POST','/execute/sync',{'script':OBSERVE,'args':[self.model,points,name]})
        return {'source':source,'url':url,**state}

    def screenshot(self,state):
        image=self.driver.command('GET','/screenshot')
        decoded=base64.b64decode(image,validate=True)
        if not decoded.startswith(b'\x89PNG\r\n\x1a\n'):
            raise Blocked('El controlador no devolvió un PNG.')
        ref=hashlib.sha256(state['url'].encode()+b'\0'+decoded).hexdigest()
        return image,ref

    def open_source(self,r):
        source=r.get('source')
        if source=='website':
            url=public_website(r.get('url'))
        elif source in self.urls:
            url=self.urls[source]
            if source=='companycam' and 'photo' in r:
                if not re.fullmatch(r'\d+',str(r['photo'])): raise Blocked('Foto no válida.')
                url+='/photos/'+str(r['photo'])+'/photo'
        else:
            raise Blocked('Fuente fuera del alcance.')
        self.driver.start()
        handles=self.driver.command('GET','/window/handles')
        tab=self.tabs.get(source)
        if tab and tab['handle'] in handles:
            handle=tab['handle']
        elif not self.tabs:
            handle=self.driver.command('GET','/window')
            tab=None
        else:
            handle=self.driver.command('POST','/window/new',{'type':'tab'})['handle']
            tab=None
        self.driver.command('POST','/window',{'handle':handle})
        self.driver.command('POST','/frame',{'id':None})
        self.active=source
        if not tab or tab['requested']!=url:
            self.driver.command('POST','/url',{'url':url})
            self.tabs[source]={'handle':handle,'requested':url}
        return self.scene()

    def label(self,r,write=False):
        state=self.scene()
        editors=[f for f in state['frames'] if f['mode']=='editor' and f['labelCount']==1]
        if len(editors)!=1: raise Blocked('Selecciona un único cuarto en Property Layout para mostrar su Label.')
        if write:
            self.check_gesture(r,state)
            if not isinstance(r.get('before'),str) or not isinstance(r.get('after'),str) or not r['after'].strip() or len(r['after'])>80 or any(ord(c)<32 or 0xe000<=ord(c)<=0xf8ff for c in r['after']):
                raise Blocked('Falta el Label anterior y un nuevo nombre válido.')
        try:
            for i in editors[0]['framePath']:
                element=self.driver.command('POST','/execute/sync',{'script':"return document.querySelectorAll('iframe')[arguments[0]]||null;",'args':[i]})
                if not element: raise Blocked('Cambió el marco del editor.')
                self.driver.command('POST','/frame',{'id':element})
            def field():
                result=self.driver.command('POST','/execute/sync',{
                    'script':"if(location.origin!=='https://my.matterport.com'||location.pathname!=='/work'||new URL(location.href).searchParams.get('m')!==arguments[0]) return null;"+LABEL_FIELD,
                    'args':[self.model]})
                if not result: raise Blocked('Cambió el editor o el campo seleccionado.')
                return result
            selected=field()
            if not write:
                return {'label':selected['label'],'estado':'label_leido'}
            if selected['label']!=r['before']: raise Blocked('El Label actual difiere del anterior esperado.')
            if selected['label']==r['after']: return {'label':selected['label'],'estado':'label_ya_visible','verificado':False}
            self.seen.add(r['operationId'])
            path='/element/'+quote(selected['element'][ELEMENT],safe='')
            # Select existing text before replacing it. A failure before replacement leaves
            # its value intact; avoid clearing first and triggering an empty autosave.
            keys='\ue03d'+'a'+'\ue000'+r['after']+'\ue004'
            self.driver.command('POST',path+'/value',{'text':keys})
            if field()['label']!=r['after']: raise Blocked('No se confirmó el nuevo Label tras salir del campo. Revisa el cuarto.')
            return {'label':r['after'],'estado':'label_leido_tras_editar','verificado':False,
                    'message':'Label leído después de editar. Reabre el modelo y utiliza readLabel para comprobar la persistencia.'}
        finally:
            self.driver.command('POST','/frame',{'id':None})

    def check_gesture(self,r,state):
        if not re.fullmatch(r'[0-9a-f]{64}',str(r.get('ref',''))): raise Blocked('Falta la referencia de la captura actual.')
        if not isinstance(r.get('operationId'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',r['operationId']) or r['operationId'] in self.seen:
            raise Blocked('Identificador de operación ausente, no válido o ya intentado.')
        if r['action']!='tool' and not re.fullmatch(re.escape(self.urls['companycam'])+r'/photos/\d+/photo/?',str(r.get('evidencia',''))):
            raise Blocked('Falta la foto de referencia del mismo proyecto.')
        _,ref=self.screenshot(state)
        if ref!=r['ref']: raise Blocked('La vista cambió. Toma otra captura y vuelve a cotejar el punto.')

    def dispatch(self,r):
        action=r.get('action')
        if action=='ping':
            return {'available':os.access('/usr/bin/safaridriver',os.X_OK),'session':bool(self.driver.session)}
        if action=='close':
            self.driver.close()
            self.seen.clear()
            self.tabs.clear()
            self.active=None
            return {'estado':'sesion_cerrada'}
        if action=='open':
            return self.open_source(r)
        if action=='refresh':
            state=self.scene()
            if state['source'] not in ('editor','report','tour'):
                raise Blocked('Solo se puede reabrir el modelo vigente para verificarlo.')
            self.driver.command('POST','/refresh',{})
            return self.scene()
        if action in ('readLabel','writeLabel'):
            return self.label(r,action=='writeLabel')
        if action=='scroll':
            state=self.scene()
            delta=r.get('deltaY')
            if type(delta) not in (int,float) or not math.isfinite(delta) or not 0<abs(delta)<=1600:
                raise Blocked('Usa un desplazamiento de hasta 1600 píxeles.')
            changed=self.driver.command('POST','/execute/sync',{'script':"const y=scrollY; window.scrollBy({top:arguments[0],behavior:'instant'});return scrollY-y;",'args':[delta]})
            return {'source':state['source'],'deltaY':changed}
        if action in ('snapshot','inspect'):
            state=self.scene()
            if action=='snapshot' and state['source']=='website': raise Blocked('Las páginas externas solo permiten abrir y desplazar.')
            if action=='snapshot':
                state['pngBase64'],state['ref']=self.screenshot(state)
            return state
        if action not in ('tool','move','click','drag'): raise Blocked('Acción no admitida.')
        operation=r.get('operationId')
        pts=[]
        name=r.get('name') if action=='tool' else None
        if action=='tool' and name not in {'Wall','Select','Property Layout','Edit Layout','View Floor Plan','Explore 3D Space','View Dollhouse'}:
            raise Blocked('Herramienta fuera del alcance.')
        if action!='tool':
            pts=[point(r.get('x'),r.get('y'))]
            if action=='drag':
                end=point(r.get('hastaX'),r.get('hastaY'))
                if end==pts[0]: raise Blocked('El arrastre necesita un destino distinto.')
                start=pts[0]
                pts.extend(point(start['x']+(end['x']-start['x'])*i/20,start['y']+(end['y']-start['y'])*i/20) for i in range(1,21))
        state=self.scene(pts,name)
        if state['source'] in ('companycam','website'): raise Blocked('Esta página solo permite lectura.')
        self.check_gesture(r,state)
        # Recheck source and hit targets immediately before delivering the W3C input.
        state=self.scene(pts,name)
        if name:
            frames=[f for f in state['frames'] if f.get('target')]
        else:
            frames=[f for f in state['frames'] if f.get('hits') and f['mode'] in ('editor','tour')]
        if len(frames)!=1: raise Blocked('No hay un único control o lienzo verificable para esta operación.')
        frame=frames[0]
        if name:
            start=point(**frame['target'])
            kind='click'
        else:
            start=pts[0]
            kind=action
            if frame['mode']=='editor' and action!='move':
                allowed={'Select'} if action=='drag' else {'Select','Wall'}
                if len(set(frame['activeTools']) & allowed)!=1:
                    raise Blocked('No se confirmó la herramienta activa para este gesto.')
        self.seen.add(operation)
        try:
            self.driver.command('POST','/actions',pointer_actions(kind,start,pts[-1] if pts else None))
        except Exception:
            # Driver may already have pressed the button when a timeout occurred.
            try: self.driver.command('DELETE','/actions')
            except Exception: pass
            raise
        return {'estado':'gesto_enviado','operationId':operation,'verificado':False}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--project',required=True)
    parser.add_argument('--model',required=True)
    args=parser.parse_args()
    controller=Controller(SafariDriver(),args.project,args.model)
    try:
        for line in sys.stdin:
            req={}
            try:
                req=json.loads(line)
                if not isinstance(req,dict): raise Blocked('Se esperaba un objeto JSON.')
                answer={'ok':True,**controller.dispatch(req)}
            except Exception as e:
                answer={'ok':False,'message':str(e)}
            print(json.dumps({**answer,'id':req.get('id') if isinstance(req,dict) else None},ensure_ascii=False),flush=True)
    finally:
        controller.driver.close()


if __name__=='__main__':
    main()
